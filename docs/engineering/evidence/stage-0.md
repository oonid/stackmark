# Stage 0 evidence

Evidence is recorded against the isolated `feat/stage-zero` worktree. JavaScript commands run only through the Docker-backed `./dev` wrapper; Rust commands run host-native with the repository-pinned toolchain.

## Task 6 — scoped Tauri workspace operations

Automated gates completed on 2026-08-05:

- `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml` — PASS, 7 Rust tests across 4 suites.
- `cargo fmt --manifest-path apps/desktop/src-tauri/Cargo.toml -- --check` — PASS with Rust 1.88.0 rustfmt.
- `./dev unit` — PASS, 35 tests: 16 Markdown/SVG, 8 print, and 11 web/desktop-adapter tests.
- `./dev e2e` — PASS, 7 Chromium tests, including Mermaid isolation/security, paginated and fallback printing, native print-source PDF generation, and the dark-mode Mermaid print palette.
- `./dev lint` — PASS, including `vue-tsc --noEmit` and ESLint.
- `./dev frontend-build` — PASS. The existing Paged.js-related large-chunk warning remains; no new build error was introduced.
- `git diff --check` — PASS.

The Rust tests prove validated relative Markdown paths, absolute and parent-path rejection, Linux symlink-escape rejection, atomic replacement, preservation after an interrupted temporary write, removal of temporary files, normalized external-change metadata, and bounded own-write suppression. The frontend tests prove ordinary-browser unsupported behavior and the single adapter boundary for folder selection, the four proof commands, and external-change events.

### KDE neon host smoke

Status: **PASS** on 2026-08-05, confirmed interactively by the user on KDE neon.

Commands and environment:

1. Started the Docker frontend with `./dev frontend-dev`; Vite served `http://localhost:1420`.
2. From `apps/desktop`, ran host-native `cargo tauri dev`; the Tauri/WebKitGTK window launched successfully.
3. Selected the isolated folder `/tmp/stackedit-stage0-smoke.06IVbD` and saved `stage-zero-proof.md`.

Observed results:

- The desktop proof displayed the save SHA-256 and epoch modification time. The file initially hashed to `c1e46f757540d49c13856075e3894d281605475703e57974a9978849eb4de6b9`.
- KaTeX rendered `E = mc²`, and the sanitized Mermaid preview rendered correctly.
- The native print button opened the KDE print dialog and exported a PDF.
- The first dark-mode print inspection exposed a real defect: sanitizer-safe Mermaid SVG lost component-scoped colors in the separate print handoff, producing a black node and an unclear edge. A focused Playwright regression reproduced `fill: rgb(0, 0, 0)` and `stroke: none`.
- The fix adds an explicit light-paper Mermaid palette owned by the print document. After Vite hot reload, the user confirmed that the diagram-handoff node, edge, and arrow rendered correctly in the Tauri view and native print dialog. The focused dark-mode regression passed.
- Kate appended `External edit smoke: passed`. The watched file then hashed to `dfe9e7251c1055b7642cec3e979e2726788d23c1ec3fdc97c953c425e81daaac`, and the desktop proof displayed the external event with a hash distinct from the save hash.

The Tauri smoke gate, WebKitGTK rendering gate, native print-dialog gate, atomic-save metadata gate, and Kate external-change gate all passed.
