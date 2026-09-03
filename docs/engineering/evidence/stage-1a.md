# Stage 1A evidence — contracts and document persistence

**Recorded:** 2026-09-03
**Branch:** `feat/stage-one-a`
**Host:** KDE neon on Ubuntu 24.04, x86-64, WebKitGTK 2.52.3, Rust 1.88.0

Every figure here was produced by running the thing described, on this host. Where
a claim rests on one build or one engine, that is said.

## Gates

| Gate | Result |
|---|---|
| `./dev unit` | 112 passed — core 9, markdown 25, print 36, platform 31, web 11 |
| `./dev lint` | pass |
| `./dev e2e` | 21 passed |
| `cargo test` | 39 passed across 11 suites |
| Round trip on the built binary | 3 passed |
| `scripts/inspect-deb.sh` | PASS |

Artifact: `stackmark_0.1.0-stage0_amd64.deb`, 6.1 MB,
`a2ec433ec0206a89335dab01ff1bcc3b7cce4d5db8e4f56d173e56a21927b568`.

## The two boundary mechanisms

**Generated bindings.** Command names, argument shapes, return shapes and the
watcher event name are generated from the Rust definitions and committed.
Renaming `read_markdown` in Rust changed both the TypeScript function name and
the `TAURI_INVOKE` string, so the committed file no longer matched; continuous
integration fails on that difference.

The generator has no stable release for Tauri 2 — the whole version 2 line is
release candidates, and the only stable release targets Tauri 1. The latest
candidate needs a newer compiler than the pinned 1.88.0. `tauri-specta`
2.0.0-rc.21 with `specta` 2.0.0-rc.22 builds, and both are pinned exactly. They
cannot be advanced until the toolchain moves.

**Round trip.** A WebDriver session drives the bundled binary and invokes every
document command through the interface.

| Capability list | Round trip |
|---|---|
| Complete | 3 passed |
| `allow-atomic-write-markdown` removed (Task 2 command set) | 1 failed |
| `allow-write-document` removed (final command set) | 1 failed |

## What the round trip found that nothing else could

Four defects, each in the seam between components that individually passed.

1. **A plain release build is not the product.** `cargo build --release` produces
   a binary that loads the development server URL and renders an empty document.
   The first round-trip attempt drove that, found no interface, and would have
   proved nothing had an element lookup happened to succeed.
2. **Creating a document in a subdirectory fails.** `notes/daily.md` in a
   workspace with no `notes` folder returns "No such file or directory". The web
   store accepts it, because IndexedDB has no directories. Recorded, not fixed:
   see the carried findings.
3. **Renaming moved the register and not the file.** The document then pointed
   at a path with nothing behind it, and the original was orphaned under its old
   name. The metadata tests passed because the register updated correctly; the
   workspace tests passed because the filesystem code was never called.
4. **The watcher never started unless the picker ran.**
   `start_workspace_watch` was called only from `adopt`, so a workspace adopted
   from a startup path — the arrangement added in Task 2 to make the application
   drivable — never detected an external change at all.

## What the capability check found

Removing `allow-write-document` left all three round-trip tests passing. The
mechanism was sound; the coverage was not. On a fresh workspace the save action
takes the `create` path, so `write_document` was never invoked by any test.
Acceptance criterion 6 says the round trip invokes every command, and without
this check it would have been recorded as met while one command had no coverage.

Fixing the coverage exposed a second defect. A command refused by the capability
list is rejected by the host with a plain string rather than a tagged error, and
the adapter read `.message` off it, so the interface reported `Writing failed:
undefined` — the opaque failure the tagged categories exist to replace, arriving
through the one path nobody had exercised. Both adapters now describe a
non-tagged failure.

## Packaging

`Depends: libwebkit2gtk-4.1-0, libgtk-3-0` — unchanged from the Stage 0 package.

SQLite is compiled into the binary rather than linked. `libsqlite3.so.0` appears
in `ldd` output, which looks at first like a new dependency, but `objdump -p`
shows zero direct `NEEDED` entries for it: it arrives transitively through
`libwebkit2gtk-4.1.so.0`, which needs it directly and is already declared.

## Not verified here

- **The four host gates against the installed package.** Stage 1A rewrote the
  code behind folder selection, saving, external-change detection and printing.
  ADR 0001 condition 0 says a gate is not passed until it is exercised in a
  packaged build, so these must be run against the installed `.deb` before the
  stage is called complete.
- **Reproducibility.** Successive builds still produce different artifacts.
- **The non-Linux filesystem path**, which remains check-then-use and unreachable
  on the shipped target.

## Corrections to earlier records

Acceptance criterion 4 originally read "TypeScript sends no filesystem path to
Rust in any command", which contradicted the contract: `create` and `rename` take
a path because choosing a location is what those operations are. It now states
what is enforceable, and a test reads the command signatures to keep it.
