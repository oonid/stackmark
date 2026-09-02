# Stage 1A Implementation Plan — contracts and document persistence

> **How to work this plan:** implement it task by task, in order, and complete a task's prescribed checks before starting the next. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish the shared document model, the two platform contracts, a web and a desktop implementation of each, and a JavaScript-to-Rust boundary that is tested twice — by generated types and by a round trip against the built binary.

**Architecture:** Components call services; services call contracts; only adapters know about IndexedDB, the filesystem or Tauri. Rust owns the SQLite schema and every query, and TypeScript addresses documents by opaque identifier, never by path. Command and event types are generated from the Rust definitions and committed, so drift is a build failure.

**Tech Stack:** TypeScript 6.0.2, Vue 3.5.40, Vitest 4.1.10, Playwright 1.54.2, Rust 1.88.0, Tauri 2.11.5, rusqlite, specta and tauri-specta, tauri-driver, Docker Compose.

**Design:** `docs/engineering/specs/2026-09-02-stage-one-contracts-and-documents-design.md`

## Global Constraints

- Run every Node, pnpm, Vite, formatter, lint, unit-test and browser-test command through `./dev`. Do not install or invoke host Node.js or pnpm. Rust is host-native.
- Pin every dependency exactly. Rust uses `=<version>` in `Cargo.toml`; JavaScript uses a bare version with no range prefix. Copy the resolved version out of the lockfile after adding.
- TypeScript sends no filesystem path to Rust in any command. Documents are addressed by identifier.
- Do not widen `apps/desktop/src-tauri/capabilities/main.json` beyond the commands this plan adds. A new permission needs a decision record.
- Every new test must fail when its implementation is deliberately broken. Prove it by breaking the code, running the test, and restoring — not by reading the test.
- Commit messages carry no co-authorship trailer, no tooling or model names, and no absolute paths from a contributor's machine.
- A gate is not passed until it is exercised against a packaged build. `cargo tauri build` produces a binary that runs without installation.

---

## File Structure

**Created:**

| Path | Responsibility |
|---|---|
| `packages/core/src/document.ts` | The `Document` model and its identifier type |
| `packages/core/src/path.ts` | Workspace-relative POSIX path normalization and validation |
| `packages/platform/src/contracts.ts` | `WorkspaceHost` and `DocumentStore` interfaces and error types |
| `packages/platform/src/web/document-store.ts` | IndexedDB implementation of `DocumentStore` |
| `packages/platform/src/web/workspace-host.ts` | Web `WorkspaceHost` reporting `unsupported` |
| `packages/platform/src/tauri/bindings.ts` | Generated. Never edited by hand |
| `packages/platform/src/tauri/document-store.ts` | Desktop `DocumentStore` over the generated bindings |
| `packages/platform/src/tauri/workspace-host.ts` | Desktop `WorkspaceHost` over the generated bindings |
| `apps/desktop/src-tauri/src/metadata.rs` | SQLite: schema, migrations, identifier-to-path mapping |
| `apps/desktop/src-tauri/src/error.rs` | The tagged error returned by every command |
| `apps/desktop/src-tauri/src/commands.rs` | Command definitions, annotated for generation |
| `apps/web/e2e-desktop/roundtrip.spec.ts` | WebDriver round trip against the built binary |

**Modified:**

| Path | Change |
|---|---|
| `apps/desktop/src-tauri/src/lib.rs` | Move commands out; register the generated handler; accept a startup path argument |
| `apps/desktop/src-tauri/src/workspace.rs` | Return tagged errors; remove the poisonable lock |
| `apps/desktop/src-tauri/capabilities/main.json` | Permissions for the new commands only |
| `apps/web/src/App.vue` | Use the contracts; remove `?printFallback=1` |
| `apps/web/src/platform/desktop-proof.ts` | Deleted, replaced by `packages/platform` |
| `.github/workflows/ci.yml` | Bindings drift check; round-trip job |

---

## Task 1: Generated command bindings

Proves the first of the two boundary mechanisms before anything depends on it. If
`tauri-specta` cannot work with Tauri 2.11.5, that is a design revision, and it is
far cheaper to learn now than after seven tasks are built on it.

**Files:**
- Modify: `apps/desktop/src-tauri/Cargo.toml`
- Create: `apps/desktop/src-tauri/src/commands.rs`
- Modify: `apps/desktop/src-tauri/src/lib.rs`
- Create: `packages/platform/package.json`
- Create: `packages/platform/src/tauri/bindings.ts` (generated)
- Create: `apps/desktop/src-tauri/tests/bindings.rs`

**Interfaces:**
- Produces: a committed `bindings.ts` exporting one typed function per command, and `events` for `workspace://external-change`. Later tasks import from `@stackmark/platform/tauri/bindings`.

- [ ] **Step 1: Add the generation dependencies**

```bash
cd apps/desktop/src-tauri
cargo add specta --features derive
cargo add specta-typescript
cargo add tauri-specta --features derive,typescript
```

- [ ] **Step 2: Pin them exactly**

Read the resolved versions and rewrite the three lines in `Cargo.toml` with an
`=` prefix, matching the existing style:

```bash
grep -A1 -E '^name = "(specta|specta-typescript|tauri-specta)"$' Cargo.lock
```

Then edit `Cargo.toml` so each reads e.g. `specta = { version = "=<resolved>", features = ["derive"] }`.

Run: `cargo build 2>&1 | tail -3`
Expected: `Finished`. If the crate refuses Tauri 2.11.5, stop and report — do not
downgrade Tauri, which is pinned for the packaging gate.

- [ ] **Step 3: Move the existing commands into `commands.rs` and annotate them**

Create `apps/desktop/src-tauri/src/commands.rs` holding the four commands that are
in `lib.rs` today, each gaining `#[specta::specta]` beneath its
`#[tauri::command]`. Signatures are unchanged in this task; the tagged error
arrives in Task 6.

```rust
use tauri::{AppHandle, State};

use crate::DesktopState;

#[tauri::command]
#[specta::specta]
pub async fn choose_workspace(
    app: AppHandle,
    state: State<'_, DesktopState>,
) -> Result<Option<String>, String> {
    crate::choose_workspace_impl(app, state).await
}
```

Repeat for `read_markdown`, `atomic_write_markdown` and `start_workspace_watch`,
each delegating to the implementation already in `lib.rs`.

- [ ] **Step 4: Emit the bindings from a test**

Generation runs as a test so it cannot be forgotten, and so continuous integration
fails on drift rather than silently regenerating.

Create `apps/desktop/src-tauri/tests/bindings.rs`:

```rust
use specta_typescript::Typescript;
use tauri_specta::{collect_commands, collect_events, Builder};

#[test]
fn bindings_match_the_committed_file() {
    let builder = Builder::<tauri::Wry>::new()
        .commands(collect_commands![
            stackmark_desktop::commands::choose_workspace,
            stackmark_desktop::commands::read_markdown,
            stackmark_desktop::commands::atomic_write_markdown,
            stackmark_desktop::commands::start_workspace_watch,
        ])
        .events(collect_events![]);

    builder
        .export(
            Typescript::default(),
            "../../../packages/platform/src/tauri/bindings.ts",
        )
        .expect("bindings export failed");
}
```

- [ ] **Step 5: Create the platform package**

```json
{
  "name": "@stackmark/platform",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/contracts.ts",
    "./tauri/bindings": "./src/tauri/bindings.ts"
  },
  "scripts": {
    "unit": "vitest run --environment jsdom"
  },
  "devDependencies": {
    "vitest": "4.1.10"
  }
}
```

Run: `./dev install`
Expected: `@stackmark/platform` appears in the workspace listing.

- [ ] **Step 6: Generate and check the result compiles**

Run: `cd apps/desktop/src-tauri && cargo test bindings_match`
Expected: PASS, and `packages/platform/src/tauri/bindings.ts` now exists.

Run: `./dev lint`
Expected: PASS. The generated file must type-check unmodified.

- [ ] **Step 7: Prove drift is caught**

Rename `read_markdown` to `read_markdown_x` in `commands.rs`, regenerate, and
confirm the committed file now differs:

```bash
cargo test bindings_match && git diff --stat ../../../packages/platform/src/tauri/bindings.ts
```

Expected: a non-empty diff. Restore the name and regenerate.

- [ ] **Step 8: Wire the drift check into continuous integration**

In `.github/workflows/ci.yml`, in the `rust` job after `cargo test`:

```yaml
      - name: Fail if the generated bindings are stale
        run: git diff --exit-code packages/platform/src/tauri/bindings.ts
```

- [ ] **Step 9: Commit**

```bash
git add apps/desktop/src-tauri packages/platform .github/workflows/ci.yml pnpm-lock.yaml
git commit -m "feat: generate the command bindings from the Rust definitions"
```

---

## Task 2: Round trip against the built binary

The second mechanism, and the only one that sees the capability list. It needs a
way to adopt a workspace without a human in the folder picker.

**A decision the design did not anticipate.** The picker cannot be driven by
WebDriver, so the application accepts an optional startup path argument:
`stackmark [PATH]` adopts `PATH` as the workspace. This is a real feature — opening
a folder from the shell is ordinary for a desktop editor — and it preserves the
security property that matters: the path comes from whoever launched the process,
never from the page. Record it in the design when this task lands.

**Files:**
- Modify: `apps/desktop/src-tauri/src/lib.rs`
- Create: `apps/desktop/src-tauri/tests/startup_path.rs`
- Create: `apps/web/e2e-desktop/roundtrip.spec.ts`
- Create: `apps/web/e2e-desktop/playwright.config.ts`
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: `bindings.ts` from Task 1.
- Produces: a `roundtrip` script that later tasks extend with one case per command.

- [ ] **Step 1: Write the failing Rust test for the startup argument**

```rust
#[test]
fn startup_path_is_rejected_when_it_is_not_a_directory() {
    let file = tempfile::NamedTempFile::new().unwrap();
    let result = stackmark_desktop::adopt_startup_path(file.path());
    assert!(result.is_err(), "a file must not be adopted as a workspace root");
}
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cargo test startup_path`
Expected: FAIL, `cannot find function adopt_startup_path`.

- [ ] **Step 3: Implement it**

In `lib.rs`, add a function that canonicalizes the argument, requires a directory,
and hands it to the same code path `choose_workspace` uses, so confinement is
established identically:

```rust
pub fn adopt_startup_path(path: &std::path::Path) -> Result<std::path::PathBuf, String> {
    let canonical = path.canonicalize().map_err(|e| e.to_string())?;
    if !canonical.is_dir() {
        return Err("workspace root is not a directory".into());
    }
    Ok(canonical)
}
```

Call it from `setup` when `std::env::args_os().nth(1)` is present.

- [ ] **Step 4: Run the test**

Run: `cargo test startup_path`
Expected: PASS.

- [ ] **Step 5: Install the driver on the host**

```bash
sudo apt-get install -y webkit2gtk-driver xvfb
cargo install tauri-driver --locked
```

Run: `tauri-driver --help | head -2`
Expected: usage output. If the driver cannot start against WebKitGTK 2.52.3, stop
and report — this is the risk the design names, and the alternative is a design
revision rather than a workaround.

- [ ] **Step 6: Build the binary the test will drive**

Run: `./dev desktop-build`
Expected: a binary at `apps/desktop/src-tauri/target/release/stackmark`.

- [ ] **Step 7: Write the round-trip test**

`apps/web/e2e-desktop/roundtrip.spec.ts` starts the binary with a temporary
workspace, connects over WebDriver, and invokes a command through the real
inter-process channel:

The test drives the proof screen rather than calling `invoke` from page context.
`withGlobalTauri` is `false`, so `window.__TAURI__` does not exist, and the
bundled frontend cannot resolve a dynamic import of a workspace package. Enabling
the global would expose the whole invoke surface to any script in the page, which
is the boundary ADR 0001 asks us not to widen. Driving the interface exercises the
same commands through the same contracts a user's click does, and it is why
decision 4 keeps the proof screen alive for this stage.

```ts
import { test, expect } from '@playwright/test'
import { mkdtemp, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('writes a document through the real command channel', async ({ page }) => {
  const root = process.env.STACKMARK_ROUNDTRIP_ROOT!
  await writeFile(join(root, 'note.md'), '# before\n')

  await page.getByTestId('markdown-source').fill('# after\n')
  await page.getByTestId('desktop-proof-action').click()
  await expect(page.getByTestId('desktop-save-metadata')).toBeVisible()

  expect(await readFile(join(root, 'stage-zero-proof.md'), 'utf8')).toBe('# after\n')
})
```

The configuration creates the temporary root with `mkdtemp`, exports it as
`STACKMARK_ROUNDTRIP_ROOT`, launches `tauri-driver` with the binary and that root
as its startup argument, and points Playwright at the resulting session.

- [ ] **Step 8: Run it**

Run: `xvfb-run -a pnpm --filter @stackmark/web exec playwright test --config e2e-desktop/playwright.config.ts`
Expected: PASS.

- [ ] **Step 9: Prove it has teeth against the capability list**

Remove `"allow-atomic-write-markdown"` from
`apps/desktop/src-tauri/capabilities/main.json`, rebuild, and rerun.

Expected: FAIL, with a permission error rather than a passing test. This is
acceptance criterion 6 and the whole reason this mechanism exists. Restore the
permission, rebuild, and confirm it passes again.

- [ ] **Step 10: Add the job to continuous integration**

```yaml
  roundtrip:
    name: Desktop round trip
    runs-on: ubuntu-24.04
    steps:
      - uses: actions/checkout@v4
      - name: Install the driver and system dependencies
        run: |
          sudo apt-get update
          sudo apt-get install --no-install-recommends -y \
            webkit2gtk-driver xvfb \
            libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev libxdo-dev \
            libayatana-appindicator3-dev libssl-dev pkg-config build-essential
      - run: cargo install tauri-driver --locked
      - run: ./dev install
      - run: ./dev desktop-build
      - run: xvfb-run -a pnpm --filter @stackmark/web exec playwright test --config e2e-desktop/playwright.config.ts
```

- [ ] **Step 11: Commit**

```bash
git add apps/desktop/src-tauri apps/web/e2e-desktop .github/workflows/ci.yml
git commit -m "test: drive every command through real IPC on the built binary"
```

---

## Task 3: The core document model

**Files:**
- Create: `packages/core/package.json`, `packages/core/src/document.ts`, `packages/core/src/path.ts`
- Test: `packages/core/src/path.test.ts`

**Interfaces:**
- Produces: `interface Document { id: DocumentId; workspaceId: string; path: string; content: string; contentHash: string; modifiedAt: number }`, `type DocumentId = string`, and `normalizeWorkspacePath(input: string): string` which throws `InvalidPathError` on traversal, absolute paths or empty segments.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from 'vitest'
import { normalizeWorkspacePath, InvalidPathError } from './path'

describe('normalizeWorkspacePath', () => {
  it('collapses redundant separators and current-directory segments', () => {
    expect(normalizeWorkspacePath('notes//./daily.md')).toBe('notes/daily.md')
  })

  it('rejects a path that escapes the workspace', () => {
    expect(() => normalizeWorkspacePath('../secrets.md')).toThrow(InvalidPathError)
  })

  it('rejects an absolute path', () => {
    expect(() => normalizeWorkspacePath('/etc/passwd')).toThrow(InvalidPathError)
  })

  it('rejects a backslash, which Windows would treat as a separator', () => {
    expect(() => normalizeWorkspacePath('notes\\daily.md')).toThrow(InvalidPathError)
  })

  it('rejects an empty path', () => {
    expect(() => normalizeWorkspacePath('')).toThrow(InvalidPathError)
  })
})
```

- [ ] **Step 2: Run and watch them fail**

Run: `./dev unit`
Expected: FAIL, module `./path` not found.

- [ ] **Step 3: Implement**

```ts
export class InvalidPathError extends Error {}

export function normalizeWorkspacePath(input: string): string {
  if (input.length === 0) throw new InvalidPathError('empty path')
  if (input.startsWith('/')) throw new InvalidPathError('absolute path')
  if (input.includes('\\')) throw new InvalidPathError('backslash in path')

  const segments: string[] = []
  for (const segment of input.split('/')) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') throw new InvalidPathError('path escapes the workspace')
    segments.push(segment)
  }
  if (segments.length === 0) throw new InvalidPathError('empty path')
  return segments.join('/')
}
```

- [ ] **Step 4: Run**

Run: `./dev unit`
Expected: PASS.

- [ ] **Step 5: Prove the tests have teeth**

Delete the `..` check, run `./dev unit`, and confirm the traversal test fails.
Restore it.

- [ ] **Step 6: Commit**

```bash
git add packages/core pnpm-lock.yaml
git commit -m "feat: add the shared document model and path normalization"
```

---

## Task 4: The platform contracts

**Files:**
- Create: `packages/platform/src/contracts.ts`
- Create: `packages/platform/src/web/workspace-host.ts`
- Test: `packages/platform/src/web/workspace-host.test.ts`

**Interfaces:**
- Produces:

```ts
export type StoreError =
  | { kind: 'outside-workspace' }
  | { kind: 'not-found'; id: DocumentId }
  | { kind: 'changed-underneath'; id: DocumentId }
  | { kind: 'unexpected'; message: string }

export interface DocumentStore {
  list(): Promise<DocumentSummary[]>
  read(id: DocumentId): Promise<Document>
  write(id: DocumentId, content: string): Promise<DocumentMetadata>
  create(path: string, content: string): Promise<Document>
  rename(id: DocumentId, path: string): Promise<Document>
  remove(id: DocumentId): Promise<void>
}

export interface WorkspaceHost {
  readonly supported: boolean
  adopt(): Promise<string | null>
  watch(listener: (change: ExternalChange) => void): Promise<() => void>
}
```

- [ ] **Step 1: Write the failing test for the web host**

```ts
import { expect, it } from 'vitest'
import { createWebWorkspaceHost } from './workspace-host'

it('reports that adopting a folder is unsupported on the web', async () => {
  const host = createWebWorkspaceHost()
  expect(host.supported).toBe(false)
  await expect(host.adopt()).rejects.toThrow(/unsupported/i)
})
```

- [ ] **Step 2: Run and watch it fail**

Run: `./dev unit`
Expected: FAIL.

- [ ] **Step 3: Write `contracts.ts` and the web host**

The web host returns `supported: false` and rejects `adopt` and `watch`. It is the
same shape Stage 0's gateway used, which the handover asks Stage 1 to keep.

- [ ] **Step 4: Run**

Run: `./dev unit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/platform
git commit -m "feat: define the workspace and document contracts"
```

---

## Task 5: The web document store

**Files:**
- Create: `packages/platform/src/web/document-store.ts`
- Test: `packages/platform/src/web/document-store.test.ts`
- Modify: `packages/platform/package.json` (add `fake-indexeddb`)

**Interfaces:**
- Consumes: `DocumentStore`, `StoreError` from Task 4; `normalizeWorkspacePath` from Task 3.
- Produces: `createWebDocumentStore(database: IDBDatabase): DocumentStore`.

- [ ] **Step 1: Add the test dependency**

```bash
./dev shell -c 'pnpm --filter @stackmark/platform add -D fake-indexeddb'
```

Pin the resolved version exactly in `package.json`.

- [ ] **Step 2: Write the failing tests**

```ts
import 'fake-indexeddb/auto'
import { beforeEach, expect, it } from 'vitest'
import { createWebDocumentStore, openDatabase } from './document-store'

let store: Awaited<ReturnType<typeof createStore>>

async function createStore() {
  return createWebDocumentStore(await openDatabase('stackmark-test'))
}

beforeEach(async () => { store = await createStore() })

it('round-trips a document', async () => {
  const created = await store.create('notes/daily.md', '# hello\n')
  const read = await store.read(created.id)
  expect(read.content).toBe('# hello\n')
  expect(read.path).toBe('notes/daily.md')
})

it('keeps the identifier across a rename', async () => {
  const created = await store.create('a.md', 'x')
  const renamed = await store.rename(created.id, 'b.md')
  expect(renamed.id).toBe(created.id)
  expect(renamed.path).toBe('b.md')
})

it('reports not-found rather than throwing an opaque error', async () => {
  await expect(store.read('missing')).rejects.toMatchObject({ kind: 'not-found' })
})

it('leaves the previous version intact when a write fails mid-transaction', async () => {
  const created = await store.create('a.md', 'first')
  await expect(store.write(created.id, null as unknown as string)).rejects.toBeDefined()
  expect((await store.read(created.id)).content).toBe('first')
})
```

- [ ] **Step 3: Run and watch them fail**

Run: `./dev unit`
Expected: FAIL.

- [ ] **Step 4: Implement the store**

One object store keyed by identifier, with a `path` index. Every mutation runs in a
single `readwrite` transaction so a failure leaves the previous committed document
intact, as section 9 of the design requires. Paths pass through
`normalizeWorkspacePath` before storage.

- [ ] **Step 5: Run**

Run: `./dev unit`
Expected: PASS, four tests.

- [ ] **Step 6: Prove the transaction test has teeth**

Change the write to commit in two transactions, run the tests, and confirm the
last test fails. Restore.

- [ ] **Step 7: Commit**

```bash
git add packages/platform pnpm-lock.yaml
git commit -m "feat: implement the web document store on IndexedDB"
```

---

## Task 6: The SQLite metadata store

Closes carried finding 4 in passing: the state this task rewrites is the state
whose poisoned lock would have made every later workspace operation fatal.

**Files:**
- Create: `apps/desktop/src-tauri/src/metadata.rs`
- Create: `apps/desktop/src-tauri/src/error.rs`
- Modify: `apps/desktop/src-tauri/src/workspace.rs`, `Cargo.toml`

**Interfaces:**
- Produces: `Metadata::open(path) -> Result<Metadata, DesktopError>`, `Metadata::resolve(id) -> Result<String, DesktopError>`, `Metadata::insert(path) -> Result<String, DesktopError>`, `Metadata::rename(id, path)`, `Metadata::remove(id)`, `Metadata::list()`, and `enum DesktopError { OutsideWorkspace, NotFound, ChangedUnderneath, Unexpected(String) }` deriving `Serialize` and `specta::Type`.

- [ ] **Step 1: Add rusqlite**

```bash
cd apps/desktop/src-tauri && cargo add rusqlite --features bundled
```

Pin exactly from `Cargo.lock`. The `bundled` feature compiles SQLite into the
binary so the package does not gain a runtime dependency — check this holds when
Task 10 reruns `inspect-deb.sh`.

- [ ] **Step 2: Write the failing tests**

```rust
#[test]
fn an_identifier_survives_a_rename() {
    let db = Metadata::open_in_memory().unwrap();
    let id = db.insert("a.md").unwrap();
    db.rename(&id, "b.md").unwrap();
    assert_eq!(db.resolve(&id).unwrap(), "b.md");
}

#[test]
fn resolving_an_unknown_identifier_reports_not_found() {
    let db = Metadata::open_in_memory().unwrap();
    assert!(matches!(db.resolve("nope"), Err(DesktopError::NotFound)));
}

#[test]
fn migrations_are_idempotent() {
    let db = Metadata::open_in_memory().unwrap();
    db.migrate().unwrap();
    db.migrate().unwrap();
    assert_eq!(db.user_version().unwrap(), 1);
}

#[test]
fn a_path_that_escapes_the_workspace_is_refused_before_it_is_stored() {
    let db = Metadata::open_in_memory().unwrap();
    assert!(matches!(db.insert("../escape.md"), Err(DesktopError::OutsideWorkspace)));
}
```

- [ ] **Step 3: Run and watch them fail**

Run: `cargo test metadata`
Expected: FAIL, `metadata` module not found.

- [ ] **Step 4: Implement**

Schema, applied by `migrate()` guarded on `PRAGMA user_version`:

```sql
CREATE TABLE IF NOT EXISTS documents (
  id         TEXT PRIMARY KEY,
  path       TEXT NOT NULL UNIQUE,
  sha256     TEXT,
  mtime_ms   INTEGER
);
```

`insert` validates the path with the same rules Task 3 applies on the TypeScript
side — no absolute path, no `..` segment, no backslash — and returns
`OutsideWorkspace` rather than storing it.

- [ ] **Step 5: Run**

Run: `cargo test metadata`
Expected: PASS, four tests.

- [ ] **Step 6: Replace the poisonable lock**

`workspace.rs` holds its state behind a `Mutex` whose poisoning would make every
later operation fatal. Recover from poisoning explicitly rather than propagating
it, and add a test that a panic in one operation leaves the next one working.

- [ ] **Step 7: Run the whole Rust suite**

Run: `cargo test`
Expected: PASS, existing tests included.

- [ ] **Step 8: Commit**

```bash
git add apps/desktop/src-tauri
git commit -m "feat: store desktop document identity in SQLite"
```

---

## Task 7: Desktop document commands

**Files:**
- Modify: `apps/desktop/src-tauri/src/commands.rs`, `lib.rs`, `capabilities/main.json`
- Modify: `packages/platform/src/tauri/bindings.ts` (regenerated)

**Interfaces:**
- Produces commands `list_documents`, `read_document`, `write_document`, `create_document`, `rename_document`, `remove_document`, each taking an identifier — never a path — and returning `Result<T, DesktopError>`.

- [ ] **Step 1: Write the failing test that no command accepts a path**

```rust
#[test]
fn no_command_takes_a_filesystem_path_argument() {
    let source = include_str!("../src/commands.rs");
    for forbidden in ["path: String", "path: PathBuf", "root: String"] {
        assert!(
            !source.contains(forbidden),
            "commands must address documents by identifier, found `{forbidden}`"
        );
    }
}
```

This is acceptance criterion 4, enforced rather than asserted in prose.

- [ ] **Step 2: Run and watch it fail**

Run: `cargo test no_command_takes`
Expected: FAIL — `atomic_write_markdown` still takes `path: String`.

- [ ] **Step 3: Implement the six commands**

Each resolves its identifier through `Metadata`, then calls the existing confined
filesystem code in `workspace.rs`. `atomic_write_markdown` and `read_markdown` are
removed; their bodies move behind `write_document` and `read_document`.

- [ ] **Step 4: Add exactly the new permissions**

In `capabilities/main.json`, replace the two removed permissions with the six new
ones. Do not add anything else.

- [ ] **Step 5: Regenerate and run**

Run: `cargo test && ./dev lint`
Expected: PASS, and `bindings.ts` shows the six commands.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src-tauri packages/platform
git commit -m "feat: address desktop documents by identifier, not by path"
```

---

## Task 8: The desktop adapter

**Files:**
- Create: `packages/platform/src/tauri/document-store.ts`, `packages/platform/src/tauri/workspace-host.ts`
- Test: `packages/platform/src/tauri/document-store.test.ts`

**Interfaces:**
- Consumes: the generated bindings, and `DocumentStore` from Task 4.
- Produces: `createTauriDocumentStore(): DocumentStore`, `createTauriWorkspaceHost(): WorkspaceHost`.

- [ ] **Step 1: Write the failing test**

The adapter is tested against a fake binding module, since the real boundary is
covered by Task 2's round trip. What is tested here is the mapping from a tagged
Rust error to a `StoreError`:

```ts
it('maps a tagged Rust error onto the contract error', async () => {
  const store = createTauriDocumentStore({
    readDocument: async () => { throw { NotFound: null } },
  } as never)
  await expect(store.read('x')).rejects.toMatchObject({ kind: 'not-found' })
})
```

- [ ] **Step 2: Run, implement, run**

Run: `./dev unit` — FAIL, then implement the mapping, then PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/platform
git commit -m "feat: implement the desktop document store over the bindings"
```

---

## Task 9: Migrate the proof screen and remove the backdoor

**Files:**
- Modify: `apps/web/src/App.vue`
- Delete: `apps/web/src/platform/desktop-proof.ts`, `apps/web/src/platform/desktop-proof.test.ts`
- Modify: `apps/web/src/print/PrintProof.vue`

- [ ] **Step 1: Write the failing test that the backdoor is gone**

```ts
it('does not read the print fallback from the query string', async () => {
  window.history.replaceState({}, '', '/?printFallback=1')
  const wrapper = mount(App)
  await flushPromises()
  expect(wrapper.find('[data-testid="print-pagination-status"]').text())
    .not.toMatch(/fallback/i)
})
```

- [ ] **Step 2: Run and watch it fail**

Run: `./dev unit`
Expected: FAIL — the parameter still forces the fallback.

- [ ] **Step 3: Replace the URL seam with a prop**

`PrintProof` already accepts `force-fallback`. Remove the `URLSearchParams` read in
`App.vue:71` and pass the prop from the browser test through a component-level
mount instead, so the seam exists in tests and not in the shipped bundle.

- [ ] **Step 4: Point the proof screen at the contracts**

Replace `createDesktopProofGateway` with `createTauriWorkspaceHost` and
`createTauriDocumentStore`. The screen keeps its shape; `stage-zero-proof.md`
becomes a document created through `DocumentStore.create`.

- [ ] **Step 5: Run every gate**

Run: `./dev unit && ./dev lint && ./dev e2e`
Expected: PASS throughout. The Mermaid and print browser tests are not coupled to
the gateway; if one fails, that is a regression to fix, not an expected cost.

- [ ] **Step 6: Commit**

```bash
git add apps/web packages/platform
git commit -m "refactor: move the proof screen onto the platform contracts"
```

---

## Task 10: Complete the round trip and close the stage

- [ ] **Step 1: Give the proof screen a control per command, then cover each**

The round trip drives the interface, so every command needs a control to reach it.
Add list, create, rename and remove controls to the proof screen beside the
existing save action, each with a `data-testid`. This is harness surface in a
screen Stage 2 deletes, not product surface — unlike `?printFallback=1`, it is
reachable only by interacting with a visible control, not by a crafted URL.

Then write one case per command from Task 7, plus one asserting the watcher event
arrives after an external write made outside the application.

- [ ] **Step 2: Re-prove the capability teeth**

Remove one permission, rebuild, confirm the matching case fails, restore. Record
which permission was removed and what the failure said.

- [ ] **Step 3: Run every gate against a packaged build**

```bash
./dev desktop-build
scripts/inspect-deb.sh apps/desktop/src-tauri/target/release/bundle/deb/*.deb
```

Confirm `inspect-deb.sh` still passes and that bundling SQLite added no runtime
dependency:

```bash
dpkg-deb --info apps/desktop/src-tauri/target/release/bundle/deb/*.deb | grep Depends
```

- [ ] **Step 4: Exercise the four host gates against the installed package**

Install, then repeat the folder, save, external-change and print checks that
ADR 0001 records for Stage 0. A gate is not passed until it is exercised in a
packaged build, and this stage rewrote the code behind all four.

- [ ] **Step 5: Record the evidence**

Write the measurements into `docs/engineering/evidence/stage-1a.md`: exact
commands, hashes, the capability-removal failure, and anything that did not work.

- [ ] **Step 6: Write the decision record**

`docs/decisions/0003-stage-one-a-contracts.md`, recording whether the two boundary
mechanisms held, the startup path argument added in Task 2, and any deviation.

- [ ] **Step 7: Commit**

```bash
git add docs apps packages .github
git commit -m "docs: record the Stage 1A contract evidence and decision"
```
