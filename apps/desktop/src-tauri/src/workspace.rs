use std::{
    collections::{HashMap, HashSet},
    fs::{self, File},
    io::{self, Read, Write},
    path::{Component, Path, PathBuf},
    sync::{mpsc, Arc, Condvar, Mutex},
    thread::{self, JoinHandle},
    time::{Duration, Instant, UNIX_EPOCH},
};

#[cfg(target_os = "linux")]
use std::os::fd::{AsRawFd, OwnedFd};

use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
#[cfg(target_os = "linux")]
use rustix::fs::{fstat, open, openat2, Mode, OFlags, ResolveFlags};
use serde::Serialize;
use sha2::{Digest, Sha256};
use tempfile::NamedTempFile;
use thiserror::Error;

const WATCH_DEBOUNCE: Duration = Duration::from_millis(75);
/// Upper bound on how long a batch may keep absorbing events before it is
/// delivered. Without it the debounce window restarts on every message, so a
/// workspace that is never quiet — an editor swap file, a sync client, a build
/// watcher — never delivers anything at all.
const WATCH_BATCH_MAX: Duration = Duration::from_millis(500);
const OWN_WRITE_WINDOW: Duration = Duration::from_secs(2);

#[derive(Debug, Error)]
pub enum WorkspaceError {
    #[error("invalid workspace path: {0}")]
    InvalidPath(String),
    #[error("path escapes the workspace: {0}")]
    PathEscape(String),
    #[error("workspace I/O failed: {0}")]
    Io(#[from] io::Error),
    #[error("workspace watch failed: {0}")]
    Notify(#[from] notify::Error),
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileMetadata {
    pub path: String,
    pub sha256: String,
    pub mtime_unix_ms: u64,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum WorkspaceEventKind {
    Modified,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceEvent {
    pub kind: WorkspaceEventKind,
    pub path: String,
    pub sha256: String,
    pub mtime_unix_ms: u64,
}

#[derive(Clone, Debug)]
struct KnownWrite {
    sha256: String,
    mtime_unix_ms: u64,
    completed_at: Instant,
}

#[derive(Clone, Debug)]
pub struct WorkspaceService {
    root: PathBuf,
    #[cfg(target_os = "linux")]
    root_fd: Arc<OwnedFd>,
    known_writes: Arc<Mutex<HashMap<PathBuf, KnownWrite>>>,
    /// Paths whose write has been made visible by `persist` but whose record
    /// has not landed yet. The watcher waits on these so it can never judge a
    /// change before the service has finished describing its own write.
    pending_writes: Arc<(Mutex<HashMap<PathBuf, usize>>, Condvar)>,
}

impl WorkspaceService {
    pub fn new(root: impl AsRef<Path>) -> Result<Self, WorkspaceError> {
        let root = fs::canonicalize(root.as_ref())?;
        if !root.is_dir() {
            return Err(WorkspaceError::InvalidPath(root.display().to_string()));
        }
        #[cfg(target_os = "linux")]
        let root_fd = open(
            &root,
            OFlags::RDONLY | OFlags::DIRECTORY | OFlags::CLOEXEC | OFlags::NOFOLLOW,
            Mode::empty(),
        )
        .map_err(io::Error::from)?;
        Ok(Self {
            root,
            #[cfg(target_os = "linux")]
            root_fd: Arc::new(root_fd),
            known_writes: Arc::new(Mutex::new(HashMap::new())),
            pending_writes: Arc::new((Mutex::new(HashMap::new()), Condvar::new())),
        })
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn read_markdown(&self, relative: impl AsRef<Path>) -> Result<Vec<u8>, WorkspaceError> {
        let relative = validate_relative_markdown(relative.as_ref())?;
        #[cfg(target_os = "linux")]
        {
            let file = self.open_file_beneath(&relative)?;
            return read_bytes(File::from(file));
        }
        #[cfg(not(target_os = "linux"))]
        {
            let target = self.root.join(&relative);
            let canonical = fs::canonicalize(&target)?;
            if !canonical.starts_with(&self.root) || !canonical.is_file() {
                return Err(WorkspaceError::PathEscape(relative_to_string(&relative)));
            }
            Ok(fs::read(canonical)?)
        }
    }

    pub fn atomic_write_markdown(
        &self,
        relative: impl AsRef<Path>,
        bytes: &[u8],
    ) -> Result<FileMetadata, WorkspaceError> {
        self.atomic_write_markdown_with(relative, |temporary| temporary.write_all(bytes))
    }

    pub fn atomic_write_markdown_with<F>(
        &self,
        relative: impl AsRef<Path>,
        write: F,
    ) -> Result<FileMetadata, WorkspaceError>
    where
        F: FnOnce(&mut NamedTempFile) -> io::Result<()>,
    {
        let relative = validate_relative_markdown(relative.as_ref())?;
        #[cfg(target_os = "linux")]
        {
            return self.atomic_write_linux(relative, write);
        }
        #[cfg(not(target_os = "linux"))]
        {
            let target = self.root.join(&relative);
            let parent = target
                .parent()
                .ok_or_else(|| WorkspaceError::InvalidPath(relative_to_string(&relative)))?;
            let canonical_parent = fs::canonicalize(parent)?;
            if !canonical_parent.starts_with(&self.root) {
                return Err(WorkspaceError::PathEscape(relative_to_string(&relative)));
            }

            let mut temporary = NamedTempFile::new_in(&canonical_parent)?;
            write(&mut temporary)?;
            temporary.as_file_mut().flush()?;
            temporary.as_file().sync_all()?;
            let _pending = self.pending_write(&relative);
            temporary
                .persist(&target)
                .map_err(|error| WorkspaceError::Io(error.error))?;
            sync_directory(&canonical_parent)?;

            let metadata = metadata_for(&target, &relative)?;
            self.record_known_write(relative, &metadata);
            Ok(metadata)
        }
    }

    fn pending_write(&self, relative: &Path) -> PendingWrite<'_> {
        self.begin_pending_write(relative);
        PendingWrite {
            service: self,
            relative: relative.to_path_buf(),
        }
    }

    fn begin_pending_write(&self, relative: &Path) {
        let (pending, _) = &*self.pending_writes;
        let mut pending = pending.lock().expect("pending writes lock");
        *pending.entry(relative.to_path_buf()).or_insert(0) += 1;
    }

    fn finish_pending_write(&self, relative: &Path) {
        let (pending, ready) = &*self.pending_writes;
        {
            let mut pending = pending.lock().expect("pending writes lock");
            if let Some(count) = pending.get_mut(relative) {
                *count = count.saturating_sub(1);
                if *count == 0 {
                    pending.remove(relative);
                }
            }
        }
        ready.notify_all();
    }

    fn record_known_write(&self, relative: PathBuf, metadata: &FileMetadata) {
        let mut writes = self.known_writes.lock().expect("known writes lock");
        writes.retain(|_, write| write.completed_at.elapsed() <= OWN_WRITE_WINDOW);
        writes.insert(
            relative,
            KnownWrite {
                sha256: metadata.sha256.clone(),
                mtime_unix_ms: metadata.mtime_unix_ms,
                completed_at: Instant::now(),
            },
        );
    }

    #[cfg(target_os = "linux")]
    fn atomic_write_linux<F>(
        &self,
        relative: PathBuf,
        write: F,
    ) -> Result<FileMetadata, WorkspaceError>
    where
        F: FnOnce(&mut NamedTempFile) -> io::Result<()>,
    {
        let parent_relative = relative.parent().unwrap_or_else(|| Path::new(""));
        let file_name = relative
            .file_name()
            .ok_or_else(|| WorkspaceError::InvalidPath(relative_to_string(&relative)))?;
        let parent_fd = self.open_directory_beneath(parent_relative)?;
        let parent_path = proc_fd_path(&parent_fd);
        let target = parent_path.join(file_name);

        let mut temporary = NamedTempFile::new_in(&parent_path)?;
        write(&mut temporary)?;
        temporary.as_file_mut().flush()?;
        temporary.as_file().sync_all()?;
        self.ensure_same_directory(parent_relative, &parent_fd, &relative)?;

        // Described before the rename makes it visible. A rename does not change
        // the file's modification time, so the temporary file already carries the
        // metadata the watcher will observe. Describing it afterwards left a
        // window where a failed read would lose the record and the service would
        // report its own write as an external change.
        let metadata = metadata_for_file(temporary.reopen()?, &relative)?;

        // Registered before persist: once the rename lands the watcher can see
        // the change immediately, and it must not judge it before this write
        // has been recorded.
        let _pending = self.pending_write(&relative);
        self.record_known_write(relative.clone(), &metadata);
        temporary
            .persist(&target)
            .map_err(|error| WorkspaceError::Io(error.error))?;
        File::from(rustix::io::dup(&parent_fd).map_err(io::Error::from)?).sync_all()?;
        self.ensure_same_directory(parent_relative, &parent_fd, &relative)?;

        Ok(metadata)
    }

    #[cfg(target_os = "linux")]
    fn open_directory_beneath(&self, relative: &Path) -> Result<OwnedFd, WorkspaceError> {
        let relative = if relative.as_os_str().is_empty() {
            Path::new(".")
        } else {
            relative
        };
        openat2(
            self.root_fd.as_ref(),
            relative,
            OFlags::RDONLY | OFlags::DIRECTORY | OFlags::CLOEXEC | OFlags::NOFOLLOW,
            Mode::empty(),
            safe_resolve_flags(),
        )
        .map_err(|error| WorkspaceError::Io(error.into()))
    }

    #[cfg(target_os = "linux")]
    fn open_file_beneath(&self, relative: &Path) -> Result<OwnedFd, WorkspaceError> {
        openat2(
            self.root_fd.as_ref(),
            relative,
            OFlags::RDONLY | OFlags::CLOEXEC | OFlags::NOFOLLOW,
            Mode::empty(),
            safe_resolve_flags(),
        )
        .map_err(|error| WorkspaceError::Io(error.into()))
    }

    #[cfg(target_os = "linux")]
    fn ensure_same_directory(
        &self,
        relative: &Path,
        expected: &OwnedFd,
        requested: &Path,
    ) -> Result<(), WorkspaceError> {
        let current = self.open_directory_beneath(relative)?;
        let expected = fstat(expected).map_err(io::Error::from)?;
        let current = fstat(&current).map_err(io::Error::from)?;
        if expected.st_dev != current.st_dev || expected.st_ino != current.st_ino {
            return Err(WorkspaceError::PathEscape(relative_to_string(requested)));
        }
        Ok(())
    }

    fn metadata_for_relative(&self, relative: &Path) -> Result<FileMetadata, WorkspaceError> {
        #[cfg(target_os = "linux")]
        {
            return metadata_for_file(File::from(self.open_file_beneath(relative)?), relative);
        }
        #[cfg(not(target_os = "linux"))]
        {
            metadata_for(&self.root.join(relative), relative)
        }
    }

    pub fn start_workspace_watch<F>(&self, callback: F) -> Result<WorkspaceWatch, WorkspaceError>
    where
        F: Fn(WorkspaceEvent) + Send + 'static,
    {
        let (event_sender, event_receiver) = mpsc::channel::<WatchMessage>();
        let notify_sender = event_sender.clone();
        let mut watcher = notify::recommended_watcher(move |result| {
            let _ = notify_sender.send(WatchMessage::Event(result));
        })?;
        watcher.watch(&self.root, RecursiveMode::Recursive)?;

        let service = self.clone();
        let worker = thread::spawn(move || watch_worker(event_receiver, service, callback));

        Ok(WorkspaceWatch {
            watcher: Some(watcher),
            sender: event_sender,
            worker: Some(worker),
        })
    }
}

pub struct WorkspaceWatch {
    watcher: Option<RecommendedWatcher>,
    sender: mpsc::Sender<WatchMessage>,
    worker: Option<JoinHandle<()>>,
}

impl Drop for WorkspaceWatch {
    fn drop(&mut self) {
        self.watcher.take();
        let _ = self.sender.send(WatchMessage::Stop);
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
    }
}

enum WatchMessage {
    Event(notify::Result<Event>),
    Stop,
}

fn watch_worker<F>(receiver: mpsc::Receiver<WatchMessage>, service: WorkspaceService, callback: F)
where
    F: Fn(WorkspaceEvent),
{
    loop {
        let first = match receiver.recv() {
            Ok(WatchMessage::Event(event)) => event,
            Ok(WatchMessage::Stop) | Err(_) => return,
        };
        let mut paths = event_paths(first);
        let batch_deadline = Instant::now() + WATCH_BATCH_MAX;
        loop {
            let remaining = batch_deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                break;
            }
            match receiver.recv_timeout(WATCH_DEBOUNCE.min(remaining)) {
                Ok(WatchMessage::Event(event)) => paths.extend(event_paths(event)),
                Ok(WatchMessage::Stop) | Err(mpsc::RecvTimeoutError::Disconnected) => return,
                Err(mpsc::RecvTimeoutError::Timeout) => break,
            }
        }

        let mut paths = paths.into_iter().collect::<Vec<_>>();
        paths.sort();
        for absolute in paths {
            let Ok(relative) = absolute.strip_prefix(&service.root).map(Path::to_path_buf) else {
                continue;
            };
            if validate_relative_markdown(&relative).is_err() {
                continue;
            }
            let Ok(metadata) = service.metadata_for_relative(&relative) else {
                continue;
            };
            if is_matching_known_write(&service, &relative, &metadata) {
                continue;
            }
            callback(WorkspaceEvent {
                kind: WorkspaceEventKind::Modified,
                path: metadata.path,
                sha256: metadata.sha256,
                mtime_unix_ms: metadata.mtime_unix_ms,
            });
        }
    }
}

fn event_paths(event: notify::Result<Event>) -> HashSet<PathBuf> {
    event
        .map(|event| {
            // Describing a change means opening and hashing the file, and that
            // read is itself reported by the watcher. Access events never carry
            // a content change, and acting on them makes the watcher wake
            // itself in a loop until the own-write record expires and the
            // unchanged file is announced as an external edit.
            if matches!(event.kind, EventKind::Access(_)) {
                return HashSet::new();
            }
            event.paths.into_iter().collect()
        })
        .unwrap_or_default()
}

struct PendingWrite<'a> {
    service: &'a WorkspaceService,
    relative: PathBuf,
}

impl Drop for PendingWrite<'_> {
    fn drop(&mut self) {
        self.service.finish_pending_write(&self.relative);
    }
}

/// Blocks while the service is still completing its own write to this path,
/// bounded by the same window that governs suppression.
fn await_pending_write(service: &WorkspaceService, relative: &Path) {
    let (pending, ready) = &*service.pending_writes;
    let deadline = Instant::now() + OWN_WRITE_WINDOW;
    let mut guard = pending.lock().expect("pending writes lock");
    while guard.contains_key(relative) {
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            break;
        }
        let (next, timeout) = ready
            .wait_timeout(guard, remaining)
            .expect("pending writes wait");
        guard = next;
        if timeout.timed_out() {
            break;
        }
    }
}

fn is_matching_known_write(
    service: &WorkspaceService,
    relative: &Path,
    metadata: &FileMetadata,
) -> bool {
    await_pending_write(service, relative);
    let mut writes = service.known_writes.lock().expect("known writes lock");
    writes.retain(|_, write| write.completed_at.elapsed() <= OWN_WRITE_WINDOW);
    matches!(
        writes.get(relative),
        Some(write)
            if write.sha256 == metadata.sha256
                && write.mtime_unix_ms == metadata.mtime_unix_ms
    )
}

fn validate_relative_markdown(path: &Path) -> Result<PathBuf, WorkspaceError> {
    if path.as_os_str().is_empty()
        || path.is_absolute()
        || path.extension().and_then(|value| value.to_str()) != Some("md")
        || path
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err(WorkspaceError::InvalidPath(path.display().to_string()));
    }
    Ok(path.to_path_buf())
}

fn metadata_for_file(mut file: File, relative: &Path) -> Result<FileMetadata, WorkspaceError> {
    let mut bytes = Vec::new();
    file.read_to_end(&mut bytes)?;
    let metadata = file.metadata()?;
    let mtime_unix_ms = metadata
        .modified()?
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .try_into()
        .unwrap_or(u64::MAX);
    Ok(FileMetadata {
        path: relative_to_string(relative),
        sha256: format!("{:x}", Sha256::digest(&bytes)),
        mtime_unix_ms,
    })
}

fn read_bytes(mut file: File) -> Result<Vec<u8>, WorkspaceError> {
    let mut bytes = Vec::new();
    file.read_to_end(&mut bytes)?;
    Ok(bytes)
}

#[cfg(not(target_os = "linux"))]
fn metadata_for(target: &Path, relative: &Path) -> Result<FileMetadata, WorkspaceError> {
    metadata_for_file(File::open(target)?, relative)
}

#[cfg(target_os = "linux")]
fn safe_resolve_flags() -> ResolveFlags {
    ResolveFlags::BENEATH | ResolveFlags::NO_MAGICLINKS | ResolveFlags::NO_SYMLINKS
}

#[cfg(target_os = "linux")]
fn proc_fd_path(fd: &OwnedFd) -> PathBuf {
    PathBuf::from(format!("/proc/self/fd/{}", fd.as_raw_fd()))
}

fn relative_to_string(path: &Path) -> String {
    path.components()
        .filter_map(|component| match component {
            Component::Normal(value) => Some(value.to_string_lossy()),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("/")
}

#[cfg(not(target_os = "linux"))]
fn sync_directory(directory: &Path) -> io::Result<()> {
    #[cfg(unix)]
    {
        File::open(directory)?.sync_all()
    }
    #[cfg(not(unix))]
    {
        let _ = directory;
        Ok(())
    }
}

#[cfg(test)]
mod pending_write_tests {
    use super::*;

    /// The service records a completed write only after `persist` has already
    /// made the new file visible, so the watcher can observe the change while
    /// the record is still being produced. Under load — the desktop app was
    /// mid-pagination — that gap is wide enough for the service's own write to
    /// be reported as an external change.
    #[test]
    fn suppression_waits_for_an_in_flight_write_to_record() {
        let directory = tempfile::tempdir().expect("temp workspace");
        let service = WorkspaceService::new(directory.path()).expect("workspace service");
        let relative = PathBuf::from("proof.md");
        let observed = FileMetadata {
            path: "proof.md".to_owned(),
            sha256: "abc123".to_owned(),
            mtime_unix_ms: 1_700_000_000_000,
        };

        // The write is in flight: persist has happened, the record has not landed.
        service.begin_pending_write(&relative);

        let late = service.clone();
        let late_relative = relative.clone();
        let late_metadata = observed.clone();
        let recorder = thread::spawn(move || {
            thread::sleep(Duration::from_millis(150));
            late.record_known_write(late_relative.clone(), &late_metadata);
            late.finish_pending_write(&late_relative);
        });

        assert!(
            is_matching_known_write(&service, &relative, &observed),
            "an own write must stay suppressed even when the watcher observes it before the record lands"
        );
        recorder.join().expect("recorder thread");
    }

    /// The wait must not swallow genuine external edits: once no write is in
    /// flight, a change that does not match the recorded write is reported.
    #[test]
    fn suppression_still_reports_a_change_that_does_not_match_the_record() {
        let directory = tempfile::tempdir().expect("temp workspace");
        let service = WorkspaceService::new(directory.path()).expect("workspace service");
        let relative = PathBuf::from("proof.md");
        let written = FileMetadata {
            path: "proof.md".to_owned(),
            sha256: "abc123".to_owned(),
            mtime_unix_ms: 1_700_000_000_000,
        };
        service.record_known_write(relative.clone(), &written);

        let external = FileMetadata {
            sha256: "def456".to_owned(),
            ..written.clone()
        };
        assert!(
            !is_matching_known_write(&service, &relative, &external),
            "a genuine external edit must still be reported"
        );
    }
}
