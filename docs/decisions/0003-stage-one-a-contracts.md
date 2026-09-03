# 0003 — Stage 1A contracts and document persistence

- **Status:** Proposed. Conditional go, pending the host gates named below.
- **Date:** 2026-09-03
- **Scope:** The first half of Stage 1: core models, platform contracts, a web
  and a desktop document store, and a tested JavaScript-to-Rust boundary.
  Settings, history and recovery are Stage 1B.
- **Evidence:** `docs/engineering/evidence/stage-1a.md`

## Context

Stage 1 as written in section 17 delivers the models, both storage adapters and
three repositories together. That roughly doubles the JavaScript-to-Rust surface,
and at the start of this stage nothing crossed that boundary with any check on
it: renaming a command on either side left every test green while the
application was broken. The stage was split so the boundary would be proven on
the smallest real feature before three repositories were built over it.

## Decisions

### 1. The boundary is checked twice, and neither check subsumes the other

Command names, shapes and the watcher event name are generated from the Rust
definitions and committed, so drift is a build failure. A round-trip test drives
the bundled binary through real inter-process communication, so a command that
type-checks and is then refused at runtime still fails a gate.

Generation cannot see `capabilities/main.json`. Both defects that reached a
Stage 0 build already recorded as passing were configuration of exactly that
kind. The round trip is the only check in the project that sees it.

### 2. Rust owns the SQLite store

Rust owns the schema, the migrations and every query; TypeScript reaches them
only through purpose-built commands whose types are generated. A general SQL
bridge would have been less code and would have granted the webview arbitrary
access to application data, widening a capability set ADR 0001 records as
load-bearing.

### 3. Documents are addressed by identifier

Only creating and renaming take a path, because choosing a location is what those
operations are, and it is a workspace-relative logical path normalized and
refused before anything reaches the filesystem. No command takes a workspace
root. Stage 0 established that the untrusted side cannot choose the root its file
access is confined to; this extends the property so it cannot name a path inside
that root either. A test reads the command signatures and enforces it.

### 4. Errors are categories, not sentences

Commands return a tagged error separating a path refused for leaving the
workspace, a document that is absent, and a file that changed underneath, from an
unexpected fault. Stage 2's conflict workflow turns on telling a stale write from
a failed one, and recovering that from message text later would have been much
worse than naming it now.

## Deviations

### D1 — The generator is a release candidate

`tauri-specta` has no stable release for Tauri 2. The pair that builds on the
pinned Rust 1.88.0 is `tauri-specta` 2.0.0-rc.21 with `specta` 2.0.0-rc.22, both
pinned exactly. The latest candidate requires a newer compiler, so these pins
cannot be advanced until the toolchain moves. Accepted deliberately: the
alternative was a stable generator that produces types but not command wrappers,
leaving a rename to be caught by a test rather than by the compiler.

### D2 — Creating a document in a subdirectory fails on the desktop

`notes/daily.md` in a workspace with no `notes` folder is refused. The web store
accepts it, because IndexedDB has no directories. Two implementations of one
contract behaving differently is what contracts exist to prevent, so the contract
documents the asymmetry rather than implying it works. Creating a directory has
to happen beneath the held root descriptor to stay confined, and that work is not
done here.

## Findings closed

**No test crosses the JavaScript to Rust boundary.** Closed by both mechanisms.

**Mutex poisoning would make every later workspace operation fatal.** Both locks
now recover. The data behind them is a handle that is no less valid because an
unrelated call panicked, so recovery is correct here rather than merely
convenient — the same change would be wrong for a lock guarding an invariant a
panic could leave half-updated.

**`?printFallback=1` is a production backdoor.** The parameter is now read behind
a build-time flag that folds to `false`, so the branch leaves the production
bundle rather than being guarded at runtime. Verified against the built assets,
with a control string to prove the search would have found it.

## Decision

**Conditional go.** The boundary is proven, both storage implementations satisfy
the same contract, and the packaged artifact passes inspection with its
dependency set unchanged.

The condition is not procedural. Stage 1A rewrote the code behind folder
selection, saving, external-change detection and printing, and ADR 0001 condition
0 says a gate is not passed until it is exercised in a packaged build. Those four
gates must be run against the installed package before Stage 1B is authorised.
The stage produced four defects that only appeared when the built application was
driven, which is the argument for the condition rather than an exception to it.

Conditions carried forward:

1. The generated bindings and the round trip are both load-bearing. Removing
   either leaves a class of failure with no check on it.
2. A permission removed from the capability list must turn the round trip red.
   That property is the whole reason the mechanism exists, and it silently held
   for a command with no coverage until it was tested for.
3. D2 must be resolved before a document tree of any depth is offered to a user.
