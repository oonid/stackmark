pub mod commands;
pub mod error;
pub mod metadata;
pub mod workspace;

use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};

use sha2::{Digest, Sha256};
use tauri::Manager;

use crate::error::DesktopError;
use crate::metadata::Metadata;
use workspace::{WorkspaceService, WorkspaceWatch};

/// The event the watcher emits. Named once so the Rust side and the generated
/// bindings cannot disagree about it.
pub const EXTERNAL_CHANGE_EVENT: &str = "workspace://external-change";

#[derive(Default)]
pub struct DesktopState {
    pub workspace: Mutex<Option<WorkspaceService>>,
    pub watch: Mutex<Option<WorkspaceWatch>>,
    pub metadata: Mutex<Option<Metadata>>,
}

impl DesktopState {
    /// The adopted workspace, recovering from a poisoned lock.
    ///
    /// A panic inside a critical section poisons the mutex, and propagating
    /// that made every later workspace operation fail for the life of the
    /// process -- one fault became a permanently broken application. The data
    /// behind the lock is a handle that is no less valid because an unrelated
    /// call panicked, so recovery is correct rather than merely convenient.
    pub fn workspace_guard(&self) -> MutexGuard<'_, Option<WorkspaceService>> {
        self.workspace
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    pub fn watch_guard(&self) -> MutexGuard<'_, Option<WorkspaceWatch>> {
        self.watch
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    pub fn metadata_guard(&self) -> MutexGuard<'_, Option<Metadata>> {
        self.metadata
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

/// Where a workspace's identity database lives.
///
/// Named by a digest of the canonical root, so a workspace keeps its document
/// identifiers across sessions, and two workspaces never share a database. It
/// lives in application data rather than in the user's folder: the design says
/// the application does not create hidden files in a workspace.
pub fn metadata_path(data_dir: &Path, root: &Path) -> PathBuf {
    let digest = Sha256::digest(root.as_os_str().as_encoded_bytes());
    let name = digest
        .iter()
        .take(16)
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    data_dir.join("workspaces").join(format!("{name}.sqlite3"))
}

/// Adopts `root` as the workspace, dropping any watch on the previous one.
///
/// Both the folder picker and the startup path argument arrive here, so
/// confinement is established the same way whichever named the directory.
pub fn adopt_workspace(
    state: &DesktopState,
    root: &Path,
    data_dir: &Path,
) -> Result<Option<String>, DesktopError> {
    let workspace =
        WorkspaceService::new(root).map_err(|error| DesktopError::unexpected(error.to_string()))?;

    let database = metadata_path(data_dir, root);
    if let Some(parent) = database.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|error| DesktopError::unexpected(error.to_string()))?;
    }
    let metadata = Metadata::open(&database)?;

    // The watch belongs to the previous root, so it is dropped before anything
    // else changes rather than being left to report on a folder nobody is
    // looking at.
    state.watch_guard().take();
    *state.metadata_guard() = Some(metadata);
    *state.workspace_guard() = Some(workspace);
    Ok(Some(root.display().to_string()))
}

/// Validates a workspace root supplied on the command line.
///
/// The path is canonicalized before anything else, so confinement is established
/// against the real directory rather than the spelling the caller used. It comes
/// from whoever launched the process, never from the page, which is the same
/// trust level as a folder the user picked in the dialog.
pub fn adopt_startup_path(path: &Path) -> Result<PathBuf, String> {
    let canonical = path
        .canonicalize()
        .map_err(|error| format!("cannot open {}: {error}", path.display()))?;
    if !canonical.is_dir() {
        return Err(format!("{} is not a directory", canonical.display()));
    }
    Ok(canonical)
}

/// The command set, collected once. The test in `tests/bindings.rs` exports it,
/// and `run` registers it, so a command cannot be generated without being
/// reachable or reachable without being generated.
pub fn specta_builder() -> tauri_specta::Builder<tauri::Wry> {
    tauri_specta::Builder::<tauri::Wry>::new()
        // The watcher event name is generated too, so changing it here changes
        // bindings.ts and continuous integration fails on the stale file. Task 1
        // left this uncovered: a renamed event was still silent.
        .constant("EXTERNAL_CHANGE_EVENT", EXTERNAL_CHANGE_EVENT)
        .commands(tauri_specta::collect_commands![
            commands::choose_workspace,
            commands::current_workspace,
            commands::list_documents,
            commands::read_document,
            commands::write_document,
            commands::create_document,
            commands::rename_document,
            commands::remove_document,
            commands::start_workspace_watch,
        ])
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = specta_builder();
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(DesktopState::default())
        .setup(|app| {
            // An optional workspace path, so a folder can be opened from the
            // shell. Refusing loudly beats starting with no workspace and no
            // explanation.
            if let Some(argument) = std::env::args_os().nth(1) {
                let requested = PathBuf::from(argument);
                let root = adopt_startup_path(&requested)?;
                let data_dir = app
                    .path()
                    .app_data_dir()
                    .map_err(|error| error.to_string())?;
                adopt_workspace(&app.state::<DesktopState>(), &root, &data_dir)
                    .map_err(|error| error.to_string())?;
            }
            Ok(())
        })
        .invoke_handler(builder.invoke_handler())
        .run(tauri::generate_context!())
        .expect("error while running StackMark desktop");
}
