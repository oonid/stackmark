import { expect, it } from 'vitest'

import { UnsupportedOnWebError } from '../contracts'
import { createWebWorkspaceHost } from './workspace-host'

it('reports that it cannot adopt a folder', () => {
  expect(createWebWorkspaceHost().supported).toBe(false)
})

it('rejects rather than pretending to adopt a folder', async () => {
  await expect(createWebWorkspaceHost().adopt()).rejects.toThrow(UnsupportedOnWebError)
})

it('rejects rather than silently never reporting an external change', async () => {
  // Resolving with a no-op unsubscribe would be worse than failing: a caller
  // would wait forever for changes that cannot arrive, and nothing would say so.
  await expect(createWebWorkspaceHost().watch(() => {})).rejects.toThrow(UnsupportedOnWebError)
})

it('names the capability in the message, not just the surface', async () => {
  await expect(createWebWorkspaceHost().adopt()).rejects.toThrow(/workspace/i)
})
