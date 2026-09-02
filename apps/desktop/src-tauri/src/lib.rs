pub mod commands;
pub mod workspace;

use std::path::Path;
use std::sync::Mutex;

use tauri::State;
use workspace::{WorkspaceService, WorkspaceWatch};

/// The event the watcher emits. Named once so the Rust side and the generated
/// bindings cannot disagree about it.
pub const EXTERNAL_CHANGE_EVENT: &str = "workspace://external-change";

#[derive(Default)]
pub struct DesktopState {
    pub workspace: Mutex<Option<WorkspaceService>>,
    pub watch: Mutex<Option<WorkspaceWatch>>,
}

pub fn lock_error(name: &str) -> String {
    format!("{name} state is unavailable")
}

/// Adopts `root` as the workspace, dropping any watch on the previous one.
///
/// Both the folder picker and the startup path argument arrive here, so
/// confinement is established the same way whichever named the directory.
pub fn adopt_workspace(
    state: &State<'_, DesktopState>,
    root: &Path,
) -> Result<Option<String>, String> {
    let workspace = WorkspaceService::new(root).map_err(|error| error.to_string())?;
    state
        .watch
        .lock()
        .map_err(|_| lock_error("workspace watch"))?
        .take();
    *state
        .workspace
        .lock()
        .map_err(|_| lock_error("workspace"))? = Some(workspace);
    Ok(Some(root.display().to_string()))
}

/// The command set, collected once. The test in `tests/bindings.rs` exports it,
/// and `run` registers it, so a command cannot be generated without being
/// reachable or reachable without being generated.
pub fn specta_builder() -> tauri_specta::Builder<tauri::Wry> {
    tauri_specta::Builder::<tauri::Wry>::new().commands(tauri_specta::collect_commands![
        commands::choose_workspace,
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
        .invoke_handler(builder.invoke_handler())
        .run(tauri::generate_context!())
        .expect("error while running StackMark desktop");
}
