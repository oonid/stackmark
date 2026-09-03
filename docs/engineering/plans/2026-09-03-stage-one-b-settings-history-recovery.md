# Stage 1B Implementation Plan — settings, history and recovery

> **How to work this plan:** implement it task by task, in order, and complete a task's prescribed checks before starting the next. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add settings, history and recovery repositories on both surfaces, with the retention rule as a pure function that neither store owns.

**Architecture:** The retention policy lives in `packages/core` and knows nothing about storage; both surfaces call it and then persist what it decided. Revisions are whole compressed snapshots. A second, application-global database holds settings that must outlive a workspace, beside the per-workspace databases Stage 1A created.

**Tech Stack:** TypeScript 6.0.2, Vitest 4.1.10, Rust 1.88.0, Tauri 2.11.5, rusqlite 0.40.2, `tauri-specta` 2.0.0-rc.21, `CompressionStream`, `flate2`, Docker Compose.

**Design:** `docs/engineering/specs/2026-09-03-stage-one-b-settings-history-recovery-design.md`

## Global Constraints

- Run every Node, pnpm, Vite, formatter, lint, unit-test and browser-test command through `./dev`. Do not install or invoke host Node.js or pnpm. Rust is host-native.
- Pin every dependency exactly: `=<version>` in `Cargo.toml`, a bare version with no range prefix in `package.json`. Copy the resolved version out of the lockfile after adding.
- Documents are addressed by identifier. No command may take a workspace root or an absolute path. `tests/command_surface.rs` enforces this and must keep passing.
- Do not widen `apps/desktop/src-tauri/capabilities/main.json` beyond the commands this plan adds. Every new command needs its own permission in `permissions/workspace.toml`.
- Commands return `Result<_, DesktopError>`. An opaque string leaves a caller unable to tell one failure from another.
- Regenerating the bindings must produce no diff. `cargo test --test bindings` writes them; continuous integration fails on a stale file.
- Compression on the web must not go through `Blob`. `Blob.stream` is not a function under jsdom, so build a `ReadableStream` from an encoded `Uint8Array` instead.
- Every new test must fail when its implementation is deliberately broken. Prove it by breaking the code, running the test, and restoring.
- Commit messages carry no co-authorship trailer, no tooling or model names, and no absolute paths from a contributor's machine.
- A gate is not passed until it is exercised against a packaged build. Use `./dev desktop-build`; a plain `cargo build --release` produces a binary that loads the development server URL and renders nothing.

---

## File Structure

**Created:**

| Path | Responsibility |
|---|---|
| `packages/core/src/revision.ts` | `Revision`, `RecoveryEntry`, and the retention policy. Pure. |
| `packages/core/src/revision.test.ts` | The policy, tested with plain values and no database |
| `packages/platform/src/web/compression.ts` | Gzip helpers that avoid `Blob` |
| `packages/platform/src/web/settings-store.ts` | Settings on IndexedDB |
| `packages/platform/src/web/history-store.ts` | Revisions on IndexedDB |
| `packages/platform/src/web/recovery-store.ts` | Recovery journal on IndexedDB |
| `packages/platform/src/tauri/settings-store.ts` | Settings over the generated bindings |
| `packages/platform/src/tauri/history-store.ts` | Revisions over the generated bindings |
| `packages/platform/src/tauri/recovery-store.ts` | Recovery journal over the generated bindings |
| `apps/desktop/src-tauri/src/app_data.rs` | The application-global database |
| `apps/desktop/src-tauri/src/compression.rs` | Gzip helpers for the desktop |
| `apps/desktop/src-tauri/tests/app_data.rs` | Global database and its migration |
| `apps/desktop/src-tauri/tests/history.rs` | Revisions, recovery entries, compression |
| `apps/desktop/src-tauri/tests/crash_recovery.rs` | Journal entries survive the process being killed |

**Modified:**

| Path | Change |
|---|---|
| `packages/core/src/index.ts` | Export the new model and policy |
| `packages/platform/src/contracts.ts` | Add three contracts and two error categories |
| `packages/platform/src/index.ts` | Export the six new stores |
| `apps/desktop/src-tauri/src/error.rs` | Add `RevisionGone` and `StoreFull` |
| `apps/desktop/src-tauri/src/metadata.rs` | Add revisions, recovery entries, workspace settings |
| `apps/desktop/src-tauri/src/lib.rs` | Open the global database; register the new commands |
| `apps/desktop/src-tauri/src/commands.rs` | Commands for the three repositories |
| `apps/desktop/src-tauri/capabilities/main.json` | Permissions for the new commands only |
| `apps/web/src/App.vue` | Harness controls, so the round trip can reach the new commands |
| `apps/desktop/src-tauri/tests/roundtrip.rs` | Cases for the new commands |

---

## Task 1: The global database

Proven first because it is the stage's one unproven mechanism. Stage 1A's
database is per-workspace and opened when a workspace is adopted; this one is
opened at startup and must exist before any workspace does.

**Files:**
- Create: `apps/desktop/src-tauri/src/app_data.rs`
- Create: `apps/desktop/src-tauri/tests/app_data.rs`
- Modify: `apps/desktop/src-tauri/src/lib.rs`

**Interfaces:**
- Produces: `AppData::open(path: &Path) -> Result<AppData, DesktopError>`, `AppData::open_in_memory()`, `AppData::migrate()`, `AppData::user_version()`, `AppData::get(key: &str) -> Result<Option<String>, DesktopError>`, `AppData::set(key: &str, value: &str)`, `AppData::remove(key: &str)`, `AppData::recent_workspaces() -> Result<Vec<String>, DesktopError>`, `AppData::remember_workspace(root: &str)`.

- [ ] **Step 1: Write the failing test**

```rust
use stackmark_desktop::app_data::AppData;
use stackmark_desktop::error::DesktopError;

#[test]
fn a_setting_survives_being_written_and_read() {
    let store = AppData::open_in_memory().unwrap();
    store.set("theme", "dark").unwrap();
    assert_eq!(store.get("theme").unwrap(), Some("dark".to_string()));
}

#[test]
fn an_absent_setting_is_none_rather_than_an_error() {
    let store = AppData::open_in_memory().unwrap();
    assert_eq!(store.get("never-set").unwrap(), None);
}

#[test]
fn setting_a_key_twice_replaces_it() {
    let store = AppData::open_in_memory().unwrap();
    store.set("theme", "dark").unwrap();
    store.set("theme", "light").unwrap();
    assert_eq!(store.get("theme").unwrap(), Some("light".to_string()));
}

#[test]
fn migrations_are_idempotent() {
    let store = AppData::open_in_memory().unwrap();
    store.migrate().unwrap();
    store.migrate().unwrap();
    assert_eq!(store.user_version().unwrap(), 1);
}

#[test]
fn recent_workspaces_are_newest_first_and_not_duplicated() {
    let store = AppData::open_in_memory().unwrap();
    store.remember_workspace("/tmp/a").unwrap();
    store.remember_workspace("/tmp/b").unwrap();
    store.remember_workspace("/tmp/a").unwrap();

    assert_eq!(
        store.recent_workspaces().unwrap(),
        vec!["/tmp/a".to_string(), "/tmp/b".to_string()]
    );
}

#[test]
fn removing_a_setting_leaves_the_others() {
    let store = AppData::open_in_memory().unwrap();
    store.set("a", "1").unwrap();
    store.set("b", "2").unwrap();
    store.remove("a").unwrap();

    assert_eq!(store.get("a").unwrap(), None);
    assert_eq!(store.get("b").unwrap(), Some("2".to_string()));
}

#[test]
fn removing_something_absent_reports_not_found() {
    // Deliberately an error rather than a silent success: a caller removing a
    // key it believes exists should learn that it did not.
    let store = AppData::open_in_memory().unwrap();
    assert!(matches!(store.remove("never-set"), Err(DesktopError::NotFound)));
}
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd apps/desktop/src-tauri && cargo test --test app_data`
Expected: FAIL, `unresolved import stackmark_desktop::app_data`.

- [ ] **Step 3: Implement the global database**

Create `src/app_data.rs`. It mirrors `metadata.rs`: a `Mutex<Connection>`
accessed through a guard that recovers from poisoning, and a `migrate` guarded on
`PRAGMA user_version`.

```rust
use std::path::Path;
use std::sync::{Mutex, MutexGuard};

use rusqlite::{params, Connection, OptionalExtension};

use crate::error::DesktopError;

const SCHEMA_VERSION: i64 = 1;

pub struct AppData {
    connection: Mutex<Connection>,
}

impl AppData {
    pub fn open(path: &Path) -> Result<Self, DesktopError> {
        let store = Self { connection: Mutex::new(Connection::open(path)?) };
        store.migrate()?;
        Ok(store)
    }

    pub fn open_in_memory() -> Result<Self, DesktopError> {
        let store = Self { connection: Mutex::new(Connection::open_in_memory()?) };
        store.migrate()?;
        Ok(store)
    }

    /// Recovers from a poisoned lock, for the reason recorded in `metadata.rs`:
    /// a panic elsewhere must not make every later call fatal.
    fn connection(&self) -> MutexGuard<'_, Connection> {
        self.connection.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    pub fn migrate(&self) -> Result<(), DesktopError> {
        let connection = self.connection();
        let version: i64 = connection.query_row("PRAGMA user_version", [], |row| row.get(0))?;
        if version >= SCHEMA_VERSION {
            return Ok(());
        }
        connection.execute_batch(
            "CREATE TABLE IF NOT EXISTS settings (
                 key   TEXT PRIMARY KEY,
                 value TEXT NOT NULL
             );
             CREATE TABLE IF NOT EXISTS recent_workspaces (
                 root      TEXT PRIMARY KEY,
                 opened_ms INTEGER NOT NULL
             );",
        )?;
        connection.pragma_update(None, "user_version", SCHEMA_VERSION)?;
        Ok(())
    }

    pub fn user_version(&self) -> Result<i64, DesktopError> {
        Ok(self.connection().query_row("PRAGMA user_version", [], |row| row.get(0))?)
    }

    pub fn get(&self, key: &str) -> Result<Option<String>, DesktopError> {
        Ok(self
            .connection()
            .query_row("SELECT value FROM settings WHERE key = ?1", params![key], |row| row.get(0))
            .optional()?)
    }

    pub fn set(&self, key: &str, value: &str) -> Result<(), DesktopError> {
        self.connection().execute(
            "INSERT INTO settings (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![key, value],
        )?;
        Ok(())
    }

    pub fn remove(&self, key: &str) -> Result<(), DesktopError> {
        let changed = self
            .connection()
            .execute("DELETE FROM settings WHERE key = ?1", params![key])?;
        if changed == 0 {
            return Err(DesktopError::NotFound);
        }
        Ok(())
    }

    /// Newest first. Re-opening a workspace moves it to the front rather than
    /// adding a second entry, which is what makes the list useful.
    pub fn remember_workspace(&self, root: &str) -> Result<(), DesktopError> {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|elapsed| elapsed.as_millis() as i64)
            .unwrap_or(0);
        self.connection().execute(
            "INSERT INTO recent_workspaces (root, opened_ms) VALUES (?1, ?2)
             ON CONFLICT(root) DO UPDATE SET opened_ms = excluded.opened_ms",
            params![root, now],
        )?;
        Ok(())
    }

    pub fn recent_workspaces(&self) -> Result<Vec<String>, DesktopError> {
        let connection = self.connection();
        let mut statement =
            connection.prepare("SELECT root FROM recent_workspaces ORDER BY opened_ms DESC")?;
        let rows = statement
            .query_map([], |row| row.get(0))?
            .collect::<Result<Vec<String>, _>>()?;
        Ok(rows)
    }
}
```

- [ ] **Step 4: Register the module and run**

Add `pub mod app_data;` to `src/lib.rs` beside `pub mod commands;`.

Run: `cargo test --test app_data`
Expected: PASS, 7 tests.

Note: `remember_workspace` writes a millisecond timestamp, so two calls in the
same millisecond order arbitrarily. The test above writes three distinct roots,
which cannot collide on primary key, but if it proves flaky, order by `rowid`
descending as a tiebreak rather than adding a sleep.

- [ ] **Step 5: Open it at startup**

In `src/lib.rs`, add `pub app_data: Mutex<Option<AppData>>` to `DesktopState`
with a `app_data_guard()` accessor matching `workspace_guard()`, and open it in
the `setup` hook before any workspace is adopted:

```rust
let data_dir = app.path().app_data_dir().map_err(|error| error.to_string())?;
std::fs::create_dir_all(&data_dir).map_err(|error| error.to_string())?;
let global = AppData::open(&data_dir.join("stackmark.sqlite3"))
    .map_err(|error| error.to_string())?;
*app.state::<DesktopState>().app_data_guard() = Some(global);
```

- [ ] **Step 6: Prove the tests have teeth**

Change `ON CONFLICT(key) DO UPDATE SET value = excluded.value` to `DO NOTHING`,
run `cargo test --test app_data`, and confirm
`setting_a_key_twice_replaces_it` fails. Restore it.

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src-tauri
git commit -m "feat: add the application-global settings database"
```

---

## Task 2: The retention policy

Pure, and the hardest thing in the stage. It is written before any storage so
that nothing about a database can leak into it.

**Files:**
- Create: `packages/core/src/revision.ts`, `packages/core/src/revision.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Produces:

```ts
export interface Revision {
  id: string
  documentId: DocumentId
  contentHash: string
  recordedAt: number
  /** Compressed byte length, for the budget in rule 5. */
  byteLength: number
  /** The first revision of its day, protected from the newest-fifty rule. */
  daily: boolean
}

export interface RetentionOptions {
  coalesceWithinMs?: number
  keepRecent?: number
  keepDailyForDays?: number
  budgetBytes?: number
}

export interface RetentionOutcome {
  /** Revisions to delete. */
  drop: Revision[]
  /** True when the candidate replaces the newest revision rather than adding one. */
  replacesNewest: boolean
  /** False when the candidate changed nothing and must not be stored. */
  record: boolean
}

export function applyRetention(
  existing: Revision[],
  candidate: { contentHash: string; recordedAt: number; byteLength: number },
  options?: RetentionOptions,
): RetentionOutcome
```

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from 'vitest'

import { applyRetention, type Revision } from './revision'

const DAY = 86_400_000
const MINUTE = 60_000

function revision(index: number, at: number, options: Partial<Revision> = {}): Revision {
  return {
    id: `r${index}`,
    documentId: 'doc-1',
    contentHash: `hash-${index}`,
    recordedAt: at,
    byteLength: 1_000,
    daily: false,
    ...options,
  }
}

describe('applyRetention', () => {
  it('records nothing when the content did not change', () => {
    const existing = [revision(1, 1_000)]
    const outcome = applyRetention(existing, {
      contentHash: 'hash-1',
      recordedAt: 2_000,
      byteLength: 1_000,
    })

    expect(outcome.record).toBe(false)
    expect(outcome.drop).toEqual([])
  })

  it('replaces the newest revision when the change is within five minutes', () => {
    const existing = [revision(1, 1_000)]
    const outcome = applyRetention(existing, {
      contentHash: 'hash-2',
      recordedAt: 1_000 + 4 * MINUTE,
      byteLength: 1_000,
    })

    expect(outcome.record).toBe(true)
    expect(outcome.replacesNewest).toBe(true)
  })

  it('adds a revision once the window has passed', () => {
    const existing = [revision(1, 1_000)]
    const outcome = applyRetention(existing, {
      contentHash: 'hash-2',
      recordedAt: 1_000 + 6 * MINUTE,
      byteLength: 1_000,
    })

    expect(outcome.replacesNewest).toBe(false)
    expect(outcome.drop).toEqual([])
  })

  it('never replaces a daily revision, because it is the only point for its day', () => {
    const existing = [revision(1, 1_000, { daily: true })]
    const outcome = applyRetention(existing, {
      contentHash: 'hash-2',
      recordedAt: 1_000 + MINUTE,
      byteLength: 1_000,
    })

    expect(outcome.replacesNewest).toBe(false)
  })

  it('drops the oldest once fifty are kept', () => {
    const existing = Array.from({ length: 50 }, (_, index) =>
      revision(index, index * 10 * MINUTE),
    )
    const outcome = applyRetention(existing, {
      contentHash: 'new',
      recordedAt: 50 * 10 * MINUTE,
      byteLength: 1_000,
    })

    expect(outcome.drop.map((entry) => entry.id)).toEqual(['r0'])
  })

  it('keeps a daily revision past the fifty most recent', () => {
    const existing = [
      revision(0, 0, { daily: true }),
      ...Array.from({ length: 50 }, (_, index) => revision(index + 1, (index + 1) * MINUTE)),
    ]
    const outcome = applyRetention(existing, {
      contentHash: 'new',
      recordedAt: 100 * MINUTE,
      byteLength: 1_000,
    })

    expect(outcome.drop.map((entry) => entry.id)).not.toContain('r0')
  })

  it('drops a daily revision once it is thirty-one days old', () => {
    const now = 40 * DAY
    const existing = [
      revision(0, now - 31 * DAY, { daily: true }),
      revision(1, now - 1 * DAY, { daily: true }),
    ]
    const outcome = applyRetention(existing, {
      contentHash: 'new',
      recordedAt: now,
      byteLength: 1_000,
    })

    expect(outcome.drop.map((entry) => entry.id)).toContain('r0')
    expect(outcome.drop.map((entry) => entry.id)).not.toContain('r1')
  })

  it('drops non-daily revisions before daily ones under byte pressure', () => {
    const existing = [
      revision(0, 0, { daily: true, byteLength: 3_000_000 }),
      revision(1, 10 * MINUTE, { byteLength: 3_000_000 }),
    ]
    const outcome = applyRetention(
      existing,
      { contentHash: 'new', recordedAt: 20 * MINUTE, byteLength: 1_000_000 },
      { budgetBytes: 5_000_000 },
    )

    expect(outcome.drop.map((entry) => entry.id)).toEqual(['r1'])
  })

  it('fifty coalesced revisions span at least four hours', () => {
    // Acceptance criterion 2, stated as a test rather than as prose.
    let existing: Revision[] = []
    let clock = 0
    for (let index = 0; index < 200; index += 1) {
      clock += MINUTE
      const outcome = applyRetention(existing, {
        contentHash: `h${index}`,
        recordedAt: clock,
        byteLength: 100,
      })
      if (!outcome.record) continue
      const dropped = new Set(outcome.drop.map((entry) => entry.id))
      existing = existing.filter((entry) => !dropped.has(entry.id))
      if (outcome.replacesNewest) existing = existing.slice(0, -1)
      existing.push(revision(index, clock))
    }

    const span = existing[existing.length - 1].recordedAt - existing[0].recordedAt
    expect(span).toBeGreaterThanOrEqual(4 * 60 * MINUTE)
  })
})
```

- [ ] **Step 2: Run and watch them fail**

Run: `./dev unit`
Expected: FAIL, module `./revision` not found.

- [ ] **Step 3: Implement the policy**

```ts
import type { DocumentId } from './document'

const DAY_MS = 86_400_000

export interface Revision {
  id: string
  documentId: DocumentId
  contentHash: string
  recordedAt: number
  byteLength: number
  daily: boolean
}

export interface RecoveryEntry {
  documentId: DocumentId
  contentHash: string
  journaledAt: number
}

export interface RetentionOptions {
  coalesceWithinMs?: number
  keepRecent?: number
  keepDailyForDays?: number
  budgetBytes?: number
}

export interface RetentionOutcome {
  drop: Revision[]
  replacesNewest: boolean
  record: boolean
}

const DEFAULTS = {
  coalesceWithinMs: 5 * 60_000,
  keepRecent: 50,
  keepDailyForDays: 30,
  budgetBytes: 5_000_000,
}

/**
 * Decides what a document's history should contain once a candidate arrives.
 *
 * Pure: it is given the revisions that exist and returns what to keep, so the
 * rule can be tested exhaustively without a database and the two stores only
 * have to persist a decision somebody else made.
 */
export function applyRetention(
  existing: Revision[],
  candidate: { contentHash: string; recordedAt: number; byteLength: number },
  options: RetentionOptions = {},
): RetentionOutcome {
  const settings = { ...DEFAULTS, ...options }
  const ordered = [...existing].sort((a, b) => a.recordedAt - b.recordedAt)
  const newest = ordered[ordered.length - 1]

  if (newest && newest.contentHash === candidate.contentHash) {
    return { drop: [], replacesNewest: false, record: false }
  }

  // A daily revision is the only point kept for its day, so it is never
  // replaced however soon the next change arrives.
  const replacesNewest =
    newest !== undefined &&
    !newest.daily &&
    candidate.recordedAt - newest.recordedAt < settings.coalesceWithinMs

  const surviving = replacesNewest ? ordered.slice(0, -1) : ordered
  const drop: Revision[] = []
  const expiry = candidate.recordedAt - settings.keepDailyForDays * DAY_MS
  const kept: Revision[] = []

  for (const entry of surviving) {
    if (entry.daily && entry.recordedAt <= expiry) {
      drop.push(entry)
    } else {
      kept.push(entry)
    }
  }

  // Rule 3 counts only non-daily revisions; a daily is exempt.
  const recent = kept.filter((entry) => !entry.daily)
  const excess = recent.length + 1 - settings.keepRecent
  for (let index = 0; index < excess; index += 1) {
    drop.push(recent[index])
  }

  let total = kept
    .filter((entry) => !drop.includes(entry))
    .reduce((sum, entry) => sum + entry.byteLength, candidate.byteLength)
  if (total > settings.budgetBytes) {
    // Non-daily first, oldest first, then dailies: losing today's detail costs
    // less than losing the only copy of a past day.
    const byPressure = [
      ...kept.filter((entry) => !entry.daily && !drop.includes(entry)),
      ...kept.filter((entry) => entry.daily && !drop.includes(entry)),
    ]
    for (const entry of byPressure) {
      if (total <= settings.budgetBytes) break
      drop.push(entry)
      total -= entry.byteLength
    }
  }

  return { drop, replacesNewest, record: true }
}
```

- [ ] **Step 4: Export it and run**

Add to `packages/core/src/index.ts`:

```ts
export type {
  RecoveryEntry,
  RetentionOptions,
  RetentionOutcome,
  Revision,
} from './revision'
export { applyRetention } from './revision'
```

Run: `./dev unit`
Expected: PASS, 9 new tests.

- [ ] **Step 5: Prove the tests have teeth**

Delete the `!newest.daily` condition from `replacesNewest`, run `./dev unit`, and
confirm `never replaces a daily revision` fails. Restore it. Then change
`keepDailyForDays` to `3000`, and confirm `drops a daily revision once it is
thirty-one days old` fails. Restore it.

- [ ] **Step 6: Commit**

```bash
git add packages/core
git commit -m "feat: decide history retention without a database"
```

---

## Task 3: Compression on both surfaces

**Files:**
- Create: `packages/platform/src/web/compression.ts`, `packages/platform/src/web/compression.test.ts`
- Create: `apps/desktop/src-tauri/src/compression.rs`
- Modify: `apps/desktop/src-tauri/Cargo.toml`

**Interfaces:**
- Produces: `compress(text: string): Promise<Uint8Array>` and `decompress(bytes: Uint8Array): Promise<string>` on the web; `pub fn compress(text: &str) -> Result<Vec<u8>, DesktopError>` and `pub fn decompress(bytes: &[u8]) -> Result<String, DesktopError>` on the desktop.

- [ ] **Step 1: Write the failing web test**

```ts
import { expect, it } from 'vitest'

import { compress, decompress } from './compression'

it('round-trips text exactly', async () => {
  const text = '# hello\n\nsome *markdown* with a table\n\n| a | b |\n|---|---|\n'
  expect(await decompress(await compress(text))).toBe(text)
})

it('round-trips text that is not ASCII', async () => {
  const text = '# 안녕하세요 — em dash, emoji 🎉, and combining é\n'
  expect(await decompress(await compress(text))).toBe(text)
})

it('round-trips an empty document', async () => {
  expect(await decompress(await compress(''))).toBe('')
})

it('makes repetitive markdown smaller', async () => {
  const text = '# heading\n\nparagraph text\n'.repeat(200)
  const packed = await compress(text)
  expect(packed.byteLength).toBeLessThan(new TextEncoder().encode(text).byteLength / 2)
})
```

- [ ] **Step 2: Run and watch them fail**

Run: `./dev unit`
Expected: FAIL, module `./compression` not found.

- [ ] **Step 3: Implement the web helpers**

`Blob.stream` is not a function under jsdom, so the stream is built by hand. This
is a constraint, not a preference: the customary `new Blob([text]).stream()`
throws.

```ts
/**
 * Gzip helpers that do not go through `Blob`.
 *
 * `Blob.stream` is not a function in the environment the unit tests run in, so
 * the source stream is built from an encoded array instead. The compressed
 * bytes are never read by the desktop, which has its own implementation, so the
 * two need not agree beyond both being gzip.
 */
function streamOf(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes)
      controller.close()
    },
  })
}

export async function compress(text: string): Promise<Uint8Array> {
  const source = streamOf(new TextEncoder().encode(text))
  const packed = source.pipeThrough(new CompressionStream('gzip'))
  return new Uint8Array(await new Response(packed).arrayBuffer())
}

export async function decompress(bytes: Uint8Array): Promise<string> {
  const source = streamOf(bytes)
  return new Response(source.pipeThrough(new DecompressionStream('gzip'))).text()
}
```

- [ ] **Step 4: Run the web tests**

Run: `./dev unit`
Expected: PASS, 4 tests.

- [ ] **Step 5: Add the desktop compressor**

```bash
cd apps/desktop/src-tauri && cargo add flate2
```

Pin the resolved version exactly in `Cargo.toml`.

- [ ] **Step 6: Write the failing Rust test**

Append to `apps/desktop/src-tauri/tests/history.rs` (create the file):

```rust
use stackmark_desktop::compression::{compress, decompress};

#[test]
fn text_round_trips_exactly() {
    let text = "# hello\n\nsome *markdown*\n";
    assert_eq!(decompress(&compress(text).unwrap()).unwrap(), text);
}

#[test]
fn text_that_is_not_ascii_round_trips() {
    let text = "# 안녕하세요 — emoji 🎉 and combining é\n";
    assert_eq!(decompress(&compress(text).unwrap()).unwrap(), text);
}

#[test]
fn an_empty_document_round_trips() {
    assert_eq!(decompress(&compress("").unwrap()).unwrap(), "");
}

#[test]
fn repetitive_markdown_gets_smaller() {
    let text = "# heading\n\nparagraph text\n".repeat(200);
    assert!(compress(&text).unwrap().len() < text.len() / 2);
}

#[test]
fn bytes_that_are_not_gzip_are_refused_rather_than_panicking() {
    assert!(decompress(b"not gzip at all").is_err());
}
```

Run: `cargo test --test history`
Expected: FAIL, `unresolved import stackmark_desktop::compression`.

- [ ] **Step 7: Implement the desktop compressor**

```rust
//! Gzip helpers.
//!
//! The web surface has its own implementation and never reads these bytes, so
//! the two need not agree beyond both being gzip.

use std::io::{Read, Write};

use flate2::read::GzDecoder;
use flate2::write::GzEncoder;
use flate2::Compression;

use crate::error::DesktopError;

pub fn compress(text: &str) -> Result<Vec<u8>, DesktopError> {
    let mut encoder = GzEncoder::new(Vec::new(), Compression::default());
    encoder
        .write_all(text.as_bytes())
        .map_err(|error| DesktopError::unexpected(error.to_string()))?;
    encoder
        .finish()
        .map_err(|error| DesktopError::unexpected(error.to_string()))
}

pub fn decompress(bytes: &[u8]) -> Result<String, DesktopError> {
    let mut decoder = GzDecoder::new(bytes);
    let mut text = String::new();
    decoder
        .read_to_string(&mut text)
        .map_err(|error| DesktopError::unexpected(error.to_string()))?;
    Ok(text)
}
```

Add `pub mod compression;` to `src/lib.rs`.

- [ ] **Step 8: Run**

Run: `cargo test --test history`
Expected: PASS, 5 tests.

- [ ] **Step 9: Prove the tests have teeth**

In the web `decompress`, change `'gzip'` to `'deflate'`, run `./dev unit`, and
confirm the round-trip tests fail. Restore it.

- [ ] **Step 10: Commit**

```bash
git add packages/platform apps/desktop/src-tauri
git commit -m "feat: compress revision content on both surfaces"
```

---

## Task 4: The three contracts

**Files:**
- Modify: `packages/platform/src/contracts.ts`
- Modify: `apps/desktop/src-tauri/src/error.rs`

**Interfaces:**
- Produces:

```ts
export type SettingsScope = 'global' | 'workspace'

export interface SettingsStore {
  get(scope: SettingsScope, key: string): Promise<string | null>
  set(scope: SettingsScope, key: string, value: string): Promise<void>
  remove(scope: SettingsScope, key: string): Promise<void>
}

export interface HistoryStore {
  /** Null when the content did not change, which is not a failure. */
  record(id: DocumentId, content: string): Promise<Revision | null>
  list(id: DocumentId): Promise<Revision[]>
  read(revisionId: string): Promise<string>
}

export interface RecoveryStore {
  journal(id: DocumentId, content: string): Promise<void>
  pending(): Promise<RecoveryEntry[]>
  clear(id: DocumentId): Promise<void>
}
```

`Revision` is imported from `@stackmark/core` rather than redeclared. Two
identical shapes in two packages drift, and the one in the core is the one the
retention policy already returns.

`StoreError` gains two members:

```ts
  | { kind: 'revision-gone'; revisionId: string }
  | { kind: 'store-full' }
```

- [ ] **Step 1: Write the failing test**

Append to `packages/platform/src/web/workspace-host.test.ts`:

```ts
import { isStoreError } from '../contracts'

it('recognises the two categories history adds', () => {
  expect(isStoreError({ kind: 'revision-gone', revisionId: 'r1' })).toBe(true)
  expect(isStoreError({ kind: 'store-full' })).toBe(true)
})
```

- [ ] **Step 2: Run and watch it fail**

Run: `./dev lint`
Expected: FAIL — `revision-gone` is not assignable to `StoreError`.

- [ ] **Step 3: Extend the contract and the Rust error**

Add the two members to `StoreError`, and to `DesktopError` in `src/error.rs`:

```rust
    /// The revision was pruned between being listed and being read. Retention
    /// runs on write, so a list a user is looking at can go stale underneath
    /// them.
    #[error("that revision is no longer kept")]
    RevisionGone { revision_id: String },

    /// The store cannot accept more data.
    #[error("the store is full")]
    StoreFull,
```

Add `record` for `HistoryStore` returning `null` when nothing was recorded,
because a save that changes nothing is not a failure.

- [ ] **Step 4: Run**

Run: `./dev lint && ./dev unit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/platform apps/desktop/src-tauri
git commit -m "feat: define the settings, history and recovery contracts"
```

---

## Task 5: The web stores

**Files:**
- Create: `packages/platform/src/web/settings-store.ts`, `history-store.ts`, `recovery-store.ts` and their tests
- Modify: `packages/platform/src/web/document-store.ts` (schema)

**Interfaces:**
- Consumes: `applyRetention` from Task 2, `compress`/`decompress` from Task 3, the contracts from Task 4.
- Produces: `createWebSettingsStore(database)`, `createWebHistoryStore(database)`, `createWebRecoveryStore(database)`.

- [ ] **Step 1: Extend the schema**

In `openDocumentDatabase`, raise the version to 2 and add three object stores in
`onupgradeneeded`: `settings` keyed by `key`, `revisions` keyed by `id` with a
`documentId` index, and `recovery` keyed by `documentId`.

- [ ] **Step 2: Write the failing tests**

```ts
import 'fake-indexeddb/auto'

import { beforeEach, expect, it } from 'vitest'

import { createWebHistoryStore } from './history-store'
import { openDocumentDatabase } from './document-store'

let history: ReturnType<typeof createWebHistoryStore>
let count = 0

beforeEach(async () => {
  count += 1
  history = createWebHistoryStore(await openDocumentDatabase(`history-test-${count}`))
})

it('records a revision and reads its content back', async () => {
  const recorded = await history.record('doc-1', '# first')
  expect(recorded).not.toBeNull()
  expect(await history.read(recorded!.id)).toBe('# first')
})

it('records nothing when the content did not change', async () => {
  await history.record('doc-1', '# same')
  expect(await history.record('doc-1', '# same')).toBeNull()
  expect(await history.list('doc-1')).toHaveLength(1)
})

it('lists summaries without content', async () => {
  await history.record('doc-1', '# first')
  const [summary] = await history.list('doc-1')
  expect(summary).not.toHaveProperty('content')
})

it('keeps one document out of another document history', async () => {
  await history.record('doc-1', 'a')
  await history.record('doc-2', 'b')
  expect(await history.list('doc-1')).toHaveLength(1)
})

it('reports a pruned revision as gone rather than as missing content', async () => {
  await expect(history.read('never-existed')).rejects.toMatchObject({
    kind: 'revision-gone',
  })
})

it('does not touch the document when a revision is read', async () => {
  // Acceptance criterion 6. Restoring is a decision about the editor's buffer,
  // so reading history must never write: a user comparing an old version to the
  // current one must not lose the current one by looking.
  const documents = createWebDocumentStore(database, 'workspace-1')
  const document = await documents.create('a.md', '# current')
  const recorded = await history.record(document.id, '# older')

  await history.read(recorded!.id)

  expect((await documents.read(document.id)).content).toBe('# current')
})
```

Write matching tests for settings (`get` after `set`, scope isolation, `remove`)
and recovery (`journal` then `pending`, `clear` empties it, journaling twice
keeps only the newest entry per document).

- [ ] **Step 3: Run and watch them fail**

Run: `./dev unit`
Expected: FAIL, modules not found.

- [ ] **Step 4: Implement the three stores**

Each follows `document-store.ts`: one transaction per operation, resolving on
`transaction.oncomplete`, and compression before the transaction opens because a
transaction closes if anything that is not an IndexedDB request is awaited inside
it.

`record` reads the document's existing revisions, calls `applyRetention`, then
deletes and inserts inside one transaction so a failure leaves history as it was.

- [ ] **Step 5: Run**

Run: `./dev unit`
Expected: PASS.

- [ ] **Step 6: Prove the retention wiring has teeth**

Make `record` ignore `outcome.drop`, run the tests, and confirm a test asserting
that history stays bounded fails. Restore it.

- [ ] **Step 7: Commit**

```bash
git add packages/platform
git commit -m "feat: implement settings, history and recovery on IndexedDB"
```

---

## Task 6: The desktop tables

**Files:**
- Modify: `apps/desktop/src-tauri/src/metadata.rs`
- Modify: `apps/desktop/src-tauri/tests/history.rs`

**Interfaces:**
- Produces on `Metadata`: `record_revision(document_id, content_hash, bytes, recorded_at, daily) -> Result<String, DesktopError>`, `list_revisions(document_id) -> Result<Vec<RevisionRow>, DesktopError>`, `read_revision(revision_id) -> Result<Vec<u8>, DesktopError>`, `drop_revisions(ids: &[String])`, `journal(document_id, bytes, at)`, `pending_recovery() -> Result<Vec<RecoveryRow>, DesktopError>`, `clear_recovery(document_id)`, `workspace_setting(key)`, `set_workspace_setting(key, value)`.

- [ ] **Step 1: Raise the schema version and add the tables**

`SCHEMA_VERSION` becomes 2, and `migrate` applies the new statements only when
the stored version is below 2, leaving a version 1 database intact:

```sql
CREATE TABLE IF NOT EXISTS revisions (
  id            TEXT PRIMARY KEY,
  document_id   TEXT NOT NULL,
  content_hash  TEXT NOT NULL,
  content       BLOB NOT NULL,
  byte_length   INTEGER NOT NULL,
  recorded_ms   INTEGER NOT NULL,
  daily         INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS revisions_by_document ON revisions (document_id, recorded_ms);

CREATE TABLE IF NOT EXISTS recovery (
  document_id  TEXT PRIMARY KEY,
  content      BLOB NOT NULL,
  journaled_ms INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS workspace_settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
```

- [ ] **Step 2: Write the failing tests**

```rust
#[test]
fn a_version_one_database_upgrades_without_losing_documents() {
    let file = tempfile::NamedTempFile::new().unwrap();
    {
        let store = Metadata::open(file.path()).unwrap();
        store.insert("a.md").unwrap();
    }
    let store = Metadata::open(file.path()).unwrap();
    assert_eq!(store.user_version().unwrap(), 2);
    assert_eq!(store.list().unwrap().len(), 1, "the document survived the migration");
}

#[test]
fn a_revision_reads_back_the_bytes_it_stored() {
    let store = Metadata::open_in_memory().unwrap();
    let id = store.record_revision("doc-1", "hash-1", b"packed", 1_000, false).unwrap();
    assert_eq!(store.read_revision(&id).unwrap(), b"packed");
}

#[test]
fn reading_a_dropped_revision_reports_it_gone() {
    let store = Metadata::open_in_memory().unwrap();
    let id = store.record_revision("doc-1", "hash-1", b"packed", 1_000, false).unwrap();
    store.drop_revisions(&[id.clone()]).unwrap();
    assert!(matches!(store.read_revision(&id), Err(DesktopError::RevisionGone { .. })));
}

#[test]
fn journaling_twice_keeps_only_the_newest_entry() {
    let store = Metadata::open_in_memory().unwrap();
    store.journal("doc-1", b"first", 1_000).unwrap();
    store.journal("doc-1", b"second", 2_000).unwrap();

    let pending = store.pending_recovery().unwrap();
    assert_eq!(pending.len(), 1);
    assert_eq!(pending[0].content, b"second");
}

#[test]
fn clearing_recovery_removes_only_that_document() {
    let store = Metadata::open_in_memory().unwrap();
    store.journal("doc-1", b"a", 1_000).unwrap();
    store.journal("doc-2", b"b", 1_000).unwrap();
    store.clear_recovery("doc-1").unwrap();

    assert_eq!(store.pending_recovery().unwrap().len(), 1);
}
```

- [ ] **Step 3: Run, implement, run**

Run: `cargo test --test history` — FAIL, then implement, then PASS.

- [ ] **Step 4: Prove a workspace's history dies with its database**

Acceptance criterion 8. This is why the split into two databases exists, so it is
worth a test rather than an argument.

```rust
#[test]
fn deleting_a_workspace_database_discards_its_history_and_leaves_global_settings() {
    let directory = tempfile::tempdir().unwrap();
    let workspace_db = directory.path().join("workspace.sqlite3");
    let global_db = directory.path().join("global.sqlite3");

    let global = crate_app_data(&global_db);
    global.set("theme", "dark").unwrap();
    {
        let workspace = Metadata::open(&workspace_db).unwrap();
        workspace.record_revision("doc-1", "hash-1", b"packed", 1_000, false).unwrap();
        workspace.journal("doc-1", b"unsaved", 1_000).unwrap();
    }

    // One file, removed. No cascade to get wrong.
    std::fs::remove_file(&workspace_db).unwrap();

    let workspace = Metadata::open(&workspace_db).unwrap();
    assert!(workspace.list_revisions("doc-1").unwrap().is_empty());
    assert!(workspace.pending_recovery().unwrap().is_empty());
    assert_eq!(global.get("theme").unwrap(), Some("dark".to_string()));
}

fn crate_app_data(path: &std::path::Path) -> stackmark_desktop::app_data::AppData {
    stackmark_desktop::app_data::AppData::open(path).unwrap()
}
```

Run: `cargo test --test history`
Expected: PASS.

- [ ] **Step 5: Prove the migration test has teeth**

Change `SCHEMA_VERSION` back to 1 and confirm
`a_version_one_database_upgrades_without_losing_documents` fails on the version
assertion. Restore it. Then make `migrate` drop and recreate the `documents`
table, and confirm the same test fails on the document count — that is the
mistake the test exists to catch.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src-tauri
git commit -m "feat: store revisions, recovery entries and workspace settings"
```

---

## Task 7: The desktop commands and adapters

**Files:**
- Modify: `apps/desktop/src-tauri/src/commands.rs`, `lib.rs`, `permissions/workspace.toml`, `capabilities/main.json`
- Create: `packages/platform/src/tauri/settings-store.ts`, `history-store.ts`, `recovery-store.ts` and their tests
- Modify: `packages/platform/src/tauri/bindings.ts` (regenerated), `packages/platform/src/index.ts`

**Interfaces:**
- Produces commands `get_setting`, `set_setting`, `remove_setting`, `record_revision`, `list_revisions`, `read_revision`, `journal_document`, `pending_recovery`, `clear_recovery`, each returning `Result<_, DesktopError>`.

- [ ] **Step 1: Add the commands**

Each resolves through `with_metadata` or the global store depending on scope.

**Who decides what to drop, and what that costs.** The retention rule is a pure
TypeScript function, so the adapter calls it and then tells Rust which revisions
to store and which to delete. The alternative — Rust deciding — would mean the
rule implemented twice, in two languages, free to disagree, which is exactly what
decision 1 avoids.

The consequence is that the web layer can ask Rust to delete any revision. That
is worth stating rather than discovering: it is a data-loss capability handed to
the untrusted side. It is accepted here because the same side can already delete
whole documents through `remove_document`, so it is not a new class of power, and
because it is a separate enumerable permission that can be withheld. If Stage 2
gives history a stronger guarantee than the document store has, this is the
decision to revisit — and `drop_revisions` is the command to move behind a
Rust-side rule.

- [ ] **Step 2: Add exactly the new permissions**

Nine entries in `permissions/workspace.toml`, one per command, each naming its
command in `commands.allow`. Add the same nine identifiers to
`capabilities/main.json`. Add nothing else.

- [ ] **Step 3: Regenerate and check the surface test still passes**

Run: `cargo test`
Expected: PASS, including `command_surface`, which requires every command to
return `DesktopError` and only creating and renaming to take a path.

- [ ] **Step 4: Write the adapter tests**

Against a fake command surface, as in Stage 1A: that a `revision-gone` error
carries the revision identifier, that a refused command produces a readable
message rather than `undefined`, and that native field names are renamed onto the
shared model.

- [ ] **Step 5: Run**

Run: `./dev unit && ./dev lint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src-tauri packages/platform
git commit -m "feat: reach settings, history and recovery from the desktop"
```

---

## Task 8: Crash survival

The one guarantee recovery exists to provide. A clean shutdown demonstrates
nothing about it, so the test kills the process.

**Files:**
- Create: `apps/desktop/src-tauri/tests/crash_recovery.rs`

- [ ] **Step 1: Write the failing test**

```rust
//! Journal entries must survive the process dying.
//!
//! The database is closed by killing the process rather than by dropping the
//! connection, because an orderly shutdown proves only that the code runs when
//! it is allowed to finish -- which is the case recovery does not care about.

use std::process::Command;

use stackmark_desktop::metadata::Metadata;

#[test]
fn journal_entries_survive_the_process_being_killed() {
    let directory = tempfile::tempdir().unwrap();
    let database = directory.path().join("workspace.sqlite3");

    // A child process writes and is killed before it can exit.
    let status = Command::new(std::env::current_exe().unwrap())
        .args(["--exact", "helper_writes_then_dies", "--ignored", "--nocapture"])
        .env("STACKMARK_CRASH_DB", &database)
        .status()
        .expect("running the helper");
    assert!(!status.success(), "the helper was supposed to be killed");

    let store = Metadata::open(&database).unwrap();
    let pending = store.pending_recovery().unwrap();
    assert_eq!(pending.len(), 1, "the journal entry did not survive");
    assert_eq!(pending[0].content, b"unsaved work");
}

#[test]
#[ignore = "helper: writes a journal entry and then kills its own process"]
fn helper_writes_then_dies() {
    let path = std::env::var("STACKMARK_CRASH_DB").expect("database path");
    let store = Metadata::open(std::path::Path::new(&path)).unwrap();
    store.journal("doc-1", b"unsaved work", 1_000).unwrap();

    // SIGKILL: no unwinding, no destructors, no flush that the code controls.
    unsafe { libc::kill(std::process::id() as i32, libc::SIGKILL) };
    unreachable!("the process should be gone");
}
```

- [ ] **Step 2: Add the dependency**

```bash
cd apps/desktop/src-tauri && cargo add --dev libc
```

Pin the resolved version exactly.

- [ ] **Step 3: Run and watch it fail, then pass**

Run: `cargo test --test crash_recovery`
Expected first: FAIL, because `journal` does not commit durably enough or the
helper wiring is wrong. Then PASS once `journal` commits its own transaction.

- [ ] **Step 4: Prove the test has teeth**

Wrap `journal` in a transaction that is begun and never committed, run the test,
and confirm it fails with zero pending entries. Restore it.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src-tauri
git commit -m "test: prove journal entries survive the process being killed"
```

---

## Task 9: Reach the new commands through the interface

**Files:**
- Modify: `apps/web/src/App.vue`, `apps/desktop/src-tauri/tests/roundtrip.rs`

- [ ] **Step 1: Add harness controls**

Beside the existing document controls, add buttons with `data-testid` values
`record-revision`, `list-revisions`, `read-revision`, `journal-document`,
`pending-recovery`, `clear-recovery`, `set-setting` and `get-setting`, and a
status line `data-testid="repository-status"`.

This is harness surface in a screen Stage 2 deletes. Unlike a query parameter it
is reachable only by interacting with a visible control.

- [ ] **Step 2: Extend the round trip**

One session covering every new command, following
`every_command_crosses_the_channel`. Assert on the status line rather than on
elapsed time.

- [ ] **Step 3: Build and run**

```bash
./dev desktop-build
xvfb-run -a cargo test --test roundtrip -- --ignored --test-threads=1
```

Expected: PASS.

- [ ] **Step 4: Prove the capability check still bites, on a new command**

Remove `allow-record-revision` from `capabilities/main.json`, rebuild, and
confirm the round trip fails. Restore it and confirm it passes again.

This is not a formality. In Stage 1A the same check passed with a permission
removed, because the command it guarded had no coverage; the check found a hole
in the tests rather than in the code.

- [ ] **Step 5: Commit**

```bash
git add apps/web apps/desktop/src-tauri
git commit -m "test: drive settings, history and recovery through real IPC"
```

---

## Task 10: Close the stage

- [ ] **Step 1: Run every gate**

```bash
./dev unit && ./dev lint && ./dev e2e
cd apps/desktop/src-tauri && cargo fmt --check && cargo test
./dev desktop-build && scripts/inspect-deb.sh apps/desktop/src-tauri/target/release/bundle/deb/*.deb
```

- [ ] **Step 2: Confirm the package gained no runtime dependency**

```bash
dpkg-deb --field apps/desktop/src-tauri/target/release/bundle/deb/*.deb Depends
objdump -p apps/desktop/src-tauri/target/release/stackmark | grep NEEDED
```

Expected: `libwebkit2gtk-4.1-0, libgtk-3-0` unchanged, and no new direct entry.
`flate2` compiles in; if a `libz` entry appears, that is a real change and must be
recorded rather than explained away.

- [ ] **Step 3: Exercise the host gates against the installed package**

Install, then repeat the folder, save, external-change and print checks. This
stage does not change those paths, but it changes what happens around them, and a
gate is not passed until it is exercised in a packaged build.

- [ ] **Step 4: Record the evidence**

Write `docs/engineering/evidence/stage-1b.md`: exact commands, counts, the
capability-removal failure, the crash-survival result, and anything that did not
work.

- [ ] **Step 5: Write the decision record**

`docs/decisions/0004-stage-one-b-repositories.md`, recording whether the retention
policy held as a pure function, the crash-survival result, and any deviation.

- [ ] **Step 6: Commit**

```bash
git add docs apps packages
git commit -m "docs: record the Stage 1B evidence and decision"
```
