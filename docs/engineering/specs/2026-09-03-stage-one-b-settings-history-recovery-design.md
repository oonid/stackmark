# Stage 1B — settings, history and recovery

- **Status:** Proposed.
- **Date:** 2026-09-03
- **Scope:** The second half of Stage 1 in the phase-one design, section 17. Stage 1A delivered the models, the contracts and both document stores.
- **Builds on:** ADR 0003 (Stage 1A contracts), design section 9.

## Context

Stage 1A split Stage 1 so the JavaScript-to-Rust boundary would be proven on the
smallest real feature before three repositories were built over it. That
boundary now has two checks on it: command names, shapes and the watcher event
are generated from the Rust definitions so drift is a build failure, and a round
trip drives the bundled binary so a command refused by the capability list still
fails a gate. Both earned their cost — the round trip found four defects in
Stage 1A that no other test could reach, and the capability check found a command
with no coverage at all.

This stage adds the three repositories to that established pattern.

Design section 9 describes storage and behaviour together: revisions and recovery
entries alongside autosave timing, journaling cadence and the conflict workflow.
Section 17 puts the conflict workflow in Stage 2. The behaviours are excluded
here, because deciding that a document is dirty requires editor state that does
not exist yet, and building a scheduler against the proof screen would mean
writing it twice.

## Decisions

### 1. The retention policy is a pure function

The difficult part of this stage is the rule, not the storage. It lives in
`packages/core` as a pure function that takes the revisions a document already
has and a candidate, and returns which to keep and which to drop. It knows
nothing about IndexedDB, SQLite, Tauri or Vue, and both surfaces call it.

Coalescing boundaries, day rollovers, byte pressure and expiry can then be tested
exhaustively with plain values. The two stores only have to persist a decision
somebody else made, which is a much smaller thing to get right twice.

### 2. A revision is a save that changed something, coalesced by time

Section 9 asks for "50 meaningful revisions" without defining the term. With
autosave firing after 750 milliseconds of quiet, a writing session produces
hundreds of saves, so the definition decides whether history reaches back hours
or minutes.

The rule, in full:

1. A save whose content hash differs from the newest revision starts a revision.
   A save that changes nothing records nothing.
2. Another save within **five minutes** replaces that revision rather than adding
   one.
3. The newest **50** are kept.
4. The first revision of each day is kept for **30 days**, and is exempt from
   rule 3.
5. If a document's stored revisions exceed **5 MB compressed**, the oldest
   non-daily revisions are dropped first, then the oldest dailies.

Without rule 2 there is a gap nothing covers. Fifty autosaves at that granularity
reach back a few minutes, and the next older point is the current day's first
snapshot, so recovering yesterday afternoon's version is impossible. Coalescing
gives the fifty a span of roughly four hours.

### 3. Revisions are compressed whole-document snapshots

Each revision holds the entire document, compressed. Markdown compresses roughly
three to five times, and rule 5 bounds a document's history in bytes as well as
in count, so one large file cannot consume the store.

Delta chains would be far smaller, and were rejected. A revision in a chain is
readable only if every delta before it is intact, so one damaged row costs every
revision after it, and rebuilding the chain is work demanded exactly when the
user is already recovering from something going wrong. For the feature whose
whole purpose is working after a failure, independent readability is worth the
bytes.

Each surface compresses with what is native to it. They never read each other's
bytes, so they need not share a format.

### 4. Global settings live beside the per-workspace databases

Stage 1A gave each workspace its own database, named by a digest of its canonical
root. Recent workspaces and interface preferences cannot live there: they would
vanish on switching workspace, and a recent-workspace list is global by
definition.

A second, application-global database holds them. Workspace-scoped data —
revisions, recovery entries, cursor positions — stays in the per-workspace
database, so removing a workspace discards its history by deleting one file, with
no cascade to get wrong and no store that grows without bound.

## Architecture

```
packages/core/
  revision.ts        Revision, RecoveryEntry, retention policy. Pure.
packages/platform/
  contracts.ts       + SettingsStore, HistoryStore, RecoveryStore
  web/               IndexedDB implementations
  tauri/             adapters over the generated bindings
apps/desktop/src-tauri/
  app_data.rs        new: the global database
  metadata.rs        + revisions, recovery entries, workspace settings
  commands.rs        + one command per repository operation
```

### Contracts

**`SettingsStore`** — `get`, `set` and `remove`, at global or workspace scope.

**`HistoryStore`** — `record(id, content)` applies the policy and returns what was
kept; `list(id)` returns revision summaries without content; `read(revisionId)`
returns one revision's content. It never writes to a document: restoring is a
choice about the editor's buffer, and that belongs to Stage 2.

**`RecoveryStore`** — `journal(id, content)` appends an entry; `pending()` lists
entries for documents with unsaved work; `clear(id)` discards them once a save has
succeeded.

## Error handling

The tagged error from Stage 1A is extended rather than replaced. Two categories
are added: a revision that no longer exists, because retention may have dropped
it between a list and a read, and a store that is full. Both are conditions a
caller can act on, which is the test the existing categories were chosen by.

## Testing

| Level | Covers |
|---|---|
| Pure unit | The retention policy: coalescing, day rollover, byte pressure, expiry |
| Unit, fake IndexedDB | The three web stores |
| Rust unit | Both databases, their migrations, and compression round trips |
| Round trip | The new commands, through the interface, on the built binary |
| Crash survival | Journal entries written, the process killed, the entries found |

The crash-survival test kills the process rather than closing it. Durability is
the one guarantee recovery exists to provide, and a clean shutdown demonstrates
nothing about it.

Every new test must fail when its implementation is deliberately broken. Stage 1A
produced a capability check that passed for a command with no coverage, and it
was found by testing for it rather than by reading it.

## Risks

**Compression must not go through `Blob`.** This was checked rather than left as
a risk. `CompressionStream`, `Blob`, `Response` and `TextEncoder` all exist under
jsdom, but `Blob.stream` is not a function, so the obvious pipeline throws. The
route that works builds a `ReadableStream` from an encoded `Uint8Array` and pipes
that through `CompressionStream`, reading the result with `Response`. A probe
compressed and decompressed text exactly, so the API is usable — only the
customary way of reaching it is not.

**The global database is a second migration path**, in code Stage 1A did not
touch. This one is still unproven and is the first task's business.

The remaining risk is proven in the first task rather than the last, for the
reason Stage 1A demonstrated twice: a mechanism that turns out not to work costs
the whole stage if it is discovered at the end.

## Acceptance criteria

1. The retention policy is a pure function in `packages/core` with no platform
   dependency, and its tests use no database.
2. Fifty revisions of a document coalesced at five-minute intervals span at least
   four hours.
3. The first revision of each day survives the newest-fifty rule for 30 days, and
   is dropped on the 31st.
4. A document whose revisions exceed 5 MB compressed loses its oldest non-daily
   revisions first.
5. A save that changes nothing adds no revision.
6. `HistoryStore.read` never modifies a document.
7. Settings set at global scope survive switching workspace; settings set at
   workspace scope do not appear in another workspace.
8. Deleting a workspace's database discards its revisions and recovery entries
   and leaves global settings intact.
9. Journal entries written before the process is killed are found after it
   restarts.
10. Every Stage 0 and Stage 1A gate still passes, including the round trip and
    the capability check.
11. Each new test fails when its implementation is deliberately broken.

## Out of scope

Autosave timing, journaling cadence, window-blur and shutdown hooks, the conflict
workflow and conflict records, restoring a revision into the editor, and
operating-system trash on deletion. All are Stage 2, and all need editor state
this stage does not have.
