//! Renaming must move the file and the register together.
//!
//! A rename that changed only the register left the document pointing at a
//! path with no file behind it. The round-trip against the built binary found
//! that; no unit test could, because each half worked in isolation.

use std::fs;

use stackmark_desktop::workspace::WorkspaceService;

fn workspace() -> (tempfile::TempDir, WorkspaceService) {
    let directory = tempfile::tempdir().unwrap();
    let service = WorkspaceService::new(directory.path()).unwrap();
    (directory, service)
}

#[test]
fn the_file_moves_with_the_name() {
    let (directory, service) = workspace();
    service.atomic_write_markdown("a.md", b"content").unwrap();

    service.rename_markdown("a.md", "b.md").unwrap();

    assert!(
        !directory.path().join("a.md").exists(),
        "the old name survived"
    );
    assert_eq!(
        fs::read_to_string(directory.path().join("b.md")).unwrap(),
        "content"
    );
}

#[test]
fn a_rename_out_of_the_workspace_is_refused() {
    let (directory, service) = workspace();
    service.atomic_write_markdown("a.md", b"content").unwrap();

    assert!(service.rename_markdown("a.md", "../escaped.md").is_err());
    assert!(
        directory.path().join("a.md").exists(),
        "the file was moved anyway"
    );
}

#[test]
fn renaming_something_that_is_not_there_fails() {
    let (_directory, service) = workspace();
    assert!(service.rename_markdown("absent.md", "b.md").is_err());
}

#[test]
fn a_non_markdown_target_is_refused() {
    let (directory, service) = workspace();
    service.atomic_write_markdown("a.md", b"content").unwrap();

    assert!(service.rename_markdown("a.md", "a.sh").is_err());
    assert!(directory.path().join("a.md").exists());
}
