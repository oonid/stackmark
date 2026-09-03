import type { ExternalChange, Unsubscribe, WorkspaceHost } from '../contracts'
import { commands as generated, EXTERNAL_CHANGE_EVENT } from './bindings'

export type WorkspaceCommands = Pick<
  typeof generated,
  'chooseWorkspace' | 'currentWorkspace' | 'startWorkspaceWatch'
>

/** The shape of `listen` from the Tauri event API, narrowed to what is used. */
export type Listen = (
  event: string,
  handler: (message: { payload: unknown }) => void,
) => Promise<Unsubscribe>

type NativeChange = {
  kind: 'modified'
  path: string
  sha256: string
  mtimeUnixMs: number
}

async function unwrap<T>(
  call: Promise<{ status: 'ok'; data: T } | { status: 'error'; error: unknown }>,
): Promise<T> {
  const result = await call
  if (result.status === 'ok') return result.data
  throw result.error
}

/**
 * The desktop workspace.
 *
 * `adopt` takes no argument: the application owns the folder picker, so this
 * side asks for a workspace and is told which one it got, but can never name
 * it. That is what keeps kernel-level confinement meaningful — a root the
 * untrusted side chose would confine access to a directory an attacker picked.
 */
export function createTauriWorkspaceHost(
  commands: WorkspaceCommands = generated,
  listen: Listen = defaultListen,
): WorkspaceHost {
  return {
    supported: true,

    async adopt(): Promise<string | null> {
      const root = await unwrap(commands.chooseWorkspace())
      // A cancelled picker leaves no workspace, and starting a watcher then
      // would report changes nobody asked about, on a root this side was never
      // given.
      if (root === null) return null
      await unwrap(commands.startWorkspaceWatch())
      return root
    },

    current(): Promise<string | null> {
      return unwrap(commands.currentWorkspace())
    },

    watch(listener: (change: ExternalChange) => void): Promise<Unsubscribe> {
      // The event name is generated from the Rust definition, so renaming it on
      // either side makes the committed bindings stale and fails the build.
      return listen(EXTERNAL_CHANGE_EVENT, ({ payload }) => {
        const change = payload as NativeChange
        listener({
          kind: change.kind,
          path: change.path,
          contentHash: change.sha256,
          modifiedAt: change.mtimeUnixMs,
        })
      })
    },
  }
}

/** Loaded lazily so that importing this module does not require a desktop host. */
const defaultListen: Listen = async (event, handler) => {
  const { listen } = await import('@tauri-apps/api/event')
  return listen(event, handler as never)
}
