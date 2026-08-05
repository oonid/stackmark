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

### Corrected print root-cause analysis (2026-08-05, later session)

The earlier print diagnosis below is superseded. Three failures had been attributed to Paged.js fragility. Two were caused by this repository's own use of the library, and only the third is an upstream defect.

1. **Letter screen geometry and missing generated margin boxes — our bug.** `paginate()` called `previewer.preview(source, [], target)`. In `pagedjs/src/polyfill/previewer.js` the guard is `if (!stylesheets) { stylesheets = this.removeStyles() }`, and `[]` is truthy, so `polisher.add()` was spread with zero arguments and Paged.js processed no stylesheet at all. It therefore never saw `@page { size: A4 portrait; margin: 16mm 14mm 18mm }` and fell back to `pagedjs/src/polisher/base.js` defaults: `--pagedjs-width: 8.5in`, `--pagedjs-height: 11in`, `--pagedjs-margin-*: 1in`. Those are exactly the previously recorded `816 × 1056` page and `624 × 864` content boxes. The same omission explains the Task 5 "generated margin-box processing" exception, which is hereby withdrawn — it was not a Paged.js limitation.
2. **Letter native PDF — our bug.** `polisher.setup()` appends its base stylesheet, which carries `@page { size: letter; margin: 0 }`, to `document.head`. That lands after the application's print stylesheet and wins the cascade, so the authoritative native print path silently became Letter. `installNativePageRule()` now re-declares the real `@page` geometry after pagination. This closes the previously open A4 gate.
3. **`Cannot read properties of null (reading 'getAttribute')` — upstream defect.** In `pagedjs/src/chunker/layout.js`, `createBreakToken` assigns `renderedNode = findElement(prevNode, rendered)` and then calls `findElement(renderedNode, source)` at lines 413 and 426 without a null guard, while `findElement` dereferences `node.getAttribute`. When a break lands where the previous node has no counterpart in the rendered page, `renderedNode` is null and Paged.js throws. There is no application-side usage that avoids this; it depends on where breaks fall.

A fourth issue surfaced while fixing the first: handing Paged.js the full stylesheet crashed layout with `Cannot read properties of null (reading 'getBoundingClientRect')` at `layout.js:43`, `this.element.offsetParent.getBoundingClientRect()`. Paged.js's `print-media` handler strips the `@media print` wrapper and appends those rules unconditionally, so `@media print { .pagination-staging { display: none } }` hid the off-screen subtree being laid out and `offsetParent` became null. The stylesheet is now split: `print-document.css` (the `@page` rule and document typography) is handed to Paged.js, and `print-shell.css` (application shell, staging, preview-mode rules) is withheld from it. `stylesheet-boundary.test.ts` enforces the split.

Fresh gates after these fixes:

- `cargo fmt --manifest-path apps/desktop/src-tauri/Cargo.toml -- --check` — PASS.
- `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml` — PASS, 11 tests.
- `./dev unit` — PASS, 45 tests, no unhandled errors.
- `./dev lint` — PASS, including `vue-tsc --noEmit` and ESLint. Two pre-existing `no-undef` errors on SVG type positions in `PrintProof.vue` surfaced here because lint had not been rerun since the review hardening; the globals allowlist now covers them.
- `./dev frontend-build` — PASS. KaTeX fonts are bundled locally. The known large-chunk warning remains.
- `bash tests/tooling/dev-wrapper.test.sh` — PASS.
- `./dev e2e` — 8 passed, 2 failed. The native print gate now proves **exactly two pages at A4** by reading the generated PDF's MediaBox with no `format` override, so the page size comes from the document's own `@page` rule. The two failures are both the Paged.js screen preview, blocked solely on defect 3 above.

Both remaining red tests are intentionally left red pending the architectural decision. Neither was weakened.

Current unresolved print-preview evidence (superseded by the analysis above; retained for history):

- Paged.js 0.4.3 screen output produces six pages for the fixture while the automated native PDF contains two pages. Diagnostic page text lengths were `[484, 742, 682, 604, 386, 0]`; the last page is diagram-only.
- Paged.js generated default Letter-sized page geometry (`816 × 1056` CSS pixels) rather than the requested A4 geometry.
- Inline SVG at a page boundary triggered Paged.js null-reference break-token failures; the hidden Paged staging clone now uses an atomic local SVG image while the native print source remains inline sanitized vector SVG.
- Passing the Vite CSS URL did not change page geometry; the working but unconfirmed diagnosis is that Vite's development CSS-module response was not usable as raw CSS by Paged.js. Passing raw CSS through Paged.js's supported stylesheet-object path triggered a different internal layout null reference. Both experiments were removed.
- The generated Chromium native PDF has exactly two pages but `pdfinfo` reported Letter (`612 × 792 pt`), so automated A4 correctness remains unproven. The KDE-exported PDF content was visually correct, but its dimensions were not recorded.
- The strengthened exact-page regression is intentionally RED: expected two populated `.pagedjs_page` elements, received six. Therefore Task 6 and the complete browser suite must not be reported green.

The detailed experiment log, risks, alternatives, and continuation commands are recorded in `docs/engineering/handoffs/2026-08-05-stage-0-task-6-print-tauri.md`. The recommended Stage 0 fallback is a native-authoritative continuous screen proof with system print/PDF as the only authoritative pagination path. Paged.js may instead be feature-gated, patched, or replaced only after an explicit architectural decision.
