use std::{
    collections::{HashMap, HashSet},
    fs::{self, File},
    io::{self, Read, Write},
    path::{Component, Path, PathBuf},
    sync::{mpsc, Arc, Mutex},
    thread::{self, JoinHandle},
    time::{Duration, Instant, UNIX_EPOCH},
};

#[cfg(target_os = "linux")]
use std::os::fd::{AsRawFd, OwnedFd};

use notify::{Event, RecommendedWatcher, RecursiveMode, Watcher};
#[cfg(target_os = "linux")]
use rustix::fs::{fstat, open, openat2, Mode, OFlags, ResolveFlags};
use serde::Serialize;
use sha2::{Digest, Sha256};
use tempfile::NamedTempFile;
use thiserror::Error;

const WATCH_DEBOUNCE: Duration = Duration::from_millis(75);
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
            temporary
                .persist(&target)
                .map_err(|error| WorkspaceError::Io(error.error))?;
            sync_directory(&canonical_parent)?;

            let metadata = metadata_for(&target, &relative)?;
            self.record_known_write(relative, &metadata);
            Ok(metadata)
        }
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
        temporary
            .persist(&target)
            .map_err(|error| WorkspaceError::Io(error.error))?;
        File::from(rustix::io::dup(&parent_fd).map_err(io::Error::from)?).sync_all()?;
        self.ensure_same_directory(parent_relative, &parent_fd, &relative)?;

        let file = openat2(
            &parent_fd,
            file_name,
            OFlags::RDONLY | OFlags::CLOEXEC | OFlags::NOFOLLOW,
            Mode::empty(),
            safe_resolve_flags(),
        )
        .map_err(io::Error::from)?;
        let metadata = metadata_for_file(File::from(file), &relative)?;
        self.record_known_write(relative, &metadata);
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
        loop {
            match receiver.recv_timeout(WATCH_DEBOUNCE) {
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
            if is_matching_known_write(&service.known_writes, &relative, &metadata) {
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
        .map(|event| event.paths.into_iter().collect())
        .unwrap_or_default()
}

fn is_matching_known_write(
    known_writes: &Mutex<HashMap<PathBuf, KnownWrite>>,
    relative: &Path,
    metadata: &FileMetadata,
) -> bool {
    let mut writes = known_writes.lock().expect("known writes lock");
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
