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
      openDirectory: vi.fn().mockResolvedValue('/tmp/stackmark-proof'),
      invoke: vi.fn(async (command: string) => {
        if (command === 'atomic_write_markdown') {
          return {
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
    expect(bridge.invoke).toHaveBeenNthCalledWith(1, 'set_workspace_root', {
      root: '/tmp/stackmark-proof',
    })
    expect(bridge.invoke).toHaveBeenNthCalledWith(2, 'start_workspace_watch')
    expect(bridge.invoke).toHaveBeenNthCalledWith(3, 'atomic_write_markdown', {
      path: 'stage-zero-proof.md',
      contents: '# Stage 0\n',
    })
  })

  it('does not configure a workspace when folder selection is cancelled', async () => {
    const bridge: DesktopProofBridge = {
      openDirectory: vi.fn().mockResolvedValue(null),
      invoke: vi.fn(),
      listen: vi.fn(),
    }
    const gateway = createDesktopProofGateway(bridge)

    await expect(gateway.chooseWorkspace()).resolves.toBeNull()
    expect(bridge.invoke).not.toHaveBeenCalled()
  })
})
