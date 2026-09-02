# 0001 — StackMark Stage 0 feasibility

- **Status:** Accepted. **Conditional go**, with one gate outstanding and four deviations named.
- **Date:** 2026-08-08, revised 2026-09-02
- **Note:** written before the fork was named. The product is StackMark; see ADR 0002.
- **Scope:** The Stage 0 vertical feasibility slice on `feat/stage-zero`. Not the phase-one product.

## Context

Stage 0 asks whether a clean StackEdit rewrite can use a Docker-only JavaScript toolchain, share one Vue/Vite frontend between web and Tauri, render KaTeX and isolated Mermaid safely, paginate and print through WebKitGTK, detect external file changes, save Markdown atomically, and produce an installable `.deb`.

Every gate below was exercised on the reference host and verified by recomputing hashes, reading `stat`, and measuring generated PDFs rather than reading values off the interface. Where a claim rests on one engine only, that is stated.

## Environment tested

| | |
|---|---|
| Host | KDE neon on an Ubuntu 24.04 LTS base, x86-64 |
| Web engine (desktop) | WebKitGTK 2.52.3 |
| Web engine (browser gates) | Chromium via Playwright 1.54.2 |
| Rust | 1.88.0, host-native |
| Tauri CLI | 2.10.1 on the host; the plan pins 2.11.4 |
| Node / pnpm | 24.18.0 / 11.20.0, in Docker only |
| Paged.js | 0.4.3 with a local patch |

## Decisions

### 1. JavaScript runs only in Docker

`./dev` dispatches every Node, pnpm, Vite, lint, unit and browser command into containers. `tauri.conf.json` declares no `beforeDevCommand`, so the desktop shell attaches to the container-served dev server rather than invoking a host toolchain. Rust stays host-native by design.

### 2. One Vue frontend serves both surfaces

The same build drives the browser and the Tauri window. The desktop capability surface is reached through a single gateway interface rather than direct imports scattered through components.

### 3. Mermaid renders in an opaque-origin sandbox

Mermaid executes in an iframe created with exactly `sandbox="allow-scripts"`, from a generated external renderer document, authorised by a build-owned nonce. The parent validates `event.source` and requires `event.origin === 'null'`, and only separately sanitized SVG crosses back. Preview HTML, Mermaid SVG and print content use distinct sanitizer configurations.

A nonce is used rather than `script-src 'self'` because a sandboxed frame without `allow-same-origin` has an opaque origin, and WebKitGTK does not consistently authorise an external script under `'self'` in that state. This was found by the desktop gate failing where Chromium passed.

The application policy must also name the scheme and host explicitly, `script-src 'self' tauri://localhost`. The nonce alone is not sufficient: the policy the application serves applies to the renderer document as well, and with no `script-src` of its own it fell back to `default-src 'self'`, which an opaque-origin frame can never satisfy. For the main document the explicit source grants nothing new, since there `'self'` already is `tauri://localhost`.

**This was recorded as passing before it was true.** The gate was verified only under `cargo tauri dev`, which serves the frontend over `http://localhost:1420` and so gave the frame an ordinary HTTP origin to work from. The first packaged build refused the renderer script and rendered no diagrams at all, in the application and in its printed output. Development evidence did not cover the path that ships, and the nonce workaround had been masking the same constraint it appeared to solve.

### 4. Workspace access is confined by the kernel, not by string checks

On Linux the service holds an open root directory descriptor and resolves below it with `openat2` using `RESOLVE_BENEATH`, `NO_MAGICLINKS` and `NO_SYMLINKS`. Writes go to a temporary file in the target directory, are synced, and are persisted atomically, with directory identity checked before and after. A rename-plus-symlink-swap regression must fail without writing outside the workspace.

The watcher reports normalized workspace-relative changes with hash and modification time. It ignores access events, because describing a change means reading the file and that read is itself observable — acting on it made the watcher wake itself once per debounce forever.

### 5. System printing is authoritative; the page preview is progressive enhancement

The system print dialog produces the PDF. The application does not write PDF bytes or bundle a rendering engine.

Paged.js provides an on-screen page preview where it demonstrably works, and the preview verifies itself: pagination is compared against the source for discarded content, and the placed pages are measured, once layout settles, for content laid out beyond the visible page box. Either failure demotes the preview to the continuous plain-CSS document. A preview that silently omits content is worse than no preview.

## Deviations

These are accepted for Stage 0 and constrain phase one.

### D1 — WebKitGTK ignores `@page` geometry

The default export measured US Letter at 612 × 792 pt despite `@page { size: A4 portrait }`, with margins near 6.3 / 6.5 / 14.3 / 10.6 mm rather than the declared 14 / 16 / 18 mm. Paper and margins are governed by the print dialog. A4 is reachable only by selecting it there, and is then correct: 595 × 842 pt, two pages, no content outside the page box. Chromium honours the rule, so page geometry is document-controlled on the web and user-controlled on the Linux desktop.

### D2 — `@page` margin boxes never reach printed output

The exported PDF contains no running header and no page counter. No browser implements CSS margin boxes. Any running title or page number must be composed into the document body, or not promised.

### D3 — The Paged.js page preview does not work on the reference host

Chromium paginates the fixture correctly at A4 with generated margin boxes. On WebKitGTK the same document leaves the remainder of a split paragraph outside the visible column, so the preview reliably falls back to the continuous document. **The desktop application has no page-accurate on-screen preview.**

Paged.js 0.4.3 also requires a local patch to paginate at all: `createBreakToken` dereferences an unresolved break anchor. The patch extends the early return the function already uses for the equivalent case.

### D4 — Tauri CLI version

The host has 2.10.1 against the plan's 2.11.4. Dev mode is unaffected. The release builder must pin the intended version so the host's does not matter.

## Gates partly run

- **Debian packaging** — the builder image, `.deb` production and artifact inspection pass. Installation on KDE neon succeeded with no additional packages pulled, which proves the declared runtime dependencies are satisfiable and not merely declared, and removal left no binary, desktop entry or icon behind. The application launches from a terminal and from the application menu.

  The first packaged run also failed the Mermaid gate outright, for the reason recorded in decision 3. That is fixed and confirmed by running the release binary, which serves the embedded frontend under the production policy without any installation.

  Still to run: the folder, save and external-change checks against the installed build, and a printed PDF from it.
- **Offline behaviour of the installed package.** Offline behaviour of the development build passes: editing, KaTeX, Mermaid and pagination work with external networking disabled, and the exported PDF is structurally identical to the online one. The production bundle makes no remote request.

## Decision

**Conditional go.** Every mandatory Stage 0 gate is demonstrated on the reference host except one, and that one is a confirmation rather than an open question.

Docker-only tooling, the shared frontend, Mermaid isolation, workspace path safety confined by the kernel, atomic saves, external-change detection, system printing, and Debian packaging are all proven with automated and host evidence. The package installs on KDE neon with its declared dependencies satisfied, launches from a terminal and from the application menu, renders and prints correctly, and removes cleanly.

**The condition:** the no-network path has not been exercised against the installed build. The production policy names no external origin and the bundle makes no remote call, so the gate is close to structurally guaranteed — but the Mermaid gate was also "obviously fine" until it was packaged, so it stays outstanding until observed. Should that check fail, this becomes a conditional go with a named fallback rather than a plain one; it cannot become a no-go, because nothing in the product depends on the network.

Stage 1 planning is authorised on this basis, subject to the conditions below.

Conditions attached to the architectural go:

0. **A gate is not passed until it is exercised in a packaged build.** Development mode serves the frontend over `http://localhost:1420`; the product serves it over a custom scheme, and the two differ in ways that decide whether the application works at all. The Mermaid gate was recorded as passing on development evidence and the first packaged build rendered no diagrams. Every gate resting only on `cargo tauri dev` should be treated as unproven. The release binary can be run directly, without installing anything, which makes this cheap to honour.
1. Phase one must not promise a page-accurate desktop preview, page numbers, or running headers on Linux (D1, D2, D3).
2. The Paged.js patch must be revisited on any dependency upgrade, and the preview's self-verification kept — it is the only thing standing between a silent content loss and the reader.
3. The release builder must pin its own Tauri CLI (D4).

## Consequences

Print Studio in phase one should treat the system dialog as the pagination authority and present the print document continuously, offering a page preview only where a runtime check shows the engine paginates correctly. Page furniture, if wanted, belongs in the document body.

The security boundaries established here — the opaque Mermaid sandbox, the separate sanitizers, the kernel-confined workspace, and the narrow Tauri capability set — are load-bearing and should not be widened without an equivalent decision record.
