# Stage 0 Task 6 Print/Tauri Continuation Handoff

**Recorded:** 2026-08-05 on KDE neon, Asia/Jakarta  
**Repository:** this repository  
**Isolated worktree:** the `stage-zero` worktree  
**Branch:** `feat/stage-zero`  
**Current HEAD:** `18e4a58a` (`feat: prove Tauri workspace file operations`)  
**Status:** SUPERSEDED on 2026-08-08. Kept for history.

> **This document is no longer the source of truth.** The questions it poses were answered by measurement on 2026-08-07 and 2026-08-08. Read instead:
>
> - `docs/engineering/evidence/stage-0.md` — the host smoke, the defects it exposed, and their resolutions;
> - `docs/decisions/0001-stage-zero-feasibility.md` — the decisions and the named deviations.
>
> Summary of what changed: the Paged.js failures this document attributed to library fragility were mostly defects in how this repository drove the library. Of four distinct print failures, three were ours — an empty stylesheet list, `@page` cascade order, and application chrome rebuilt onto every page — and one was an upstream null dereference, now patched. Section 8's architectural alternatives are therefore moot; the outcome is a self-verifying preview that falls back to the continuous document, and Paged.js is used only where a runtime check shows it paginates correctly. Sections 6 through 9 are retained only to show how the question was framed at the time.

The remainder of this document describes the state on 2026-08-05. It distinguished confirmed behavior from experiments, current risks, and architectural alternatives.

## 1. Constraints that still govern the work

- JavaScript development, linting, tests, and builds run only through the Docker-backed `./dev` wrapper. Do not install or invoke host Node.js or pnpm.
- Rust, Cargo, and `cargo tauri dev` run host-native with repository-pinned Rust 1.88.0.
- The target is Linux first, specifically KDE neon on an Ubuntu 24.04 LTS base. Stage 0 release work targets a `.deb`.
- Web and Tauri use the same Vue/Vite frontend.
- Mermaid executes only in an opaque-origin `sandbox="allow-scripts"` iframe with no Tauri imports or native capabilities. Only separately sanitized static SVG crosses into the parent.
- Preview HTML, Mermaid SVG, print content, and desktop capabilities remain separate trust boundaries.
- The system browser/GTK print dialog produces the PDF. Phase one does not directly write PDF bytes or bundle Chromium, wkhtmltopdf, Pandoc, or LaTeX.
- Paged.js is a progressive enhancement. The approved Stage 0 plan allows a documented Paged.js fallback only when plain-CSS printing and GTK PDF remain functional.
- Continue test-first. Do not delete or weaken the currently red exact-page regression merely to restore a green suite.
- Preserve unrelated user changes, temporary smoke folders, and exported PDFs.

## 2. Baseline and current Git state

The stable Task 5 base is `0636814e`. The initial Task 6 implementation is committed at `18e4a58a`. The first-review corrections and subsequent print experiments are committed on top of that commit.

Files carrying the review hardening:

- `apps/desktop/src-tauri/Cargo.lock`
- `apps/desktop/src-tauri/Cargo.toml`
- `apps/desktop/src-tauri/capabilities/main.json`
- `apps/desktop/src-tauri/src/workspace.rs`
- `apps/desktop/src-tauri/tests/workspace.rs`
- `apps/web/e2e/mermaid-security.spec.ts`
- `apps/web/e2e/print-pagination.spec.ts`
- `apps/web/src/mermaid/MermaidSandbox.ts`
- `apps/web/src/print/PrintProof.vue`
- `apps/web/vite.mermaid.config.ts`
- `packages/print/src/print.css`

Inspect with:

```bash
rtk git status --short
rtk git diff --stat
rtk git diff --check
rtk git log -5 --oneline
```

Do not amend, reset, clean, or discard the hardening commit until the architectural choice in section 8 is made and the diff has been reviewed.

## 3. What the first independent review found

The independent review of `18e4a58a` found no Critical issue, but Task 6 was not ready because of four Important findings:

1. The Tauri parent CSP and inline Mermaid `srcdoc` renderer were a production compatibility risk.
2. `core:default` in the main capability granted more core permissions than the proof needed.
3. Own-write watcher suppression did not match modification time and stopped suppressing after the first matching event.
4. Workspace parent canonicalization still allowed a symlink-swap race between validation and persistence.

It also noted that watcher tests did not exercise real suppression, debounce/drop, and restart behavior.

The current uncommitted hardening addresses these findings, but the same reviewer has not re-reviewed it.

## 4. Confirmed post-review hardening

### 4.1 Mermaid renderer and CSP

The original `srcdoc` design was replaced by generated external assets:

- `public/generated/mermaid-renderer.html`
- `public/generated/mermaid-renderer.iife.js`

The first external renderer used child CSP `script-src 'self'`. Chromium passed, but WebKitGTK timed out because a sandboxed iframe without `allow-same-origin` has an opaque origin, so `'self'` did not authorize its external script consistently.

The second design uses a fixed build-owned nonce in both the child CSP and script element. The parent still creates exactly `sandbox="allow-scripts"`, checks `event.source`, and requires `event.origin === 'null'`. Chromium CSP/isolation tests pass, and the user confirmed Mermaid renders in Tauri preview, print proof, and PDF.

The iframe originally used the `hidden` attribute. That makes it `display:none`, causing Mermaid layout to emit an invalid `viewBox="-8 -8 16 16"` around graph geometry outside the viewBox. It now remains layout-enabled in a fixed 1024×768 off-screen frame with `opacity:0`, `pointer-events:none`, `aria-hidden="true"`, `tabIndex=-1`, and the same opaque sandbox. A browser regression proves the generated viewBox encloses the rendered geometry.

### 4.2 Tauri capabilities

`core:default` was replaced by only:

- `core:event:allow-listen`
- `core:event:allow-unlisten`
- official dialog open permission
- the four custom proof commands

Folder selection still worked in the host smoke after this change. No shell, process, opener, or broad filesystem plugin was added.

### 4.3 Linux workspace race resistance and watcher matching

On Linux, the workspace service now holds an open root directory descriptor. Reads and parent traversal use `openat2` below that descriptor with `RESOLVE_BENEATH`, `NO_MAGICLINKS`, and `NO_SYMLINKS`. Atomic writes use an open parent descriptor, a temporary file in that directory, file sync, directory identity checks before and after persistence, and directory sync. A deterministic rename-plus-symlink-swap regression must fail without writing outside the workspace.

Known writes now retain path, SHA-256, modification time, and a bounded completion time. Suppression requires exact path/hash/mtime matching for the full bounded period. Tests cover a same-content external save with a different mtime, own completed-write suppression, watcher drop, and restart.

An interim Rust run passed 11 tests across the expanded suites. This is not the final verification gate and must be rerun before completion.

### 4.4 Host file-operation smoke

The second smoke folder is `/tmp/stackedit-stage0-rereview.MwumyC`. A controlled external edit changed `stage-zero-proof.md` from:

```text
c1e46f757540d49c13856075e3894d281605475703e57974a9978849eb4de6b9
```

to:

```text
3b6fbe32a06a1a93a51b29faf4f8a0e11b75715cbb7819e07a685f4d2414daa4
```

The user confirmed that the desktop proof displayed the external-change event and the exact new hash. Folder selection, save metadata, SHA-256 display, and epoch modification time also appeared correctly.

## 5. Mermaid print experiments and confirmed results

### 5.1 Dark-mode palette

The first Tauri dark-mode print showed a black node and an unclear/missing edge because component-scoped preview colors did not cross the separately hydrated print boundary. A focused browser test reproduced black fill and missing stroke. The print document now owns an explicit light-paper palette for Mermaid nodes, labels, edges, and markers. The user confirmed correct preview, dialog, and PDF colors/arrows.

### 5.2 Oversized diagram

The first size correction added a `150mm` maximum width. It kept the simple diagram on page 2 instead of giving it a separate page, but the diagram remained unnecessarily large because the SVG sanitizer intentionally sets `width="100%"` for responsive preview.

After fixing the hidden-renderer viewBox, the simple proof diagram reports a natural `viewBox` of approximately `133.3515625 × 160`. The native printable copy now replaces its responsive width with the sanitized viewBox width, while keeping page-width and height ceilings. The user confirmed that the PDF now contains a small diagram on page 2.

### 5.3 Paged.js inline-SVG crash

With correct SVG geometry, Paged.js 0.4.3 can place a page break inside inline SVG descendants and call its internal `findElement` with a node that lacks a pagination reference. Observed failures included:

```text
Cannot read properties of null (reading 'getAttribute')
```

Only the hidden Paged.js staging clone converts the already-sanitized SVG into a local `data:image/svg+xml` image after baking computed presentation attributes. The authoritative native print source remains inline sanitized vector SVG. This made the Paged.js browser regression pass and preserved the native PDF result. This staging conversion still needs independent security/code-quality review.

### 5.4 Screen-proof containment

At the Tauri window size of 1180×820, the fixed-size paper preview was placed in a narrow auto-fit grid cell and extended outside its card. The print-proof card now spans the full grid row. Horizontal overflow is confined to `.paged-output`, not the card, because applying overflow containment to the card also clips the off-screen staging tree and destabilizes Paged.js. A Chromium regression proves the first page stays inside the card at the Tauri viewport; narrow windows may scroll the visible output.

The user confirmed the print proof moved to its own row, then reported multiple sparse/blank-looking pages. That report exposed the unresolved problem below.

## 6. Unresolved Paged.js/native mismatch

> **Resolved.** The six-versus-two page mismatch was application chrome rebuilt onto each page by Paged.js's ancestor reconstruction, and the Letter geometry was an empty stylesheet list. See the evidence file.

The strengthened browser regression uses exactly two populated screen-preview pages as a diagnostic expectation because the same fixture's native PDF proof has two pages. The approved Stage 0 plan originally required only at least two pages, so retaining exact parity is part of the pending architectural decision. The diagnostic currently fails:

```text
Expected: 2 .pagedjs_page elements
Received: 6
```

Diagnostic page text lengths were:

```text
[484, 742, 682, 604, 386, 0]
```

The sixth page contains the diagram but no ordinary text, which explains the user-visible sparse/blank appearance. The first five pages split normal prose and code far more aggressively than the native print path.

The generated Paged.js page box measured `816 × 1056` CSS pixels with `624 × 864` content—default US Letter geometry—not the requested A4 geometry. The direct print stylesheet URL was requested, but the page geometry did not change. The working diagnosis is that Vite's development CSS-module response was not usable as raw CSS by Paged.js; the response body was not retained, so treat that cause as an inference rather than a confirmed fact. Passing raw CSS through the stylesheet-object form supported by the inspected Paged.js source caused a different internal failure:

```text
Cannot read properties of null (reading 'getBoundingClientRect')
```

That experiment was removed. Pinning the hidden staging width to `182mm` also did not change the six-page result and was removed.

The automated Chromium native-PDF fixture generated exactly two pages, confirmed with `pdfinfo`, but reported Letter page size (`612 × 792 pt`) rather than A4. The KDE user selected Save to PDF and confirmed the content and diagram placement, but the exported KDE PDF's paper dimensions were not independently recorded. Therefore A4 correctness is still an open gate even though printable content is correct.

After three distinct Paged.js failure modes—inline SVG break tokens, responsive containment interactions, and print-stylesheet layout—the patch loop was stopped for architectural review. This follows the systematic-debugging breaker rather than attempting an unbounded fourth workaround.

## 7. Test truth at handoff

> **Superseded.** The suite is green: 61 unit, 12 Rust, 12 browser, plus lint, build and wrapper gates.

Do not report the suite as green.

- Before the exact two-page regression was added, the complete Docker browser suite passed 9/9. That suite only required at least two pages and therefore failed to detect the six-page mismatch.
- The strengthened test in `apps/web/e2e/print-pagination.spec.ts` is intentionally RED: it expects exactly two populated pages and currently receives six.
- The native PDF test passes and its generated file contains two pages, but its automated paper size is Letter, not proven A4.
- Earlier post-review Rust evidence is 11 passing tests; earlier unit evidence is 35 passing tests. Neither is a substitute for a fresh final gate.
- No fresh final lint, frontend build, Rust format, full Rust, unit, or wrapper run has been completed after all current uncommitted changes.

The most recent full browser command that passed before strengthening the assertion was:

```text
./dev e2e — 9/9 passed
```

The current focused command fails as intended:

```bash
rtk docker compose --project-directory "$PWD" \
  -f "$PWD"/compose.yaml \
  run --rm browser pnpm --filter @stackedit/web e2e \
  --grep 'paginates sanitized proof'
```

## 8. Architectural alternatives

> **Moot.** The alternatives below were framed against a Paged.js that had never been handed a stylesheet. The adopted outcome is closest to Alternative B, reached by evidence rather than by choosing in advance: the preview verifies itself and falls back to the continuous document, which is what happens on the reference host.

### Alternative A — Native-authoritative continuous screen proof (recommended current fallback)

Show the exact sanitized native print source in a responsive paper-like screen container without presenting Paged.js page boundaries as authoritative. `window.print()` and the system dialog remain the only source of final pagination. Guard or disable Paged.js by default and record the deviation in the Stage 0 ADR.

Benefits:

- Uses the path already confirmed in KDE print dialog and PDF.
- Avoids misleading six-page previews and Paged.js/WebKit divergence.
- Preserves one HTML/CSS/Mermaid source for web and desktop.
- Fits the approved plan's explicit progressive-enhancement fallback.

Costs:

- Screen proof cannot promise exact page breaks, counters, or running headers.
- The phase-one Print Studio design must describe screen pagination as optional until another engine passes the host gate.

### Alternative B — Feature-detected Paged.js preview with automatic fallback

Keep Paged.js, but display its page preview only when a runtime validation fixture produces the expected paper geometry, page count, and populated pages. Otherwise display Alternative A and a non-blocking limitation message.

Benefits:

- Preserves Paged.js where it is demonstrably correct.
- Prevents known-bad output on WebKitGTK or incompatible browser versions.

Costs:

- Runtime validation adds complexity and test fixtures to product startup.
- Correctness on one fixture does not prove arbitrary documents.
- The current A4 stylesheet and break-token crashes still require resolution before it can be enabled on the reference host.

### Alternative C — Vendor or patch Paged.js 0.4.3

Maintain a project patch for null-safe break-token lookup, SVG atomization, and stylesheet/page-size processing.

Benefits:

- Retains the designed page-preview architecture and Paged.js features.

Costs and risks:

- The application owns browser-layout-engine maintenance.
- Fixes must be proven in Chromium and WebKitGTK across tables, code, KaTeX, SVG, fonts, A4/Letter, and print themes.
- Three unrelated failure modes already indicate architectural fragility rather than one isolated defect.
- Dependency updates become merge and regression work.

This is not recommended for Stage 0 without an explicit decision to expand scope.

### Alternative D — Evaluate another paged-media engine

Evaluate a browser paged-media engine such as Vivliostyle in an isolated spike against the same fixture and security constraints.

Benefits:

- May provide stronger CSS paged-media behavior without maintaining a local Paged.js fork.

Costs and risks:

- Not yet evaluated in this repository or KDE WebKitGTK.
- Bundle size, CSP behavior, offline packaging, licensing, iframe isolation, and Tauri compatibility require new gates.
- Replacing the engine is a design change, not a Task 6 bug fix.

### Alternative E — Dedicated unprivileged print window using native CSS

Move the native print document to a separate unprivileged Tauri/browser window and use it for continuous preview plus `window.print()`.

Benefits:

- Stronger capability isolation and more space for print controls.
- Keeps the proven native print path.

Costs:

- Still does not guarantee exact in-app page boundaries.
- Adds window lifecycle and resource-readiness coordination.

### Alternatives outside the approved phase-one design

Bundling headless Chromium, using a hosted PDF service, or introducing Pandoc/LaTeX/Typst/Rust PDF generation could produce deterministic PDFs, but each abandons the current same-HTML/CSS system-dialog design, expands packaging/security scope, or breaks web/desktop parity. Treat any of these as a new proposal, not a continuation of Task 6.

## 9. Recommended continuation sequence

> **Completed.** Superseded by the evidence file and ADR 0001.

The next session must first choose Alternative A, B, C, D, or E. Alternative A is the smallest evidence-backed Stage 0 fallback. Do not start Task 7 before Task 6 is reviewed and classified.

### If Alternative A is chosen

1. Update the phase-one design and Stage 0 plan/ADR to say Paged.js is disabled or experimental on the reference host; plain native CSS is authoritative.
2. Keep the exact native PDF assertion and add an A4 `pdfinfo` gate rather than accepting any two-page PDF.
3. Replace the red six-page assertion with a test proving the continuous screen proof contains representative prose, KaTeX, Mermaid, and no Paged.js pages in fallback mode.
4. Retain the natural SVG width, light-paper palette, and full-row/scroll containment.
5. Remove unused Paged.js staging conversion if Paged.js is fully disabled; retain it only behind an explicit experimental path if Alternative B is selected.
6. Run the full verification matrix in section 10.
7. Update this handoff, `docs/engineering/evidence/stage-0.md`, the ignored Task 6 report, and the SDD ledger.
8. Commit the review fixes as a separate commit on top of `18e4a58a`.
9. Send the exact new HEAD to the same reviewer for scoped re-review.
10. Address any Important/Critical finding test-first, rerun affected gates, and obtain a clean Task 6 review before Task 7.

### If Alternative B, C, or D is chosen

Create a separate implementation plan before changing code. It must define exact acceptance for A4 and Letter geometry, page count, populated pages, KaTeX/Mermaid visibility, no overflow, CSP/offline behavior, WebKitGTK, Chromium, bundle impact, and fallback behavior. Do not continue ad hoc patching in `PrintProof.vue`.

## 10. Final verification matrix for Task 6

Run JavaScript commands through Docker only:

```bash
rtk ./dev unit
rtk ./dev lint
rtk ./dev e2e
rtk ./dev frontend-build
rtk bash tests/tooling/dev-wrapper.test.sh
```

Run Rust host-native:

```bash
rtk cargo fmt --manifest-path apps/desktop/src-tauri/Cargo.toml -- --check
rtk cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
```

Check repository hygiene:

```bash
rtk git diff --check
rtk git status --short
```

Repeat the KDE host smoke after restarting both processes, not relying on hot reload:

```bash
rtk ./dev frontend-dev
```

From `apps/desktop/src-tauri` in another host terminal:

```bash
rtk cargo tauri dev
```

Confirm folder selection, save metadata, external watcher hash, KaTeX, Mermaid preview, print proof behavior selected in section 8, GTK print dialog, PDF page count and dimensions, diagram size/colors/arrows, margins, and offline behavior. Preserve the temporary folders and exported PDF unless the user explicitly authorizes deletion.

## 11. Review handoff

Task 6 received one independent review, which produced the four Important findings in section 3. The hardening that answers them has not been re-reviewed. Re-review should go to the same reviewer so the original findings are checked against their own criteria. After Stage 0 is otherwise complete, the whole branch still needs a separate architecture-level review.

A later session should begin by reading, in order:

1. this handoff;
2. `docs/engineering/specs/2026-08-04-stackedit-modernization-phase-one-design.md`;
3. Task 5 through Task 8 in `docs/engineering/plans/2026-08-04-stackedit-modernization-stage-0.md`;
4. `docs/engineering/evidence/stage-0.md`;
5. `git diff 18e4a58a` and the currently red E2E test.

The next session must not claim Task 6 complete until the architectural choice is recorded, the red regression is resolved without weakening it, all fresh gates pass, the host smoke is recorded, and the re-review is clean.
