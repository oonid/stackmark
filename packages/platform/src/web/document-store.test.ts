import 'fake-indexeddb/auto'

import { InvalidPathError } from '@stackmark/core'
import { beforeEach, expect, it } from 'vitest'

import { createWebDocumentStore, openDocumentDatabase } from './document-store'

let store: Awaited<ReturnType<typeof createWebDocumentStore>>
let databaseCount = 0

beforeEach(async () => {
  // A fresh database per test, so one test's documents cannot explain another's
  // result.
  databaseCount += 1
  const database = await openDocumentDatabase(`stackmark-test-${databaseCount}`)
  store = createWebDocumentStore(database, 'workspace-under-test')
})

it('round-trips a document', async () => {
  const created = await store.create('notes/daily.md', '# hello\n')
  const read = await store.read(created.id)

  expect(read.content).toBe('# hello\n')
  expect(read.path).toBe('notes/daily.md')
  expect(read.workspaceId).toBe('workspace-under-test')
})

it('normalizes the path it is given', async () => {
  const created = await store.create('notes//./daily.md', 'x')
  expect(created.path).toBe('notes/daily.md')
})

it('refuses a path that escapes the workspace', async () => {
  await expect(store.create('../escape.md', 'x')).rejects.toThrow(InvalidPathError)
})

it('keeps the identifier across a rename', async () => {
  const created = await store.create('a.md', 'x')
  const renamed = await store.rename(created.id, 'b.md')

  expect(renamed.id).toBe(created.id)
  expect(renamed.path).toBe('b.md')
  expect((await store.read(created.id)).content).toBe('x')
})

it('reports not-found rather than an opaque failure', async () => {
  await expect(store.read('missing')).rejects.toMatchObject({ kind: 'not-found', id: 'missing' })
})

it('does not create a document when writing to one that is not there', async () => {
  await expect(store.write('missing', 'x')).rejects.toMatchObject({ kind: 'not-found' })
  // A naive implementation that simply puts would have created it here, and the
  // rejection above would have been the only sign anything was wrong.
  expect(await store.list()).toHaveLength(0)
})

it('refuses to rename onto an occupied path', async () => {
  const first = await store.create('a.md', 'first')
  await store.create('b.md', 'second')

  await expect(store.rename(first.id, 'b.md')).rejects.toMatchObject({ kind: 'unexpected' })
  expect((await store.read(first.id)).path).toBe('a.md')
})

it('changes the hash and the modification time when the content changes', async () => {
  const created = await store.create('a.md', 'first')
  const written = await store.write(created.id, 'second')

  expect(written.contentHash).not.toBe(created.contentHash)
  expect(written.modifiedAt).toBeGreaterThanOrEqual(created.modifiedAt)
  expect((await store.read(created.id)).content).toBe('second')
})

it('lists summaries without loading content', async () => {
  await store.create('a.md', 'x')
  await store.create('b.md', 'y')

  const listed = await store.list()
  expect(listed.map((entry) => entry.path).sort()).toEqual(['a.md', 'b.md'])
  expect(listed.every((entry) => !('content' in entry))).toBe(true)
})

it('removes a document', async () => {
  const created = await store.create('a.md', 'x')
  await store.remove(created.id)

  await expect(store.read(created.id)).rejects.toMatchObject({ kind: 'not-found' })
  expect(await store.list()).toHaveLength(0)
})
