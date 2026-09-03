//! The error every command returns.
//!
//! Commands used to return `Result<T, String>`, so every failure arrived at the
//! web layer as an opaque sentence and callers could not tell a path refused
//! for leaving the workspace from an unexpected fault. Stage 2's conflict
//! workflow turns on telling a stale write from a failed one, and recovering
//! that from message text would be worse than naming it here.
//!
//! The serialized shape matches the `StoreError` union in the platform
//! contracts, so the same categories exist on both sides of the boundary.

use serde::Serialize;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type, thiserror::Error)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum DesktopError {
    /// The path escapes the workspace, or is not a path this application will
    /// accept. Refused before anything touches the filesystem.
    #[error("path is outside the workspace: {path}")]
    OutsideWorkspace { path: String },

    /// No document with that identifier.
    #[error("no such document")]
    NotFound,

    /// The file changed since it was last read, so writing would discard
    /// somebody else's work.
    #[error("the file changed underneath us")]
    ChangedUnderneath,

    /// Anything not worth a category of its own. The message is for a log, not
    /// for a caller to parse.
    #[error("{message}")]
    Unexpected { message: String },
}

impl DesktopError {
    pub fn unexpected(message: impl Into<String>) -> Self {
        Self::Unexpected {
            message: message.into(),
        }
    }

    pub fn outside_workspace(path: impl Into<String>) -> Self {
        Self::OutsideWorkspace { path: path.into() }
    }
}

impl From<rusqlite::Error> for DesktopError {
    fn from(error: rusqlite::Error) -> Self {
        Self::unexpected(error.to_string())
    }
}
