//! Acceptance criterion 4, enforced rather than asserted in prose.
//!
//! Documents are addressed by identifier. `create_document` and
//! `rename_document` take a workspace-relative logical path, because choosing a
//! location is what those operations are; everything else must not, and no
//! command may take a workspace root. The web layer therefore cannot name the
//! directory its own file access is confined to, which is the property ADR 0001
//! decision 4 establishes and this test keeps.
//!
//! It reads signatures rather than the whole file. Matching raw text also
//! matches prose, and a test that a comment can fail is a test people learn to
//! edit around.

const SOURCE: &str = include_str!("../src/commands.rs");

/// Every command's name and parameter list, taken from the annotation onwards
/// so that documentation above it is never examined.
fn signatures() -> Vec<(String, String)> {
    let mut found = Vec::new();
    for block in SOURCE.split("#[specta::specta]").skip(1) {
        let start = match block
            .find("pub fn ")
            .or_else(|| block.find("pub async fn "))
        {
            Some(index) => index,
            None => continue,
        };
        let rest = &block[start..];
        let open = rest.find('(').expect("a signature without parameters");
        let close = rest.find(')').expect("an unterminated parameter list");
        let name = rest[..open]
            .trim_start_matches("pub async fn ")
            .trim_start_matches("pub fn ")
            .trim()
            .to_string();
        let end = rest.find(" {").expect("an unterminated signature");
        found.push((name, rest[open..close].to_string() + &rest[close..end]));
    }
    found
}

#[test]
fn every_command_was_found() {
    let names: Vec<String> = signatures().into_iter().map(|(name, _)| name).collect();
    assert_eq!(names.len(), 9, "expected nine commands, found {names:?}");
}

#[test]
fn only_creating_and_renaming_accept_a_path() {
    for (name, signature) in signatures() {
        let takes_path = signature.contains("path: String");
        let expected = matches!(name.as_str(), "create_document" | "rename_document");
        assert_eq!(
            takes_path, expected,
            "`{name}` takes a path: {takes_path}, expected {expected}. Documents are \
             addressed by identifier; only choosing a location needs a path."
        );
    }
}

#[test]
fn no_command_accepts_a_workspace_root() {
    for (name, signature) in signatures() {
        for forbidden in ["root:", "PathBuf", "directory:", "&Path"] {
            assert!(
                !signature.contains(forbidden),
                "`{name}` accepts `{forbidden}`; the workspace root comes from the \
                 picker or the startup argument, never from the page"
            );
        }
    }
}

#[test]
fn every_command_returns_the_tagged_error() {
    for (name, signature) in signatures() {
        assert!(
            signature.contains("DesktopError>"),
            "`{name}` must return Result<_, DesktopError>; an opaque string leaves a \
             caller unable to tell a refused path from an unexpected fault: {signature}"
        );
    }
}
