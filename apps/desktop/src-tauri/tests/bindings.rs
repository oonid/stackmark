//! Exports the TypeScript bindings and, in continuous integration, proves the
//! committed file still matches the Rust definitions.
//!
//! Generation runs as a test rather than a build script so it cannot be skipped
//! and so a stale file is a failure rather than a silent regeneration. The
//! workflow runs `git diff --exit-code` on the output after this test.

use specta_typescript::{BigIntExportBehavior, Typescript};

const OUTPUT: &str = "../../../packages/platform/src/tauri/bindings.ts";

#[test]
fn bindings_match_the_committed_file() {
    // `mtimeUnixMs` is a u64, which the generator refuses to map to a JavaScript
    // number without being told to: a u64 can exceed Number.MAX_SAFE_INTEGER and
    // would lose precision silently. A millisecond timestamp cannot — it stays
    // inside the safe range until the year 287396 — so the narrowing is chosen
    // here explicitly rather than happening by accident, which is what the
    // hand-written types did before.
    let typescript = Typescript::default().bigint(BigIntExportBehavior::Number);
    stackmark_desktop::specta_builder()
        .export(typescript, OUTPUT)
        .expect("exporting the TypeScript bindings failed");
}
