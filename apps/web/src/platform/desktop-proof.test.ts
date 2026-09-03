import { describe, expect, it, vi } from 'vitest'
import { createDesktopProofGateway, type DesktopProofBridge } from './desktop-proof'

describe('desktop proof gateway', () => {
  it('reports unsupported in an ordinary browser without calling host APIs', async () => {
    const gateway = createDesktopProofGateway()

    expect(gateway.supported).toBe(false)
    await expect(gateway.chooseWorkspace()).rejects.toThrow('Tauri desktop host is unavailable')
  })

  it('keeps folder selection, proof commands, and events behind one adapter', async () => {
    const unlisten = vi.fn()
    const listener = vi.fn()
    const bridge: DesktopProofBridge = {
      invoke: vi.fn(async (command: string) => {
        if (command === 'choose_workspace') return '/tmp/stackmark-proof'
        // Nothing registered yet, so saving has to create the document.
        if (command === 'list_documents') return []
        if (command === 'create_document') {
          return {
            id: 'document-1',
            path: 'stage-zero-proof.md',
            sha256: 'proof-hash',
            mtimeUnixMs: 42,
          }
        }
        return undefined
      }),
      listen: vi.fn(async (_event, callback) => {
        callback({
          kind: 'modified',
          path: 'stage-zero-proof.md',
          sha256: 'external-hash',
          mtimeUnixMs: 84,
        })
        return unlisten
      }),
    }
    const gateway = createDesktopProofGateway(bridge)

    expect(gateway.supported).toBe(true)
    await expect(gateway.watchExternalChanges(listener)).resolves.toBe(unlisten)
    await expect(gateway.chooseWorkspace()).resolves.toBe('/tmp/stackmark-proof')
    await expect(gateway.saveProof('# Stage 0\n')).resolves.toEqual({
      path: 'stage-zero-proof.md',
      sha256: 'proof-hash',
      mtimeUnixMs: 42,
    })

    expect(bridge.listen).toHaveBeenCalledWith('workspace://external-change', expect.any(Function))
    expect(listener).toHaveBeenCalledWith({
      kind: 'modified',
      path: 'stage-zero-proof.md',
      sha256: 'external-hash',
      mtimeUnixMs: 84,
    })
    // The application opens the picker; this side never supplies a path, so
    // there is no argument here for a compromised page to control.
    expect(bridge.invoke).toHaveBeenNthCalledWith(1, 'choose_workspace')
    expect(bridge.invoke).toHaveBeenNthCalledWith(2, 'start_workspace_watch')
    expect(bridge.invoke).toHaveBeenNthCalledWith(3, 'list_documents')
    expect(bridge.invoke).toHaveBeenNthCalledWith(4, 'create_document', {
      path: 'stage-zero-proof.md',
      contents: '# Stage 0\n',
    })
  })

  it('writes by identifier when the document is already registered', async () => {
    const bridge: DesktopProofBridge = {
      invoke: vi.fn(async (command: string) => {
        if (command === 'list_documents') {
          return [{ id: 'document-1', path: 'stage-zero-proof.md' }]
        }
        if (command === 'write_document') {
          return { path: 'stage-zero-proof.md', sha256: 'second-hash', mtimeUnixMs: 99 }
        }
        return undefined
      }),
      listen: vi.fn(),
    }
    const gateway = createDesktopProofGateway(bridge)

    await expect(gateway.saveProof('# again\n')).resolves.toEqual({
      path: 'stage-zero-proof.md',
      sha256: 'second-hash',
      mtimeUnixMs: 99,
    })
    // The path was used once to find the document and never sent again.
    expect(bridge.invoke).toHaveBeenNthCalledWith(2, 'write_document', {
      id: 'document-1',
      contents: '# again\n',
    })
  })

  it('does not configure a workspace when folder selection is cancelled', async () => {
    const bridge: DesktopProofBridge = {
      invoke: vi.fn(async () => null),
      listen: vi.fn(),
    }
    const gateway = createDesktopProofGateway(bridge)

    await expect(gateway.chooseWorkspace()).resolves.toBeNull()
    // Only the picker ran: a cancelled selection must not start a watcher.
    expect(bridge.invoke).toHaveBeenCalledTimes(1)
    expect(bridge.invoke).toHaveBeenCalledWith('choose_workspace')
  })
})
