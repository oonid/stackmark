import { expect, it, vi } from 'vitest'

import { createTauriDocumentStore, type DesktopCommands } from './document-store'

const ROW = { id: 'doc-1', path: 'notes/a.md', sha256: 'hash-1', mtimeUnixMs: 1000 }

function commands(overrides: Partial<DesktopCommands> = {}): DesktopCommands {
  return {
    listDocuments: vi.fn(async () => ({ status: 'ok', data: [ROW] })),
    readDocument: vi.fn(async () => ({ status: 'ok', data: '# hello' })),
    writeDocument: vi.fn(async () => ({
      status: 'ok',
      data: { path: ROW.path, sha256: 'hash-2', mtimeUnixMs: 2000 },
    })),
    createDocument: vi.fn(async () => ({ status: 'ok', data: ROW })),
    renameDocument: vi.fn(async () => ({ status: 'ok', data: null })),
    removeDocument: vi.fn(async () => ({ status: 'ok', data: null })),
    ...overrides,
  } as DesktopCommands
}

it('maps a missing document onto the contract error, restoring the identifier', async () => {
  // Rust does not echo the identifier back -- it already knows the caller has
  // it -- so the adapter puts it back rather than leaving the caller with an
  // error that cannot say which document it is about.
  const store = createTauriDocumentStore('workspace-1', commands({
    readDocument: vi.fn(async () => ({ status: 'error', error: { kind: 'not-found' } })),
  }))

  await expect(store.read('doc-9')).rejects.toEqual({ kind: 'not-found', id: 'doc-9' })
})

it('carries the refused path through an outside-workspace error', async () => {
  const store = createTauriDocumentStore('workspace-1', commands({
    createDocument: vi.fn(async () => ({
      status: 'error',
      error: { kind: 'outside-workspace', path: '../escape.md' },
    })),
  }))

  await expect(store.create('../escape.md', 'x')).rejects.toEqual({
    kind: 'outside-workspace',
    path: '../escape.md',
  })
})

it('keeps the message of an unexpected failure', async () => {
  const store = createTauriDocumentStore('workspace-1', commands({
    removeDocument: vi.fn(async () => ({
      status: 'error',
      error: { kind: 'unexpected', message: 'disk on fire' },
    })),
  }))

  await expect(store.remove('doc-1')).rejects.toEqual({
    kind: 'unexpected',
    message: 'disk on fire',
  })
})

it('renames the native field names onto the shared model', async () => {
  const store = createTauriDocumentStore('workspace-1', commands())
  const written = await store.write('doc-1', 'x')

  expect(written).toEqual({ path: 'notes/a.md', contentHash: 'hash-2', modifiedAt: 2000 })
})

it('lists summaries carrying the workspace it was built for', async () => {
  const store = createTauriDocumentStore('workspace-1', commands())
  const [summary] = await store.list()

  expect(summary).toEqual({
    id: 'doc-1',
    workspaceId: 'workspace-1',
    path: 'notes/a.md',
    contentHash: 'hash-1',
    modifiedAt: 1000,
  })
})

it('returns a registered but never written document with an empty hash', async () => {
  const store = createTauriDocumentStore('workspace-1', commands({
    listDocuments: vi.fn(async () => ({
      status: 'ok',
      data: [{ id: 'doc-1', path: 'a.md', sha256: null, mtimeUnixMs: null }],
    })),
  }))

  const [summary] = await store.list()
  expect(summary.contentHash).toBe('')
  expect(summary.modifiedAt).toBe(0)
})

it('combines content and metadata into one document', async () => {
  const store = createTauriDocumentStore('workspace-1', commands())
  const document = await store.read('doc-1')

  expect(document).toEqual({
    id: 'doc-1',
    workspaceId: 'workspace-1',
    path: 'notes/a.md',
    content: '# hello',
    contentHash: 'hash-1',
    modifiedAt: 1000,
  })
})

it('returns the created document with the content it was given', async () => {
  const store = createTauriDocumentStore('workspace-1', commands())
  const created = await store.create('notes/a.md', '# new')

  expect(created.content).toBe('# new')
  expect(created.id).toBe('doc-1')
})

it('sends the identifier and never the path when writing', async () => {
  const surface = commands()
  const store = createTauriDocumentStore('workspace-1', surface)
  await store.write('doc-1', 'x')

  expect(surface.writeDocument).toHaveBeenCalledWith('doc-1', 'x')
})
