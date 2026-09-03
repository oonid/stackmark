//! Every command the web layer can reach.
//!
//! They live in one module so the generated bindings and the capability file
//! have a single place to be checked against. Each command is annotated for
//! generation: a rename here changes `bindings.ts`, and continuous integration
//! fails when the committed file no longer matches.
//!
//! Documents are addressed by an opaque identifier. Only creating and renaming
//! take a path, because choosing a location is what those operations are, and
//! it is a workspace-relative logical path that is normalized and refused
//! before anything reaches the filesystem. No command takes a workspace root:
//! that comes from the picker the application owns, or from the path the
//! process was launched with, never from the page.

use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_dialog::DialogExt;

use crate::error::DesktopError;
use crate::metadata::{DocumentRow, Metadata};
use crate::workspace::{FileMetadata, WorkspaceService};
use crate::DesktopState;

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
) -> Result<Option<String>, DesktopError> {
    let picker = app.clone();
    let picked =
        tauri::async_runtime::spawn_blocking(move || picker.dialog().file().blocking_pick_folder())
            .await
            .map_err(|error| DesktopError::unexpected(error.to_string()))?;

    let Some(selection) = picked else {
        return Ok(None);
    };
    let root = selection
        .into_path()
        .map_err(|error| DesktopError::unexpected(error.to_string()))?;
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| DesktopError::unexpected(error.to_string()))?;

    crate::adopt_workspace(&state, &root, &data_dir)
}

/// The workspace already adopted, if there is one.
///
/// A root can be adopted before the interface exists — the startup path
/// argument does exactly that — and re-asking the user to pick a folder they
/// already named would be wrong. It returns a path but cannot set one.
#[tauri::command]
#[specta::specta]
pub fn current_workspace(state: State<'_, DesktopState>) -> Result<Option<String>, DesktopError> {
    Ok(state
        .workspace_guard()
        .as_ref()
        .map(|workspace| workspace.root().display().to_string()))
}

#[tauri::command]
#[specta::specta]
pub fn list_documents(state: State<'_, DesktopState>) -> Result<Vec<DocumentRow>, DesktopError> {
    with_metadata(&state, |metadata| metadata.list())
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub fn read_document(id: String, state: State<'_, DesktopState>) -> Result<String, DesktopError> {
    let relative = with_metadata(&state, |metadata| metadata.resolve(&id))?;
    let workspace = require_workspace(&state)?;
    let bytes = workspace
        .read_markdown(relative)
        .map_err(|error| DesktopError::unexpected(error.to_string()))?;
    String::from_utf8(bytes)
        .map_err(|_| DesktopError::unexpected("Markdown file is not valid UTF-8"))
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub fn write_document(
    id: String,
    contents: String,
    state: State<'_, DesktopState>,
) -> Result<FileMetadata, DesktopError> {
    let relative = with_metadata(&state, |metadata| metadata.resolve(&id))?;
    let workspace = require_workspace(&state)?;
    let written = workspace
        .atomic_write_markdown(relative, contents.as_bytes())
        .map_err(|error| DesktopError::unexpected(error.to_string()))?;

    // Recorded only after the write succeeded, so a failed write leaves the
    // last known good hash in place rather than a hash of bytes never stored.
    with_metadata(&state, |metadata| {
        metadata.record_write(&id, &written.sha256, written.mtime_unix_ms as i64)
    })?;
    Ok(written)
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub fn create_document(
    path: String,
    contents: String,
    state: State<'_, DesktopState>,
) -> Result<DocumentRow, DesktopError> {
    // Registering first means the path is normalized and refused, and the
    // unique index has claimed it, before anything touches the filesystem.
    let id = with_metadata(&state, |metadata| metadata.insert(&path))?;
    let relative = with_metadata(&state, |metadata| metadata.resolve(&id))?;

    let workspace = require_workspace(&state)?;
    match workspace.atomic_write_markdown(relative.clone(), contents.as_bytes()) {
        Ok(written) => {
            with_metadata(&state, |metadata| {
                metadata.record_write(&id, &written.sha256, written.mtime_unix_ms as i64)
            })?;
            Ok(DocumentRow {
                id,
                path: relative,
                sha256: Some(written.sha256),
                mtime_unix_ms: Some(written.mtime_unix_ms as i64),
            })
        }
        Err(error) => {
            // Otherwise the database would claim a path that has no file, and
            // the name could never be used again.
            let _ = with_metadata(&state, |metadata| metadata.remove(&id));
            Err(DesktopError::unexpected(error.to_string()))
        }
    }
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub fn rename_document(
    id: String,
    path: String,
    state: State<'_, DesktopState>,
) -> Result<(), DesktopError> {
    let from = with_metadata(&state, |metadata| metadata.resolve(&id))?;

    // The register is updated first: its unique index is what refuses an
    // occupied path, and learning that before the file has moved means nothing
    // has to be undone. If the move then fails, the register is put back, so
    // the two never disagree about where the document is.
    with_metadata(&state, |metadata| metadata.rename(&id, &path))?;
    let to = with_metadata(&state, |metadata| metadata.resolve(&id))?;

    let workspace = require_workspace(&state)?;
    if let Err(error) = workspace.rename_markdown(&from, &to) {
        let _ = with_metadata(&state, |metadata| metadata.rename(&id, &from));
        return Err(DesktopError::unexpected(error.to_string()));
    }
    Ok(())
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub fn remove_document(id: String, state: State<'_, DesktopState>) -> Result<(), DesktopError> {
    with_metadata(&state, |metadata| metadata.remove(&id))
}

#[tauri::command]
#[specta::specta]
pub fn start_workspace_watch(
    app: AppHandle,
    state: State<'_, DesktopState>,
) -> Result<(), DesktopError> {
    let workspace = require_workspace(&state)?;
    let watch = workspace
        .start_workspace_watch(move |event| {
            let _ = app.emit_to("main", crate::EXTERNAL_CHANGE_EVENT, event);
        })
        .map_err(|error| DesktopError::unexpected(error.to_string()))?;
    *state.watch_guard() = Some(watch);
    Ok(())
}

fn require_workspace(state: &State<'_, DesktopState>) -> Result<WorkspaceService, DesktopError> {
    state
        .workspace_guard()
        .clone()
        .ok_or_else(|| DesktopError::unexpected("choose a workspace first"))
}

fn with_metadata<T>(
    state: &State<'_, DesktopState>,
    work: impl FnOnce(&Metadata) -> Result<T, DesktopError>,
) -> Result<T, DesktopError> {
    let guard = state.metadata_guard();
    let metadata = guard
        .as_ref()
        .ok_or_else(|| DesktopError::unexpected("choose a workspace first"))?;
    work(metadata)
}
