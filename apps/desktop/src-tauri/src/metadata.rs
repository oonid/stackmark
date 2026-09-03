//! Document identity for the desktop.
//!
//! A document is addressed by an opaque identifier; this maps it to a
//! workspace-relative path. The web layer never sends a path, so a compromised
//! page cannot name a file even inside the workspace it was given.
//!
//! Rust owns the schema and every query. Exposing a general SQL bridge would
//! have been less code and would have handed the webview arbitrary access to
//! application data, widening a capability set ADR 0001 records as
//! load-bearing.

use std::path::Path;
use std::sync::{Mutex, MutexGuard};

use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use uuid::Uuid;

use crate::error::DesktopError;

const SCHEMA_VERSION: i64 = 1;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct DocumentRow {
    pub id: String,
    pub path: String,
    pub sha256: Option<String>,
    pub mtime_unix_ms: Option<i64>,
}

pub struct Metadata {
    connection: Mutex<Connection>,
}

impl Metadata {
    pub fn open(path: &Path) -> Result<Self, DesktopError> {
        let store = Self {
            connection: Mutex::new(Connection::open(path)?),
        };
        store.migrate()?;
        Ok(store)
    }

    pub fn open_in_memory() -> Result<Self, DesktopError> {
        let store = Self {
            connection: Mutex::new(Connection::open_in_memory()?),
        };
        store.migrate()?;
        Ok(store)
    }

    /// Recovers from a poisoned lock rather than propagating it.
    ///
    /// A panic while this was held would otherwise make every later workspace
    /// operation fail forever, turning one fault into a permanently broken
    /// application. The data behind the lock is a database handle, and it is no
    /// less usable because an unrelated call panicked.
    fn connection(&self) -> MutexGuard<'_, Connection> {
        self.connection
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// Applies the schema. Safe to call repeatedly.
    pub fn migrate(&self) -> Result<(), DesktopError> {
        let connection = self.connection();
        let version: i64 = connection.query_row("PRAGMA user_version", [], |row| row.get(0))?;
        if version >= SCHEMA_VERSION {
            return Ok(());
        }

        connection.execute_batch(
            "CREATE TABLE IF NOT EXISTS documents (
                 id         TEXT PRIMARY KEY,
                 path       TEXT NOT NULL UNIQUE,
                 sha256     TEXT,
                 mtime_ms   INTEGER
             );",
        )?;
        connection.pragma_update(None, "user_version", SCHEMA_VERSION)?;
        Ok(())
    }

    pub fn user_version(&self) -> Result<i64, DesktopError> {
        Ok(self
            .connection()
            .query_row("PRAGMA user_version", [], |row| row.get(0))?)
    }

    pub fn insert(&self, path: &str) -> Result<String, DesktopError> {
        let normalized = normalize_workspace_path(path)?;
        let id = Uuid::new_v4().to_string();
        self.connection().execute(
            "INSERT INTO documents (id, path) VALUES (?1, ?2)",
            params![id, normalized],
        )?;
        Ok(id)
    }

    pub fn resolve(&self, id: &str) -> Result<String, DesktopError> {
        self.connection()
            .query_row(
                "SELECT path FROM documents WHERE id = ?1",
                params![id],
                |row| row.get(0),
            )
            .optional()?
            .ok_or(DesktopError::NotFound)
    }

    pub fn rename(&self, id: &str, path: &str) -> Result<(), DesktopError> {
        let normalized = normalize_workspace_path(path)?;
        // The unique index refuses an occupied path, so the original stays
        // where it is rather than two documents claiming one file.
        let changed = self.connection().execute(
            "UPDATE documents SET path = ?2 WHERE id = ?1",
            params![id, normalized],
        )?;
        if changed == 0 {
            return Err(DesktopError::NotFound);
        }
        Ok(())
    }

    pub fn record_write(
        &self,
        id: &str,
        sha256: &str,
        mtime_unix_ms: i64,
    ) -> Result<(), DesktopError> {
        let changed = self.connection().execute(
            "UPDATE documents SET sha256 = ?2, mtime_ms = ?3 WHERE id = ?1",
            params![id, sha256, mtime_unix_ms],
        )?;
        if changed == 0 {
            return Err(DesktopError::NotFound);
        }
        Ok(())
    }

    pub fn remove(&self, id: &str) -> Result<(), DesktopError> {
        let changed = self
            .connection()
            .execute("DELETE FROM documents WHERE id = ?1", params![id])?;
        if changed == 0 {
            return Err(DesktopError::NotFound);
        }
        Ok(())
    }

    pub fn list(&self) -> Result<Vec<DocumentRow>, DesktopError> {
        let connection = self.connection();
        let mut statement =
            connection.prepare("SELECT id, path, sha256, mtime_ms FROM documents ORDER BY path")?;
        let rows = statement
            .query_map([], |row| {
                Ok(DocumentRow {
                    id: row.get(0)?,
                    path: row.get(1)?,
                    sha256: row.get(2)?,
                    mtime_unix_ms: row.get(3)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }
}

/// Normalizes a workspace-relative path, or refuses it.
///
/// The same rules the core applies on the TypeScript side. This is not the
/// security boundary — every resolution is still confined beneath a held root
/// descriptor — but a path is refused before it is stored, so the database
/// never holds one that could not be opened safely.
pub fn normalize_workspace_path(input: &str) -> Result<String, DesktopError> {
    if input.is_empty() {
        return Err(DesktopError::outside_workspace(input));
    }
    if input.starts_with('/') || input.contains('\\') || input.contains('\0') {
        return Err(DesktopError::outside_workspace(input));
    }

    let mut segments = Vec::new();
    for segment in input.split('/') {
        match segment {
            "" | "." => continue,
            ".." => return Err(DesktopError::outside_workspace(input)),
            other => segments.push(other),
        }
    }

    if segments.is_empty() {
        return Err(DesktopError::outside_workspace(input));
    }
    Ok(segments.join("/"))
}
