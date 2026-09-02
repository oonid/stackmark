# Stage 1A — contracts and document persistence

- **Status:** Proposed.
- **Date:** 2026-09-02
- **Scope:** The first half of Stage 1 in the phase-one design, section 17. Settings, history and recovery are deferred to Stage 1B.
- **Builds on:** ADR 0001 (Stage 0 feasibility), ADR 0002 (fork identity), the Stage 0 to Stage 1 handover.

## Context

Stage 0 proved the platform. It did not build the product. What exists today is a
vertical feasibility slice: a proof screen, one hardcoded document path, and a
gateway named for what it demonstrated rather than what it does. The handover
separates the parts that are foundation from the parts that are scaffolding, and
this design consumes that separation rather than restating it.

Section 17 defines Stage 1 as the monorepo, core models, platform contracts, the
web IndexedDB adapter, the desktop filesystem adapter, and the settings, history
and recovery repositories, with contract tests. The monorepo already exists. The
rest is split here because Stage 1 as written roughly doubles the JavaScript to
Rust surface, and that boundary currently has no test coverage at all: renaming a
command or an event string on either side leaves every test green while the
application is broken. Establishing a tested boundary on the smallest real
feature is worth more than delivering three repositories over an untested one.

Two defects reached builds that had already been recorded as passing gates. Both
were configuration rather than code — a content policy, and a capability list —
and neither reproduced in Chromium. That history sets the standard the contract
tests here have to meet.

## Decisions

### 1. The scope is contracts and documents

Core models, the platform contract layer, a web document store, a desktop
document store, generated bindings, and the tests that cross the boundary.
Settings, history and recovery follow in Stage 1B, on a contract that is by then
proven rather than proposed.

### 2. The boundary is tested twice, in different ways

TypeScript command and event types are generated from the Rust definitions, so a
rename is a compile error. A round-trip test drives the built binary through real
inter-process communication with the real capability list, so a command that
type-checks and is then denied at runtime still fails a gate.

Neither mechanism subsumes the other. Generation cannot see
`capabilities/main.json`; the round-trip test reports drift later and further from
its cause. The defect that shipped was of exactly the first kind.

### 3. Rust owns the SQLite store

Section 6 fixes desktop metadata and history as SQLite in application data. Rust
owns the schema, the migrations and every query, and TypeScript reaches it only
through purpose-built commands whose types are generated.

The alternative — a generic SQL bridge — is less code and grants the web layer
arbitrary SQL against application data. ADR 0001 records the narrow capability set
as load-bearing and asks that it not be widened without an equivalent decision.
This is that decision, and it declines to widen it.

### 4. The proof screen is migrated, not yet deleted

The round-trip test needs a surface to drive, and the editor shell is Stage 2. The
proof screen is rewired onto the real contracts and driven by the round-trip test,
which keeps the application runnable and honours the rule that a gate is not
passed until it is exercised in a packaged build. Stage 2 deletes it, as the
handover says.

`?printFallback=1` is removed in this stage rather than in Stage 2. It is a
production backdoor — any user who lands on that query parameter gets degraded
printing — and Stage 1A is already editing the code around it. The fallback keeps
a test seam that is not reachable from a URL.

## Architecture

```
packages/core/          Documents, workspace references, path normalization.
                        No Vue, no DOM, no browser storage, no Rust assumptions.
packages/platform/
  contracts.ts          WorkspaceHost, DocumentStore
  web/                  IndexedDB implementation
  tauri/                Generated bindings and the adapter over them
apps/desktop/src-tauri/
  workspace.rs          Existing: openat2 confinement, atomic write, watcher
  metadata.rs           New: SQLite. Workspace identity, document id to path,
                        migrations
  commands.rs           Typed commands, annotated for generation
```

The layering follows section 5: components call services, services call contracts,
and only adapters know about IndexedDB, the filesystem or Tauri.

### Contracts

**`WorkspaceHost`** adopts a workspace and watches it. The desktop implements it;
the web reports `unsupported`. This is the Stage 0 gateway pattern, which the
handover asks Stage 1 to follow, under a name that describes the job.

**`DocumentStore`** lists, reads, writes, renames and deletes documents by
identifier. Both surfaces implement it: IndexedDB on the web, files plus SQLite on
the desktop.

### The invariant this establishes

The desktop write path is:

1. A service calls `DocumentStore.write(id, content)`.
2. The Tauri adapter calls a generated binding.
3. Rust resolves the identifier to a workspace-relative path in SQLite.
4. `openat2` resolves that path beneath the held root descriptor, with
   `RESOLVE_BENEATH`, `NO_MAGICLINKS` and `NO_SYMLINKS`.
5. The content is written to an adjacent temporary file, flushed, and renamed
   into place, with directory identity checked before and after.
6. SQLite records the new hash and modification time only after success.

The identifier-to-path mapping exists only in Rust. TypeScript never sends a
filesystem path. Stage 0 established that the untrusted side cannot choose the
root its file access is confined to; this extends the property so it cannot name
a path inside that root either.

Web writes use a single IndexedDB transaction, so a failure leaves the previously
committed document intact.

## Generated bindings

Command and event types are generated from the Rust definitions at build time and
committed. Continuous integration regenerates them and fails if the result differs
from what is committed, which makes drift a build failure rather than something
discovered by a user.

Generation covers names, argument shapes and return shapes. It does not cover
whether a command is permitted, which is why it is not sufficient on its own.

## The round-trip test

A WebDriver session drives the built binary under a virtual display, invoking
every command through real inter-process communication against the real capability
list, and asserting the watcher event arrives. It runs in continuous integration
and against the packaged artifact.

This is the only mechanism in the project that would have caught either defect
that reached a passing build, because both were configuration that development
mode did not exercise.

## Error handling

Commands currently return `Result<T, String>`, so every failure is an opaque
message and callers cannot distinguish a path outside the workspace from an
unexpected fault. They will return a tagged error instead, separating at least:
the target is outside the workspace, the document does not exist, the file changed
underneath us, and an unexpected fault.

This is deliberately done now rather than in Stage 2. Stage 2's conflict workflow
depends on telling a stale write from a failed one, and once callers parse strings
the change becomes expensive.

## Testing

| Level | Covers |
|---|---|
| Unit, no DOM | Core model, path normalization |
| Unit, fake IndexedDB | The web document store |
| Rust unit | Migrations, identifier mapping, confinement, atomic replace |
| Browser integration | The web store against real IndexedDB |
| Round trip | Every command and the watcher event, on the built binary |
| Build | Generated bindings match the committed ones |

Existing Stage 0 gates continue to run unchanged. The browser suite covering
Mermaid isolation and print pagination is not coupled to the gateway and should
keep passing throughout; if one breaks, that is a regression rather than an
expected consequence.

Tests must fail when the implementation is broken deliberately. Stage 0 produced
several tests that passed against a disabled fix, and each was found by breaking
the code on purpose rather than by reading it.

## Findings closed and carried

Closed by this stage: **finding 1**, no test crosses the JavaScript to Rust
boundary, by both mechanisms above. **Finding 4**, mutex poisoning would make
every later workspace operation fatal, because the state handling it concerns is
rewritten here and fixing it in passing is cheaper than carrying it.

Carried unchanged: pagination timeouts that reject without cancelling the
underlying operation; a FIFO named `*.md` blocking the reading thread and then the
watcher; the non-Linux filesystem path being check-then-use; the watcher hashing
whole files on the shared thread; symlink replacement being silently ignored; the
`.deb` build not being reproducible; and an external change being reported but
never reconciled. None of these are addressed here, and naming them is preferable
to implying otherwise.

## Risks

**The generator may not support the pinned Tauri version.** Compatibility with
Tauri 2.11.x is assumed and unverified.

**WebDriver on WebKitGTK may be unreliable in continuous integration.** It needs a
driver package and a virtual display, and neither has been run here.

Both are proven in the first task rather than the last. Stage 0 recorded the
Mermaid gate as passing on development evidence and the first packaged build
rendered no diagrams at all; the cost of discovering an unworkable mechanism at
the end of a stage is the whole stage.

## Acceptance criteria

1. `packages/core` holds the document model and path normalization, with no Vue,
   DOM, browser-storage or Rust dependency.
2. `WorkspaceHost` and `DocumentStore` are defined once and implemented twice.
3. A document can be created, listed, read, written, renamed and deleted on both
   surfaces through the same contract.
4. TypeScript sends no filesystem path to Rust in any command.
5. Regenerating the bindings produces no diff, and continuous integration enforces
   this.
6. The round-trip test invokes every command and observes the watcher event
   against the built binary, and fails when a permission is removed from
   `capabilities/main.json`.
7. Commands return tagged errors that distinguish the categories named above.
8. `?printFallback=1` is gone, and the fallback path is still covered by a test.
9. Every Stage 0 gate still passes, including the full browser suite.
10. Each new test fails when its implementation is deliberately broken.

## Out of scope

Settings, history and recovery repositories, which are Stage 1B. The editor shell,
explorer, CodeMirror adapter, autosave, preview, scroll synchronization, search and
the conflict workflow, which are Stage 2. Print Studio, which is Stage 3. Deleting
the proof screen, which is Stage 2's work once a real interface replaces it.
