import { expect, it, vi } from 'vitest'

import { EXTERNAL_CHANGE_EVENT } from './bindings'
import { createTauriWorkspaceHost, type WorkspaceCommands } from './workspace-host'

function commands(overrides: Partial<WorkspaceCommands> = {}): WorkspaceCommands {
  return {
    chooseWorkspace: vi.fn(async () => ({ status: 'ok', data: '/tmp/notes' })),
    currentWorkspace: vi.fn(async () => ({ status: 'ok', data: '/tmp/notes' })),
    startWorkspaceWatch: vi.fn(async () => ({ status: 'ok', data: null })),
    ...overrides,
  } as WorkspaceCommands
}

it('starts watching the folder it adopted', async () => {
  const surface = commands()
  const host = createTauriWorkspaceHost(surface, vi.fn())

  await expect(host.adopt()).resolves.toBe('/tmp/notes')
  expect(surface.startWorkspaceWatch).toHaveBeenCalled()
})

it('does not start a watcher when the picker was cancelled', async () => {
  const surface = commands({
    chooseWorkspace: vi.fn(async () => ({ status: 'ok', data: null })),
  })
  const host = createTauriWorkspaceHost(surface, vi.fn())

  await expect(host.adopt()).resolves.toBeNull()
  // Watching a folder nobody chose would report changes the user never asked
  // about, against a root this side was never given.
  expect(surface.startWorkspaceWatch).not.toHaveBeenCalled()
})

it('reports a workspace adopted before the interface existed', async () => {
  const host = createTauriWorkspaceHost(commands(), vi.fn())
  await expect(host.current()).resolves.toBe('/tmp/notes')
})

it('subscribes to the generated event name', async () => {
  const listen = vi.fn(async () => () => {})
  const host = createTauriWorkspaceHost(commands(), listen)

  await host.watch(() => {})
  expect(listen).toHaveBeenCalledWith(EXTERNAL_CHANGE_EVENT, expect.any(Function))
})

it('renames the native change fields onto the shared model', async () => {
  let emit: ((payload: unknown) => void) | undefined
  const listen = vi.fn(async (_event: string, handler: (payload: unknown) => void) => {
    emit = handler
    return () => {}
  })
  const host = createTauriWorkspaceHost(commands(), listen)
  const seen = vi.fn()

  await host.watch(seen)
  emit?.({
    payload: { kind: 'modified', path: 'a.md', sha256: 'hash', mtimeUnixMs: 7 },
  })

  expect(seen).toHaveBeenCalledWith({
    kind: 'modified',
    path: 'a.md',
    contentHash: 'hash',
    modifiedAt: 7,
  })
})

it('reports a failure to adopt through the contract error', async () => {
  const host = createTauriWorkspaceHost(
    commands({
      chooseWorkspace: vi.fn(async () => ({
        status: 'error',
        error: { kind: 'unexpected', message: 'no display' },
      })),
    }),
    vi.fn(),
  )

  await expect(host.adopt()).rejects.toEqual({ kind: 'unexpected', message: 'no display' })
})
