/**
 * The shared document model.
 *
 * Deliberately small, and identical on both surfaces. A document is identified
 * by an opaque string, never by its location: the web stores that identifier in
 * IndexedDB, and the desktop maps it to a workspace-relative path in its own
 * database. Renaming changes the path and keeps the identifier.
 *
 * Nothing here knows about IndexedDB, the filesystem, Vue or Tauri.
 */

/** Opaque. Callers must not parse it or derive a location from it. */
export type DocumentId = string

/** What is known about a document without reading its content. */
export interface DocumentMetadata {
  /** Normalized, workspace-relative, POSIX-style. */
  path: string
  /** Lowercase hexadecimal SHA-256 of the stored bytes. */
  contentHash: string
  /** Milliseconds since the Unix epoch. */
  modifiedAt: number
}

export interface DocumentSummary extends DocumentMetadata {
  id: DocumentId
  workspaceId: string
}

export interface Document extends DocumentSummary {
  content: string
}
