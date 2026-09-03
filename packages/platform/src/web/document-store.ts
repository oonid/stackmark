import {
  normalizeWorkspacePath,
  type Document,
  type DocumentId,
  type DocumentMetadata,
  type DocumentSummary,
} from '@stackmark/core'

import type { DocumentStore, StoreError } from '../contracts'

const STORE = 'documents'
const PATH_INDEX = 'path'

interface StoredDocument {
  id: DocumentId
  workspaceId: string
  path: string
  content: string
  contentHash: string
  modifiedAt: number
}

/** Opens, and creates the schema on first use. */
export function openDocumentDatabase(name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, 1)
    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(STORE)) {
        const documents = database.createObjectStore(STORE, { keyPath: 'id' })
        // Unique, so two documents cannot occupy one path. The database
        // enforces it rather than a check-then-write in application code, which
        // two concurrent callers could both pass.
        documents.createIndex(PATH_INDEX, 'path', { unique: true })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function unexpected(message: string): StoreError {
  return { kind: 'unexpected', message }
}

function notFound(id: DocumentId): StoreError {
  return { kind: 'not-found', id }
}

function request<T>(source: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    source.onsuccess = () => resolve(source.result)
    source.onerror = () => reject(unexpected(source.error?.message ?? 'request failed'))
  })
}

/**
 * Runs `work` inside one transaction and resolves when it has committed.
 *
 * Resolving on the transaction rather than on the last request is what makes a
 * failure leave the previous committed document intact: if any request inside
 * fails, the transaction aborts and nothing it did is kept.
 *
 * Nothing here may await a promise that is not an IndexedDB request. A
 * transaction stays alive only while requests are outstanding, so awaiting
 * anything else — hashing, for instance — lets it commit early and the next
 * request throws. Hashing therefore happens before the transaction opens.
 */
function transact<T>(
  database: IDBDatabase,
  mode: IDBTransactionMode,
  work: (documents: IDBObjectStore) => Promise<T>,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE, mode)
    let outcome: T
    let failure: unknown

    transaction.oncomplete = () => (failure === undefined ? resolve(outcome) : reject(failure))
    transaction.onabort = () =>
      reject(failure ?? unexpected(transaction.error?.message ?? 'transaction aborted'))
    transaction.onerror = () =>
      reject(failure ?? unexpected(transaction.error?.message ?? 'transaction failed'))

    work(transaction.objectStore(STORE)).then(
      (value) => {
        outcome = value
      },
      (error: unknown) => {
        failure = error
        try {
          transaction.abort()
        } catch {
          // Already finished; the handlers above still reject with `failure`.
        }
      },
    )
  })
}

async function sha256Hex(content: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(content))
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

function summarize(stored: StoredDocument): DocumentSummary {
  const { id, workspaceId, path, contentHash, modifiedAt } = stored
  return { id, workspaceId, path, contentHash, modifiedAt }
}

/**
 * Documents in IndexedDB.
 *
 * There is no folder and nothing outside the application can change a document,
 * so this is the whole of persistence on the web.
 */
export function createWebDocumentStore(
  database: IDBDatabase,
  workspaceId: string,
): DocumentStore {
  return {
    list(): Promise<DocumentSummary[]> {
      return transact(database, 'readonly', async (documents) => {
        const all = await request<StoredDocument[]>(
          documents.getAll() as IDBRequest<StoredDocument[]>,
        )
        return all.map(summarize)
      })
    },

    read(id: DocumentId): Promise<Document> {
      return transact(database, 'readonly', async (documents) => {
        const stored = await request<StoredDocument | undefined>(
          documents.get(id) as IDBRequest<StoredDocument | undefined>,
        )
        if (!stored) throw notFound(id)
        return stored
      })
    },

    async write(id: DocumentId, content: string): Promise<DocumentMetadata> {
      const contentHash = await sha256Hex(content)
      const modifiedAt = Date.now()

      return transact(database, 'readwrite', async (documents) => {
        const stored = await request<StoredDocument | undefined>(
          documents.get(id) as IDBRequest<StoredDocument | undefined>,
        )
        // Refusing here rather than putting unconditionally is what stops a
        // write to a deleted document from quietly resurrecting it.
        if (!stored) throw notFound(id)

        const updated: StoredDocument = { ...stored, content, contentHash, modifiedAt }
        await request(documents.put(updated))
        return { path: updated.path, contentHash, modifiedAt }
      })
    },

    async create(path: string, content: string): Promise<Document> {
      const normalized = normalizeWorkspacePath(path)
      const contentHash = await sha256Hex(content)
      const stored: StoredDocument = {
        id: crypto.randomUUID(),
        workspaceId,
        path: normalized,
        content,
        contentHash,
        modifiedAt: Date.now(),
      }

      return transact(database, 'readwrite', async (documents) => {
        await request(documents.add(stored))
        return stored
      })
    },

    async rename(id: DocumentId, path: string): Promise<Document> {
      const normalized = normalizeWorkspacePath(path)

      return transact(database, 'readwrite', async (documents) => {
        const stored = await request<StoredDocument | undefined>(
          documents.get(id) as IDBRequest<StoredDocument | undefined>,
        )
        if (!stored) throw notFound(id)

        const moved: StoredDocument = { ...stored, path: normalized }
        // The unique index rejects an occupied path, which aborts the
        // transaction and leaves the original where it was.
        await request(documents.put(moved))
        return moved
      })
    },

    remove(id: DocumentId): Promise<void> {
      return transact(database, 'readwrite', async (documents) => {
        await request(documents.delete(id))
      })
    },
  }
}
