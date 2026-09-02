pub mod workspace;

use std::sync::Mutex;

use tauri::{AppHandle, Emitter, State};
use tauri_plugin_dialog::DialogExt;
use workspace::{FileMetadata, WorkspaceService, WorkspaceWatch};

#[derive(Default)]
struct DesktopState {
    workspace: Mutex<Option<WorkspaceService>>,
    watch: Mutex<Option<WorkspaceWatch>>,
}

fn lock_error(name: &str) -> String {
    format!("{name} state is unavailable")
}

/// Opens the folder picker and adopts the chosen directory as the workspace.
///
/// The dialog is opened here rather than in the web layer on purpose. When the
/// frontend picks the folder and then hands the path back, the path is the
/// untrusted side's to choose, and the confinement below it — however carefully
/// built — only ever confines access to a root an attacker could have named.
/// Owning the picker is what makes the root the user's choice, and it lets the
/// webview drop the dialog capability entirely.
#[tauri::command]
async fn choose_workspace(
    app: AppHandle,
    state: State<'_, DesktopState>,
) -> Result<Option<String>, String> {
    let picker = app.clone();
    let picked =
        tauri::async_runtime::spawn_blocking(move || picker.dialog().file().blocking_pick_folder())
            .await
            .map_err(|error| error.to_string())?;

    let Some(selection) = picked else {
        return Ok(None);
    };
    let root = selection
        .into_path()
        .map_err(|error| format!("the chosen folder is not a local path: {error}"))?;

    let workspace = WorkspaceService::new(&root).map_err(|error| error.to_string())?;
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
            choose_workspace,
            read_markdown,
            atomic_write_markdown,
            start_workspace_watch
        ])
        .run(tauri::generate_context!())
        .expect("error while running StackMark desktop proof");
}
