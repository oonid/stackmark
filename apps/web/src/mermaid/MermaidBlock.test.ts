import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import MermaidBlock from './MermaidBlock.vue'

const render = vi.fn<(source: string) => Promise<string>>()

vi.mock('./MermaidSandbox', () => ({
  getMermaidSandbox: async () => ({ render }),
}))

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((next) => { resolve = next })
  return { promise, resolve }
}

describe('MermaidBlock', () => {
  beforeEach(() => render.mockReset())

  it('ignores an older render that resolves after the current source', async () => {
    const first = deferred<string>()
    const second = deferred<string>()
    render.mockImplementation((source) => source === 'first' ? first.promise : second.promise)
    const wrapper = mount(MermaidBlock, { props: { source: 'first' } })
    await flushPromises()

    await wrapper.setProps({ source: 'second' })
    await flushPromises()
    second.resolve('<svg role="img"><text>second</text></svg>')
    await flushPromises()
    expect(wrapper.text()).toContain('second')

    first.resolve('<svg role="img"><text>first</text></svg>')
    await flushPromises()
    expect(wrapper.text()).toContain('second')
    expect(wrapper.text()).not.toContain('first')
  })
})
