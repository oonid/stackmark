import { invoke, isTauri } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'

const PROOF_PATH = 'stage-zero-proof.md'
const EXTERNAL_CHANGE_EVENT = 'workspace://external-change'

export interface WorkspaceFileMetadata {
  path: string
  sha256: string
  mtimeUnixMs: number
}

export interface WorkspaceExternalChange extends WorkspaceFileMetadata {
  kind: 'modified'
}

export interface DesktopProofBridge {
  invoke(command: string, args?: Record<string, unknown>): Promise<unknown>
  listen(
    event: string,
    listener: (payload: WorkspaceExternalChange) => void,
  ): Promise<UnlistenFn>
}

export interface DesktopProofGateway {
  readonly supported: boolean
  currentWorkspace(): Promise<string | null>
  chooseWorkspace(): Promise<string | null>
  saveProof(contents: string): Promise<WorkspaceFileMetadata>
  watchExternalChanges(
    listener: (change: WorkspaceExternalChange) => void,
  ): Promise<UnlistenFn>
}

function unsupported(): never {
  throw new Error('Tauri desktop host is unavailable')
}

function officialBridge(): DesktopProofBridge | undefined {
  if (!isTauri()) return undefined

  return {
    invoke(command, args) {
      return invoke(command, args)
    },
    listen(event, listener) {
      return listen<WorkspaceExternalChange>(event, ({ payload }) => listener(payload))
    },
  }
}

export function createDesktopProofGateway(
  bridge: DesktopProofBridge | undefined = officialBridge(),
): DesktopProofGateway {
  return {
    supported: bridge !== undefined,
    async currentWorkspace() {
      if (!bridge) unsupported()
      // A root may already be adopted — the startup path argument does that
      // before the interface exists. Asking the user to pick a folder they
      // already named would be wrong.
      return await bridge.invoke('current_workspace') as string | null
    },
    async chooseWorkspace() {
      if (!bridge) unsupported()
      // The application opens the picker and adopts the result itself. This
      // side never names a path, so a compromised page cannot choose the root
      // its own file access is confined to.
      const root = await bridge.invoke('choose_workspace') as string | null
      if (root === null) return null
      await bridge.invoke('start_workspace_watch')
      return root
    },
    async saveProof(contents) {
      if (!bridge) unsupported()
      // Documents are addressed by identifier, so the path is used once to
      // find or register the document and never sent again. Task 9 replaces
      // this screen with the real contracts; this keeps it working meanwhile.
      const documents = await bridge.invoke('list_documents') as { id: string; path: string }[]
      const existing = documents.find((document) => document.path === PROOF_PATH)
      if (existing) {
        return bridge.invoke('write_document', {
          id: existing.id,
          contents,
        }) as Promise<WorkspaceFileMetadata>
      }
      const created = await bridge.invoke('create_document', {
        path: PROOF_PATH,
        contents,
      }) as { id: string; path: string; sha256: string; mtimeUnixMs: number }
      return { path: created.path, sha256: created.sha256, mtimeUnixMs: created.mtimeUnixMs }
    },
    async watchExternalChanges(listener) {
      if (!bridge) unsupported()
      return bridge.listen(EXTERNAL_CHANGE_EVENT, listener)
    },
  }
}
