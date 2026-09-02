# Stage 0 to Stage 1 handover

**Recorded:** 2026-09-02  
**Branch:** `feat/stage-zero`, 43 commits, not merged  
**Decision:** ADR 0001 — go, with four named deviations

Stage 0 was a vertical feasibility slice, not a first draft of the product. Some of it is
foundation that Stage 1 and Stage 2 build on; some is proof scaffolding that must be deleted
rather than extended. Without that written down, the next stage will build on a proof.

## Foundation — carry forward

**Toolchain and packaging.** `dev`, `compose.yaml`, `docker/*.Dockerfile`, `.npmrc`,
`pnpm-workspace.yaml`, `tests/tooling/dev-wrapper.test.sh`, `scripts/inspect-deb.sh`,
`patches/pagedjs@0.4.3.patch`. Every tool version is pinned inside the images and verified
during the build, so a contributor's host toolchain cannot influence a release.

**Rendering and sanitizing.** `packages/markdown` — the markdown-it configuration, the two
deliberately separate DOMPurify configurations, the Mermaid protocol types. The separation of
the HTML sanitizer from the SVG sanitizer is load-bearing and survived roughly thirty
adversarial vectors under independent review.

**Mermaid isolation.** `apps/web/src/mermaid/*` and `apps/web/vite.mermaid.config.ts`. The
opaque-origin frame, the message validation on both sides, and the build-generated renderer
document are the design that a review confirmed the frame cannot escape.

**Print pipeline.** `packages/print` — the paginate adapter with its integrity guards, the
native page rule, and the split between `print-document.css` and `print-shell.css`. Print
Studio replaces the *interface*, not this.

**Desktop shell.** `apps/desktop/src-tauri` — `workspace.rs`, the capability and permission
files, the Tauri configuration including its content policy, and the desktop template. The
`choose_workspace` command's ownership of the folder picker is a security property, not an
implementation detail.

**The gateway pattern**, though not its current names: an interface where the browser reports
`unsupported` and the desktop implements natively. Stage 1's platform contracts should follow
this shape.

## Scaffolding — Stage 2 must remove, not extend

- `apps/web/src/App.vue` — the proof screen. Its four proof gates, `stage-zero-title`, and the
  desktop proof card exist to demonstrate capabilities, not to be an editor.
- `apps/web/src/print/PrintProof.vue` — a harness for proving pagination. Print Studio replaces it.
- `apps/web/src/platform/desktop-proof.ts` — the *pattern* stays, the naming does not:
  `DesktopProofGateway`, `saveProof`, and the hardcoded `stage-zero-proof.md` are proof-shaped.
- `tests/fixtures/print-proof.md` — a fixture written to exercise pagination.
- **`?printFallback=1` in `App.vue:71` is a production backdoor.** Any user who lands on that
  query parameter gets degraded printing. It exists only so a browser test can reach the
  fallback path. It must not survive into a shipped build; the fallback needs a test seam that
  is not reachable from a URL.

## Open decisions

- **Remote images.** `<img src="https://…">` survives sanitizing. The desktop policy blocks the
  fetch; the browser policy permits `https:` deliberately, so the question is still open. Most
  Markdown editors allow it; an untrusted document turns it into a tracking beacon.

Branch integration is settled. The Stage 0 commits are the trunk: `master` carries all of them,
`v0.1.0-stage0` tags the slice, and both are published. Stage 1 builds on `master`.

## Carried findings

Recorded in the evidence file and unfixed, in rough order of consequence:

1. **No test crosses the JavaScript to Rust boundary.** Renaming a command or the event string
   on either side leaves every test green while the application is broken. Stage 1's contract
   tests are the right place for this.
2. Pagination timeouts reject without cancelling the underlying operation, so a discarded tree
   keeps being mutated and injected stylesheets accumulate.
3. A FIFO named `*.md` inside a workspace blocks the reading thread, then the watcher, then the
   next root change.
4. Mutex poisoning would make every later workspace operation fatal. No realistic panic source
   exists inside a critical section today.
5. The non-Linux filesystem path is check-then-use and materially weaker than the Linux one.
   Unreachable on the shipped target — dead, but armed.
6. The watcher hashes an entire file on every event and can block the shared thread for up to
   two seconds.
7. Replacing a watched file with a symlink is silently ignored, with no signal to the interface
   and no test.
8. The `.deb` build is not reproducible, which Stage 4 requires.
9. **An external change is reported but never reconciled.** The interface shows the new hash while
   the editor keeps its own copy, so the next save silently discards the other writer's work.
   Stage 0 scoped detection only; reload and conflict handling belong to Stage 1. Demonstrated
   against the installed package, not inferred.
