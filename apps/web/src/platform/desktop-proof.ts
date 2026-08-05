import { invoke, isTauri } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { open } from '@tauri-apps/plugin-dialog'

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
  openDirectory(): Promise<string | null>
  invoke(command: string, args?: Record<string, unknown>): Promise<unknown>
  listen(
    event: string,
    listener: (payload: WorkspaceExternalChange) => void,
  ): Promise<UnlistenFn>
}

export interface DesktopProofGateway {
  readonly supported: boolean
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
    async openDirectory() {
      const selection = await open({ directory: true, multiple: false })
      return typeof selection === 'string' ? selection : null
    },
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
    async chooseWorkspace() {
      if (!bridge) unsupported()
      const root = await bridge.openDirectory()
      if (root === null) return null
      await bridge.invoke('set_workspace_root', { root })
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
