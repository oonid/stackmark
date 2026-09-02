import { describe, expect, it } from 'vitest'
import { MermaidSandbox } from './MermaidSandbox'

describe('MermaidSandbox', () => {
  it('reports a renderer frame that never loads instead of hanging', async () => {
    // jsdom never loads the frame's document, which stands in for the packaged
    // failure where the renderer script was refused: without a bound, render()
    // awaits readiness forever and the caller sees no error at all.
    const sandbox = await MermaidSandbox.create(50)

    await expect(sandbox.render('flowchart TD\n  A --> B')).rejects.toThrow(/did not load/i)
  })
})
