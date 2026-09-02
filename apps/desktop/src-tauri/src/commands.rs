//! Every command the web layer can reach.
//!
//! They live in one module so the generated bindings and the capability file
//! have a single place to be checked against. Each command is annotated for
//! generation: a rename here changes `bindings.ts`, and continuous integration
//! fails when the committed file no longer matches.

use tauri::{AppHandle, Emitter, State};
use tauri_plugin_dialog::DialogExt;

use crate::workspace::{FileMetadata, WorkspaceService};
use crate::{lock_error, DesktopState};

/// Opens the folder picker and adopts the chosen directory as the workspace.
///
/// The dialog is opened here rather than in the web layer on purpose. When the
/// frontend picks the folder and then hands the path back, the path is the
/// untrusted side's to choose, and the confinement below it — however carefully
/// built — only ever confines access to a root an attacker could have named.
/// Owning the picker is what makes the root the user's choice, and it lets the
/// webview drop the dialog capability entirely.
#[tauri::command]
#[specta::specta]
pub async fn choose_workspace(
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

    crate::adopt_workspace(&state, &root)
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub fn read_markdown(path: String, state: State<'_, DesktopState>) -> Result<String, String> {
    let workspace = current_workspace(&state)?;
    let bytes = workspace
        .read_markdown(path)
        .map_err(|error| error.to_string())?;
    String::from_utf8(bytes).map_err(|_| "Markdown file is not valid UTF-8".to_owned())
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub fn atomic_write_markdown(
    path: String,
    contents: String,
    state: State<'_, DesktopState>,
) -> Result<FileMetadata, String> {
    let workspace = current_workspace(&state)?;
    workspace
        .atomic_write_markdown(path, contents.as_bytes())
        .map_err(|error| error.to_string())
}

#[tauri::command]
#[specta::specta]
pub fn start_workspace_watch(app: AppHandle, state: State<'_, DesktopState>) -> Result<(), String> {
    let workspace = current_workspace(&state)?;
    let watch = workspace
        .start_workspace_watch(move |event| {
            let _ = app.emit_to("main", crate::EXTERNAL_CHANGE_EVENT, event);
        })
        .map_err(|error| error.to_string())?;
    *state
        .watch
        .lock()
        .map_err(|_| lock_error("workspace watch"))? = Some(watch);
    Ok(())
}

fn current_workspace(state: &State<'_, DesktopState>) -> Result<WorkspaceService, String> {
    state
        .workspace
        .lock()
        .map_err(|_| lock_error("workspace"))?
        .clone()
        .ok_or_else(|| "choose a workspace first".to_owned())
}
