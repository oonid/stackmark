//! The desktop document identity store.
//!
//! Rust owns the schema and every query. The web layer reaches it only through
//! commands, so it can name a document but never a path, and cannot run
//! arbitrary SQL against application data.

use stackmark_desktop::error::DesktopError;
use stackmark_desktop::metadata::Metadata;

#[test]
fn an_identifier_survives_a_rename() {
    let db = Metadata::open_in_memory().unwrap();
    let id = db.insert("a.md").unwrap();
    db.rename(&id, "b.md").unwrap();
    assert_eq!(db.resolve(&id).unwrap(), "b.md");
}

#[test]
fn resolving_an_unknown_identifier_reports_not_found() {
    let db = Metadata::open_in_memory().unwrap();
    assert!(matches!(db.resolve("nope"), Err(DesktopError::NotFound)));
}

#[test]
fn migrations_are_idempotent() {
    let db = Metadata::open_in_memory().unwrap();
    db.migrate().unwrap();
    db.migrate().unwrap();
    assert_eq!(db.user_version().unwrap(), 1);
}

#[test]
fn a_path_that_escapes_the_workspace_is_refused_before_it_is_stored() {
    let db = Metadata::open_in_memory().unwrap();
    assert!(matches!(
        db.insert("../escape.md"),
        Err(DesktopError::OutsideWorkspace { .. })
    ));
}

#[test]
fn an_absolute_path_is_refused() {
    let db = Metadata::open_in_memory().unwrap();
    assert!(matches!(
        db.insert("/etc/passwd"),
        Err(DesktopError::OutsideWorkspace { .. })
    ));
}

#[test]
fn a_path_is_normalized_before_it_is_stored() {
    let db = Metadata::open_in_memory().unwrap();
    let id = db.insert("notes//./daily.md").unwrap();
    assert_eq!(db.resolve(&id).unwrap(), "notes/daily.md");
}

#[test]
fn two_documents_cannot_occupy_one_path() {
    let db = Metadata::open_in_memory().unwrap();
    db.insert("a.md").unwrap();
    assert!(
        db.insert("a.md").is_err(),
        "the second insert must be refused"
    );
}

#[test]
fn renaming_onto_an_occupied_path_leaves_the_original_where_it_was() {
    let db = Metadata::open_in_memory().unwrap();
    let first = db.insert("a.md").unwrap();
    db.insert("b.md").unwrap();

    assert!(db.rename(&first, "b.md").is_err());
    assert_eq!(db.resolve(&first).unwrap(), "a.md");
}

#[test]
fn a_removed_document_is_gone() {
    let db = Metadata::open_in_memory().unwrap();
    let id = db.insert("a.md").unwrap();
    db.remove(&id).unwrap();
    assert!(matches!(db.resolve(&id), Err(DesktopError::NotFound)));
}

#[test]
fn listing_returns_every_stored_document() {
    let db = Metadata::open_in_memory().unwrap();
    db.insert("a.md").unwrap();
    db.insert("b.md").unwrap();

    let mut paths: Vec<String> = db.list().unwrap().into_iter().map(|row| row.path).collect();
    paths.sort();
    assert_eq!(paths, vec!["a.md".to_string(), "b.md".to_string()]);
}
