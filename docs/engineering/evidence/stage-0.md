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

### Resolution of the six-versus-two page mismatch (2026-08-05)

The decision was to patch Paged.js for defect 3 and keep the automatic fallback. After that patch the preview paginated but still produced six pages against the native PDF's two. That gap was also caused by this repository, not by Paged.js.

Paged.js's `rebuildAncestors` reconstructs a broken node's ancestor chain onto each new page so inherited styling survives the break. The pagination staging host lives inside the application shell, so the reconstructed chain was `html > body > #app > main.proof-shell > section.proof-grid > section.proof-card.print-proof-card`. Those rebuilt wrappers are empty, but they carried their screen chrome onto every page — measured as `min-height: 208px`, `padding: 0 20px 20px`, a 1px border and a 12px radius on the card, plus 48px of shell padding, and a 16px grid row gap. That is the large empty rounded box that appeared before each paragraph and the reason pages looked sparse.

`print-shell.css` now neutralizes application chrome for any shell wrapper that ends up inside `.pagedjs_page_content`. The preview then produced exactly two pages, matching the native PDF, and a screenshot confirmed a dense, correctly laid out A4 page with the running title, the table, the KaTeX display expression and the `Page 1 of 2` counter. A browser regression asserts no rebuilt shell wrapper inside a page carries min-height, padding, border or row gap.

Final tally for the print work: of the four distinct print failures, three were this repository's own defects — the empty stylesheet list, the `@page` cascade order, and the rebuilt shell chrome — and one was the upstream break-token null dereference, now patched.

Fresh full matrix, all green:

- `cargo fmt -- --check` — PASS. `cargo test` — PASS, 11 tests.
- `./dev unit` — PASS, 45 tests, no unhandled errors.
- `./dev lint` — PASS. `./dev frontend-build` — PASS.
- `./dev e2e` — PASS, 11 tests.
- `bash tests/tooling/dev-wrapper.test.sh` — PASS.
- `git diff --check` — PASS.

## KDE host re-smoke (2026-08-07)

Environment: KDE neon, WebKitGTK **2.52.3**, rustc 1.88.0, tauri-cli **2.10.1** (the plan named 2.11.4 — a deviation, not a blocker for dev mode). Both processes were started fresh: the Docker frontend through `./dev frontend-dev`, then host-native `cargo tauri dev`. `tauri.conf.json` declares no `beforeDevCommand`, so no host Node or pnpm was invoked.

Independently verified rather than eyeballed: file hashes were recomputed with `sha256sum`, modification times read with `stat`, and every PDF measured with `pdfinfo`, `pdftotext`, `pdffonts` and content-stream inspection.

### Gates that passed

- Window launch and the shared Vue UI under WebKitGTK, with the editor, preview, and both proof cards.
- KaTeX and isolated Mermaid rendering under the Tauri dev CSP, using the nonce-based external renderer.
- Paged.js screen preview reported two pages, so the break-token patch works under WebKitGTK, not only Chromium.
- Folder selection through the official dialog with `core:default` removed.
- Atomic write with **truthful metadata**: the UI reported SHA-256 `c1e46f75…` and mtime `1785945827993`; the file on disk hashed identically and its mtime of `1785945827993994547` ns truncates to exactly that millisecond value.
- External-change detection through a Kate save, which uses the same write-temp-then-rename pattern as the service. The reported hash `91390eee…` matched the file on disk exactly.
- Native print content: complete text, the Mermaid diagram as **vector** path operations rather than a raster image, KaTeX fonts embedded as subsets, and the light-paper Mermaid palette present in the printed output (node fill `#f8fafc`, stroke `#475569`, no pure black). This machine-verifies the dark-mode print fix.
- A4 output when selected in the dialog: 595 × 842 pt, two pages, and zero words outside the page box.
- Offline behaviour: with external networking disabled, editing, KaTeX, Mermaid, and pagination all worked, and the exported PDF was structurally identical to the online one — same page count, geometry, embedded fonts, palette, and vector-operation count. The production bundle makes no remote `fetch`, XHR, or `importScripts` call; its 545 external URLs are inert `mdn-data` documentation strings reachable only through the `css-tree` dependency of Paged.js.

### Defects found

1. **Preview drops content at a page break under WebKitGTK.** Preview page 1 ended at "The local application" and page 2 began at the display math, losing "bundle contains the fonts required by the mathematical expression below, so a disconnected review remains representative of the desktop target." The PDF contains that sentence, so only the Paged.js preview is affected. A browser test asserting every source sentence survives into the preview passes under Chromium, so this is engine divergence reached through the patched break-token path. Silent content loss in a preview is worse than a visible fallback.
2. **The service's own write is reported as an external change.** Immediately after saving, the external-change panel showed `stage-zero-proof.md` with the save's own hash, before any external edit. This is review finding 3 again. The suppression code compares path, SHA-256, mtime and a two-second window against a map shared through `Arc<Mutex<…>>`, and a Rust test asserting this exact behaviour passes, so the test does not reproduce the real command sequence.
3. **WebKitGTK ignores `@page` geometry.** The default export was US Letter at 612 × 792 pt despite `@page { size: A4 portrait }`, and margins measured about 6.3 / 6.5 / 14.3 / 10.6 mm rather than the declared 14 / 16 / 18 mm. Paper and margins are governed by the GTK dialog. A4 is reachable only by selecting it there. Chromium honours the rule, so the earlier "native print is A4-correct" claim held for Chromium only.
4. **`@page` margin boxes never reach printed output.** The exported PDF contains no running header and no page counter; "StackEdit print proof" appears once, as the document heading. No browser implements CSS margin boxes, so the Paged.js preview displays running titles and `Page N of M` that the real print output cannot reproduce.

Defects 1 and 2 are correctness bugs to fix before Stage 1. Defects 3 and 4 are engine limitations to record as deviations, and both constrain the phase-one Print Studio design: page geometry is user-selected on Linux rather than document-controlled, and running headers or page numbers must be composed into the document body if they are required at all.

### Defect 2 fixed and verified on the host (2026-08-07)

The cause was not suppression logic but a feedback loop. Describing a change means opening the file and hashing it, and on Linux that read is itself reported by the watcher, so it woke itself once per debounce against a file nothing had touched. The own-write record absorbed the repeats for two seconds, then expired, after which every cycle announced the unchanged file as an external edit. One save produced 888 event batches: 26 suppressed, 862 emitted. Access events no longer contribute paths.

Host verification: saving produced no external-change event, and a subsequent Kate edit produced hash `15c3552d…`, which matches the file on disk exactly and differs from the save hash. Suppression works without going deaf to genuine edits.

Two diagnoses preceded this one and both were wrong: that the write and watcher were not sharing the record map, and that the record landed after the watcher judged the event. The captured trace disproved the second directly — the record was present and 75 ms old, and the first event was correctly suppressed. Only logging what the watcher actually compared found the loop.

### Defect 1 re-measured: the preview is complete

Measuring the running WebKitGTK app rather than reasoning about it showed the remainder of the split sentence present on page 2, at the left edge of the page box, `visibility: visible`, and first in reading order. Page 1 ends 19 px above its box bottom. The preview breaks mid-paragraph a few words earlier than the PDF because Paged.js applies the stylesheet's 14/16/18 mm margins while the GTK dialog imposes its own, near 6.5 mm, so the two have different line counts per page. That is a normal page break, not content loss.

The earlier observation during the host smoke was different: the remainder was absent and page 2 began at the display math. Both observations were made on builds containing the same layout-affecting commits, so the difference is unexplained. Treat the failure as intermittent rather than resolved — most plausibly a readiness race, since fonts and the diagram image influence where the break falls.

Two independent guards now cover it, neither of which fires on correct output in either engine:

- a text comparison, which detects content the engine discards outright;
- a geometry check, which detects content laid out but left outside the page box, where the text is still in the document and a text comparison cannot see it.

Both demote the preview to the plain-CSS fallback rather than presenting a page with a hole in it. The text comparison alone was written first and would not have caught the geometry case; the geometry check alone would not catch outright loss.

### Defect 1 resolved, and what it means for the preview (2026-08-08)

The earlier conclusion that the preview was complete was wrong. It came from measuring the off-screen staging tree, which is complete, rather than the tree on screen, which is not. Measuring the live pages on the host settled it: the remainder of the split paragraph sits ninety pixels left of the visible column, with a hundred and sixty-five pixel gap at the foot of the previous page, and the worst element is roughly three and a half thousand pixels outside its page box.

Three independent causes were stacked, and each fix only exposed the next:

1. the guards ran inside `paginate`, so they inspected the staging copy rather than the displayed pages;
2. the geometry comparison covered only the right and bottom edges, while the escaped content is parked to the left;
3. the check ran at placement, before the browser had laid the re-parented pages out again, when they still report their off-screen positions.

Host verification after all three: the preview reports `Paged.js hides content outside the page box on page 2; using plain CSS` and shows the complete continuous document.

The practical consequence for Stage 0 is that **the Paged.js page preview does not work on the reference host**. Chromium paginates the same document correctly at A4, so the web surface keeps it, but on KDE neon with WebKitGTK 2.52.3 the preview reliably degrades to the continuous plain-CSS document. Native printing is unaffected and remains the authoritative path, and its output is complete and correct on both engines.

This should be recorded in ADR 0001 as a named deviation rather than presented as a working gate: the desktop application has no page-accurate on-screen preview, and phase one's Print Studio cannot promise one until an engine passes this gate on WebKitGTK.

### Task 6 re-review findings carried into Stage 1 (2026-08-08)

A scoped re-review of `18e4a58a..565f8e7f` produced eight findings. Three were fixed: the own-write record could be lost if describing the file failed after the rename, the settle loop could hang because its deadline was only checked between animation frames, and two values were needlessly mutable. Two were recorded as scope decisions rather than defects: `read_markdown` is permitted but never invoked by the application, and the print settings type is decorative because `printPolicy` discards its argument and A4 is declared independently in TypeScript and in CSS with nothing connecting them.

The remaining three are not Stage 0 blockers and are carried forward:

1. **The watcher hashes an entire file on every event, and can block for up to two seconds.** Describing a change reads and hashes the whole file, and `await_pending_write` blocks the watcher thread until an in-flight write to that path has been recorded. Both are acceptable for a single small proof file and neither is acceptable for a real workspace. Stage 1 should hash incrementally or key suppression on size and modification time first, and should not block the shared watcher thread on a per-path condition.
2. **Replacing a watched file with a symlink is silently ignored.** `metadata_for_relative` opens with `NOFOLLOW`, so the event is dropped with no signal to the interface. Refusing to follow the symlink is correct; discarding the event without telling anyone is not, because the user sees a file that has changed and an application that says nothing. Stage 1 should surface a distinct rejected-change event, and it needs a test — this behaviour currently has neither.
3. **Preview verification runs overlap.** Each pagination starts its own two-second polling loop, so rapid editing leaves several running at once. The generation guard keeps the result correct, but the work is wasted and grows with typing speed. Stage 1 should cancel the previous verification when a new pagination starts.

The review was performed by the author of the code under review, which is weaker than the independent review the plan asks for. Both findings that were declined are judgement calls about scope, which is exactly the category an author is least able to review impartially. An independent pass is still owed.

Still outstanding for Task 6: an independent re-review.

Current unresolved print-preview evidence (superseded by the analysis above; retained for history):

- Paged.js 0.4.3 screen output produces six pages for the fixture while the automated native PDF contains two pages. Diagnostic page text lengths were `[484, 742, 682, 604, 386, 0]`; the last page is diagram-only.
- Paged.js generated default Letter-sized page geometry (`816 × 1056` CSS pixels) rather than the requested A4 geometry.
- Inline SVG at a page boundary triggered Paged.js null-reference break-token failures; the hidden Paged staging clone now uses an atomic local SVG image while the native print source remains inline sanitized vector SVG.
- Passing the Vite CSS URL did not change page geometry; the working but unconfirmed diagnosis is that Vite's development CSS-module response was not usable as raw CSS by Paged.js. Passing raw CSS through Paged.js's supported stylesheet-object path triggered a different internal layout null reference. Both experiments were removed.
- The generated Chromium native PDF has exactly two pages but `pdfinfo` reported Letter (`612 × 792 pt`), so automated A4 correctness remains unproven. The KDE-exported PDF content was visually correct, but its dimensions were not recorded.
- The strengthened exact-page regression is intentionally RED: expected two populated `.pagedjs_page` elements, received six. Therefore Task 6 and the complete browser suite must not be reported green.

The detailed experiment log, risks, alternatives, and continuation commands are recorded in `docs/engineering/handoffs/2026-08-05-stage-0-task-6-print-tauri.md`. The recommended Stage 0 fallback is a native-authoritative continuous screen proof with system print/PDF as the only authoritative pagination path. Paged.js may instead be feature-gated, patched, or replaced only after an explicit architectural decision.

## Task 7 — containerized Debian packaging (2026-09-02)

### Build and inspection

The release builder is Ubuntu 24.04, matching the KDE neon base, with Node 24.18.0, pnpm 11.20.0, Rust 1.88.0 and Tauri CLI 2.11.4 pinned in the image and verified during the build. The host's Tauri CLI is 2.10.1 and does not participate.

`./dev desktop-build` produces `stackmark_0.1.0-stage0_amd64.deb`, package `stackmark`, depending on `libwebkit2gtk-4.1-0` and `libgtk-3-0`, installing `/usr/bin/stackmark` and a `StackMark` menu entry. `scripts/inspect-deb.sh` passes and records a SHA-256 beside the artifact. Its own failure modes were exercised: no argument, two packages, a missing file, a file that is not a package, and a package tampered with a planted `node` binary, which it rejects.

The build corrected two things it would otherwise have shipped. The bundle category must come from Tauri's fixed set rather than free text. The hand-written dependency list duplicated what Tauri derives from the linked libraries and added `libayatana-appindicator3-1`, which `objdump` shows the binary does not link, so it would have forced an unnecessary install on every user; the derived list is used instead.

Successive builds of unchanged application code produce different checksums, so **the build is not reproducible**. A checksum identifies one artifact, not the code at a commit.

### Host installation

Installation on KDE neon succeeded and pulled **no additional packages**, which proves the declared runtime dependencies are satisfiable rather than merely declared. `apt remove` left no binary, desktop entry or icon, and no `rc` state. The application launches from a terminal and from the KDE application menu.

### The packaged build rendered no diagrams

The first packaged run failed the Mermaid gate. The webview refused the renderer script:

```text
Refused to load tauri://localhost/generated/mermaid-renderer.iife.js
because it does not appear in the script-src directive
```

The renderer frame is sandboxed without `allow-same-origin`, so its origin is opaque and `'self'` matches nothing from inside it. The application policy declared no `script-src`, so it fell back to `default-src 'self'`, which that frame could never satisfy. The policy now names the scheme explicitly, `script-src 'self' tauri://localhost`, which grants the main document nothing new because there `'self'` already is `tauri://localhost`. Confirmed fixed by running the release binary.

The printed output lacked the diagram for the same reason: the print path only receives sanitized SVG handed back by the sandbox, so one cause produced both symptoms.

Two diagnoses preceded the right one. The first blamed the policy text and was disproved by running development under the production policy, where diagrams rendered. The second blamed Tauri's compile-time rewriting of asset policies and was disproved by a build with `dangerousDisableAssetCspModification`, and then by the served document, whose policy and nonce arrived intact and matching. Only reading the console error identified the cause, which is the same lesson the print work produced: instrument the running program rather than reason from the source.

### Why no test caught it

The browser test named for this policy applied it to the main document alone, so it exercised the parent frame and never the child, and its copy of the policy had drifted from the configuration. It now reads the real policy and applies it to every response.

That test still cannot catch this defect. Chromium resolves `'self'` for an opaque-origin frame differently and renders the diagram whether or not the fix is present, verified by reverting the fix and watching it pass. The regression guard is therefore in the wrapper contract, which asserts the explicit scheme source and does fail without it. The behaviour itself is observable only in a packaged build on WebKitGTK.

**The Mermaid gate had been recorded as passing on development evidence alone.** Development serves the frontend over `http://localhost:1420`, which gave the sandboxed frame an ordinary HTTP origin; packaging removed that and the gate failed. The nonce design had been adopted because `script-src 'self'` already failed on WebKitGTK, so the workaround was masking the same constraint it appeared to solve.

### Installed build carrying the fix — PASS (2026-09-02)

Package `676c342e788439e856218d0d786022d1393a9f02abdd944cbd5337d1fd4d06ca`, built without the devtools feature, installed with `apt` and removed afterwards.

- Launches from a terminal and from the KDE application menu.
- **Mermaid renders**, closing the failure the first packaged build exposed.
- The webview inspector is absent, confirming the diagnostic feature did not ship.
- Saving produced **no external-change event**, and a subsequent external edit produced hash `2fe9fc1ca9e2ff55311f03b2a5d64911797804abc5957d7b50f4f6b89918ffd5`, which matches the file on disk exactly. Own-write suppression and external detection both hold in the packaged build.
- The save hash differs from earlier runs because the seed fixture's text changed with the rename, not because the write changed.

The PDF exported from the installed application through the GTK dialog with A4 selected:

- 2 pages, 595 × 842 pt (A4), zero words outside the page box.
- Content complete, including the sentence that spans the page break.
- The Mermaid diagram present as **vector** path operations, 388 of them — the same count the development-mode PDF produced, so the print path is unchanged by packaging.
- The light-paper Mermaid palette present: node fill `#f8fafc`, stroke `#475569`.
- KaTeX fonts embedded as subsets.

This is the first PDF produced end to end by the installed product rather than a development build.

### Still to run

Step 6, the offline product path against the installed build: editing, KaTeX, Mermaid, pagination and Save to PDF with external networking disabled. Any external request is a failed gate.
