pub mod workspace;

use std::{path::PathBuf, sync::Mutex};

use tauri::{AppHandle, Emitter, State};
use workspace::{FileMetadata, WorkspaceService, WorkspaceWatch};

#[derive(Default)]
struct DesktopState {
    workspace: Mutex<Option<WorkspaceService>>,
    watch: Mutex<Option<WorkspaceWatch>>,
}

fn lock_error(name: &str) -> String {
    format!("{name} state is unavailable")
}

#[tauri::command(rename_all = "camelCase")]
fn set_workspace_root(root: PathBuf, state: State<'_, DesktopState>) -> Result<(), String> {
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
    Ok(())
}

#[tauri::command(rename_all = "camelCase")]
fn read_markdown(path: String, state: State<'_, DesktopState>) -> Result<String, String> {
    let workspace = state
        .workspace
        .lock()
        .map_err(|_| lock_error("workspace"))?
        .clone()
        .ok_or_else(|| "choose a workspace first".to_owned())?;
    let bytes = workspace
        .read_markdown(path)
        .map_err(|error| error.to_string())?;
    String::from_utf8(bytes).map_err(|_| "Markdown file is not valid UTF-8".to_owned())
}

#[tauri::command(rename_all = "camelCase")]
fn atomic_write_markdown(
    path: String,
    contents: String,
    state: State<'_, DesktopState>,
) -> Result<FileMetadata, String> {
    let workspace = state
        .workspace
        .lock()
        .map_err(|_| lock_error("workspace"))?
        .clone()
        .ok_or_else(|| "choose a workspace first".to_owned())?;
    workspace
        .atomic_write_markdown(path, contents.as_bytes())
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn start_workspace_watch(app: AppHandle, state: State<'_, DesktopState>) -> Result<(), String> {
    let workspace = state
        .workspace
        .lock()
        .map_err(|_| lock_error("workspace"))?
        .clone()
        .ok_or_else(|| "choose a workspace first".to_owned())?;
    let watch = workspace
        .start_workspace_watch(move |event| {
            let _ = app.emit_to("main", "workspace://external-change", event);
        })
        .map_err(|error| error.to_string())?;
    *state
        .watch
        .lock()
        .map_err(|_| lock_error("workspace watch"))? = Some(watch);
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(DesktopState::default())
        .invoke_handler(tauri::generate_handler![
            set_workspace_root,
            read_markdown,
            atomic_write_markdown,
            start_workspace_watch
        ])
        .run(tauri::generate_context!())
        .expect("error while running StackMark desktop proof");
}
