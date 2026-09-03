/**
 * The platform contracts.
 *
 * Defined once, implemented twice: IndexedDB on the web, files plus a native
 * database on the desktop. Application services depend on these interfaces and
 * never on IndexedDB, the filesystem or Tauri, so a capability that only one
 * surface has is a method that fails loudly on the other rather than a branch
 * scattered through the callers.
 */

import type {
  Document,
  DocumentId,
  DocumentMetadata,
  DocumentSummary,
} from '@stackmark/core'

/**
 * Why an operation failed, in categories a caller can act on.
 *
 * These are values rather than subclasses of `Error` because they cross the
 * process boundary: the desktop returns the same shape from Rust, and a caller
 * should not have to tell a rejected promise from a serialized one. The
 * distinction between a stale write and a failed one is what the conflict
 * workflow will be built on, so it belongs in the contract from the start
 * rather than being recovered from message text later.
 */
export type StoreError =
  | { kind: 'outside-workspace'; path: string }
  | { kind: 'not-found'; id: DocumentId }
  | { kind: 'changed-underneath'; id: DocumentId }
  | { kind: 'unexpected'; message: string }

export function isStoreError(value: unknown): value is StoreError {
  return typeof value === 'object' && value !== null && 'kind' in value
}

/** Raised by a web implementation asked for a capability only the desktop has. */
export class UnsupportedOnWebError extends Error {
  constructor(capability: string) {
    super(`${capability} is not available in the browser`)
    this.name = 'UnsupportedOnWebError'
  }
}

/** A change made to a document by something other than this application. */
export interface ExternalChange extends DocumentMetadata {
  kind: 'modified'
}

/** Cancels a subscription. Calling it twice is harmless. */
export type Unsubscribe = () => void

/**
 * Adopting a workspace and watching it.
 *
 * The desktop implements this; the web reports `supported: false` and rejects.
 * Note that `adopt` takes no argument: the native side owns the folder picker,
 * so this layer asks for a workspace but can never name one.
 */
export interface WorkspaceHost {
  readonly supported: boolean
  /** The adopted root, or `null` if the user chose nothing. */
  adopt(): Promise<string | null>
  /** The already-adopted root, if a workspace was opened before the interface. */
  current(): Promise<string | null>
  watch(listener: (change: ExternalChange) => void): Promise<Unsubscribe>
}

/**
 * Reading and writing documents.
 *
 * Every method addresses a document by identifier. `create` and `rename` take a
 * path because that is when a location is chosen; nothing else does.
 *
 * The desktop implementation requires the parent directory to exist: creating
 * `notes/daily.md` in a workspace with no `notes` folder fails. The web
 * implementation has no directories and accepts it. That asymmetry is a known
 * gap, not a design intent — creating a directory has to happen beneath the
 * held root descriptor to stay confined, and that work is not done here.
 */
export interface DocumentStore {
  list(): Promise<DocumentSummary[]>
  read(id: DocumentId): Promise<Document>
  write(id: DocumentId, content: string): Promise<DocumentMetadata>
  create(path: string, content: string): Promise<Document>
  rename(id: DocumentId, path: string): Promise<Document>
  remove(id: DocumentId): Promise<void>
}
