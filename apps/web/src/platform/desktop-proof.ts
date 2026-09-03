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
      return bridge.invoke('atomic_write_markdown', {
        path: PROOF_PATH,
        contents,
      }) as Promise<WorkspaceFileMetadata>
    },
    async watchExternalChanges(listener) {
      if (!bridge) unsupported()
      return bridge.listen(EXTERNAL_CHANGE_EVENT, listener)
    },
  }
}
