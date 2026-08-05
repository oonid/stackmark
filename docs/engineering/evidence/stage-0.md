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

## Task 6 post-review hardening and print-preview decision — IN PROGRESS

The initial `18e4a58a` implementation received a fresh independent review. It found four Important issues: production risk from the inline `srcdoc` Mermaid renderer under the Tauri CSP, excess `core:default` capability, incomplete own-write watcher matching, and a symlink-swap race between path validation and persistence. The current uncommitted work addresses all four, but it has not received scoped re-review.

Interim automated evidence after hardening:

- Expanded host-native Rust suite: 11 tests passed, including descriptor-relative Linux access, deterministic rename/symlink-swap rejection, exact hash/mtime own-write suppression, same-content external changes with a different mtime, watcher drop, and watcher restart.
- Docker browser suite: 9 tests passed before the page-count assertion was strengthened. This result is superseded for completion purposes because the old assertion accepted any count of at least two pages.
- Focused Mermaid CSP and WebKitGTK smoke: the first external renderer with `script-src 'self'` timed out in WebKitGTK; the nonce-based external renderer then passed in Chromium and was confirmed by the user in Tauri preview, print proof, and PDF.
- Narrow Tauri event/dialog capability: folder dialog, metadata, and watcher delivery passed host smoke after removing `core:default`.
- External edit proof: `/tmp/stackedit-stage0-rereview.MwumyC/stage-zero-proof.md` changed to SHA-256 `3b6fbe32a06a1a93a51b29faf4f8a0e11b75715cbb7819e07a685f4d2414daa4`; the user confirmed the exact hash and external-change event.
- Natural Mermaid print size: after correcting the renderer's display-none geometry, the proof SVG viewBox is approximately `133.3515625 × 160`. The user confirmed the small diagram remains on PDF page 2 with correct light-paper colors and arrows.

Current unresolved print-preview evidence:

- Paged.js 0.4.3 screen output produces six pages for the fixture while the automated native PDF contains two pages. Diagnostic page text lengths were `[484, 742, 682, 604, 386, 0]`; the last page is diagram-only.
- Paged.js generated default Letter-sized page geometry (`816 × 1056` CSS pixels) rather than the requested A4 geometry.
- Inline SVG at a page boundary triggered Paged.js null-reference break-token failures; the hidden Paged staging clone now uses an atomic local SVG image while the native print source remains inline sanitized vector SVG.
- Passing the Vite CSS URL did not change page geometry; the working but unconfirmed diagnosis is that Vite's development CSS-module response was not usable as raw CSS by Paged.js. Passing raw CSS through Paged.js's supported stylesheet-object path triggered a different internal layout null reference. Both experiments were removed.
- The generated Chromium native PDF has exactly two pages but `pdfinfo` reported Letter (`612 × 792 pt`), so automated A4 correctness remains unproven. The KDE-exported PDF content was visually correct, but its dimensions were not recorded.
- The strengthened exact-page regression is intentionally RED: expected two populated `.pagedjs_page` elements, received six. Therefore Task 6 and the complete browser suite must not be reported green.

The detailed experiment log, risks, alternatives, and continuation commands are recorded in `docs/engineering/handoffs/2026-08-05-stage-0-task-6-print-tauri.md`. The recommended Stage 0 fallback is a native-authoritative continuous screen proof with system print/PDF as the only authoritative pagination path. Paged.js may instead be feature-gated, patched, or replaced only after an explicit architectural decision.
