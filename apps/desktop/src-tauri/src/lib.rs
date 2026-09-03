pub mod commands;
pub mod error;
pub mod metadata;
pub mod workspace;

use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};

use tauri::Manager;
use workspace::{WorkspaceService, WorkspaceWatch};

/// The event the watcher emits. Named once so the Rust side and the generated
/// bindings cannot disagree about it.
pub const EXTERNAL_CHANGE_EVENT: &str = "workspace://external-change";

#[derive(Default)]
pub struct DesktopState {
    pub workspace: Mutex<Option<WorkspaceService>>,
    pub watch: Mutex<Option<WorkspaceWatch>>,
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
}

/// Adopts `root` as the workspace, dropping any watch on the previous one.
///
/// Both the folder picker and the startup path argument arrive here, so
/// confinement is established the same way whichever named the directory.
pub fn adopt_workspace(state: &DesktopState, root: &Path) -> Result<Option<String>, String> {
    let workspace = WorkspaceService::new(root).map_err(|error| error.to_string())?;
    state.watch_guard().take();
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
    tauri_specta::Builder::<tauri::Wry>::new().commands(tauri_specta::collect_commands![
        commands::choose_workspace,
        commands::current_workspace,
        commands::read_markdown,
        commands::atomic_write_markdown,
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
                adopt_workspace(&app.state::<DesktopState>(), &root)?;
            }
            Ok(())
        })
        .invoke_handler(builder.invoke_handler())
        .run(tauri::generate_context!())
        .expect("error while running StackMark desktop");
}
