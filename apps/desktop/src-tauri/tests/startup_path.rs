//! The startup path argument.
//!
//! The folder picker cannot be driven by a WebDriver session, so the round-trip
//! test needs another way to give the application a workspace. A path supplied
//! by whoever launched the process preserves the property that matters: the page
//! never names it. Opening a folder from the shell is ordinary for a desktop
//! editor, so this is a feature rather than a test hook.

use std::fs;

#[test]
fn a_file_is_not_a_workspace_root() {
    let file = tempfile::NamedTempFile::new().unwrap();
    let result = stackmark_desktop::adopt_startup_path(file.path());
    assert!(
        result.is_err(),
        "a regular file must not be adopted as a workspace root"
    );
}

#[test]
fn a_directory_is_adopted_and_canonicalized() {
    let directory = tempfile::tempdir().unwrap();
    let nested = directory.path().join("inner");
    fs::create_dir(&nested).unwrap();

    // A path reached through `..` must resolve to the same root as the direct
    // path, so confinement is established against the real directory rather
    // than the spelling the caller used.
    let indirect = nested.join("..");
    let adopted = stackmark_desktop::adopt_startup_path(&indirect).unwrap();
    assert_eq!(adopted, directory.path().canonicalize().unwrap());
}

#[test]
fn a_missing_path_is_refused() {
    let directory = tempfile::tempdir().unwrap();
    let missing = directory.path().join("absent");
    assert!(stackmark_desktop::adopt_startup_path(&missing).is_err());
}
