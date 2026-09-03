import type {
  Document,
  DocumentId,
  DocumentMetadata,
  DocumentSummary,
} from '@stackmark/core'

import type { DocumentStore, StoreError } from '../contracts'
import { commands as generated } from './bindings'

/**
 * The generated surface this adapter uses.
 *
 * Naming it separately is what lets the mapping be tested without a desktop
 * host. The real boundary is covered by the round-trip test against the built
 * binary, which is the only thing that can see the capability list; what is
 * worth testing here is the translation.
 */
export type DesktopCommands = Pick<
  typeof generated,
  | 'listDocuments'
  | 'readDocument'
  | 'writeDocument'
  | 'createDocument'
  | 'renameDocument'
  | 'removeDocument'
>

type NativeError =
  | { kind: 'outside-workspace'; path: string }
  | { kind: 'not-found' }
  | { kind: 'changed-underneath' }
  | { kind: 'unexpected'; message: string }

type NativeRow = {
  id: string
  path: string
  sha256: string | null
  mtimeUnixMs: number | null
}

/**
 * Translates a native failure into the contract's error.
 *
 * The categories are the same on both sides, so this mostly restores the
 * identifier: Rust does not echo it back, because the caller already had it,
 * and an error that cannot say which document it concerns is much less useful
 * to whoever has to handle it.
 */
function toStoreError(error: unknown, id?: DocumentId): StoreError {
  // Not every failure is one of ours. A command refused by the capability list
  // is rejected by the host with a plain string, and reading `.message` off it
  // yielded `undefined` -- the exact opaque failure these categories exist to
  // replace, arriving through the one path nobody had exercised.
  if (typeof error !== 'object' || error === null || !('kind' in error)) {
    return { kind: 'unexpected', message: String(error) }
  }
  const tagged = error as NativeError
  switch (tagged.kind) {
    case 'not-found':
      return { kind: 'not-found', id: id ?? '' }
    case 'changed-underneath':
      return { kind: 'changed-underneath', id: id ?? '' }
    case 'outside-workspace':
      return { kind: 'outside-workspace', path: tagged.path }
    default:
      return { kind: 'unexpected', message: tagged.message }
  }
}

async function unwrap<T>(
  call: Promise<{ status: 'ok'; data: T } | { status: 'error'; error: unknown }>,
  id?: DocumentId,
): Promise<T> {
  const result = await call
  if (result.status === 'ok') return result.data
  throw toStoreError(result.error, id)
}

function toSummary(row: NativeRow, workspaceId: string): DocumentSummary {
  return {
    id: row.id,
    workspaceId,
    path: row.path,
    // Null until the document has been written, which happens immediately for
    // anything created through this store. Empty rather than absent keeps the
    // shared model free of a "sometimes missing" case for one surface.
    contentHash: row.sha256 ?? '',
    modifiedAt: row.mtimeUnixMs ?? 0,
  }
}

/**
 * Documents on the desktop, over the generated command bindings.
 *
 * Every method sends an identifier. The path a document lives at is resolved
 * natively, so this side can name a document but never a file.
 */
export function createTauriDocumentStore(
  workspaceId: string,
  commands: DesktopCommands = generated,
): DocumentStore {
  async function rowFor(id: DocumentId): Promise<NativeRow> {
    const rows = (await unwrap(commands.listDocuments(), id)) as NativeRow[]
    const row = rows.find((candidate) => candidate.id === id)
    if (!row) throw { kind: 'not-found', id } satisfies StoreError
    return row
  }

  return {
    async list(): Promise<DocumentSummary[]> {
      const rows = (await unwrap(commands.listDocuments())) as NativeRow[]
      return rows.map((row) => toSummary(row, workspaceId))
    },

    async read(id: DocumentId): Promise<Document> {
      // The content and the metadata come from different commands, so they are
      // fetched together rather than one after the other.
      const [content, rows] = await Promise.all([
        unwrap(commands.readDocument(id), id) as Promise<string>,
        unwrap(commands.listDocuments(), id) as Promise<NativeRow[]>,
      ])
      const row = rows.find((candidate) => candidate.id === id)
      if (!row) throw { kind: 'not-found', id } satisfies StoreError
      return { ...toSummary(row, workspaceId), content }
    },

    async write(id: DocumentId, content: string): Promise<DocumentMetadata> {
      const written = await unwrap(commands.writeDocument(id, content), id)
      return {
        path: written.path,
        contentHash: written.sha256,
        modifiedAt: written.mtimeUnixMs,
      }
    },

    async create(path: string, content: string): Promise<Document> {
      const row = (await unwrap(commands.createDocument(path, content))) as NativeRow
      return { ...toSummary(row, workspaceId), content }
    },

    async rename(id: DocumentId, path: string): Promise<Document> {
      await unwrap(commands.renameDocument(id, path), id)
      const row = await rowFor(id)
      const content = (await unwrap(commands.readDocument(id), id)) as string
      return { ...toSummary(row, workspaceId), content }
    },

    async remove(id: DocumentId): Promise<void> {
      await unwrap(commands.removeDocument(id), id)
    },
  }
}
