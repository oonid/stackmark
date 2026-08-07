import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { describe, expect, it, vi } from 'vitest'

const pending = vi.hoisted(() => [] as Array<{
  options: { target: HTMLElement }
  resolve: (result: { mode: 'pagedjs'; pageCount: number; warnings: [] }) => void
}>)

vi.mock('@stackedit/print', () => ({
  DEFAULT_PRINT_SETTINGS: { pageSize: 'A4' },
  findPagesHidingContentWhenSettled: vi.fn(async () => []),
  installNativePageRule: vi.fn(),
  paginate: vi.fn((options: { target: HTMLElement }) => new Promise((resolve) => {
    pending.push({ options, resolve: resolve as (result: { mode: 'pagedjs'; pageCount: number; warnings: [] }) => void })
  })),
}))

import PrintProof from './PrintProof.vue'

const first = { html: '<p>first print version</p>', mermaidBlocks: [], warnings: [] }
const second = { html: '<p>second print version</p>', mermaidBlocks: [], warnings: [] }

describe('PrintProof', () => {
  it('does not let a stale preview mutate the current paged output', async () => {
    pending.length = 0
    const wrapper = mount(PrintProof, {
      props: { rendered: first, mermaidSvg: {}, forceFallback: false },
    })
    await nextTick()
    await nextTick()
    await wrapper.setProps({ rendered: second })
    await nextTick()
    await nextTick()

    pending[1].options.target.append('new page')
    pending[1].resolve({ mode: 'pagedjs', pageCount: 1, warnings: [] })
    await nextTick()
    pending[0].options.target.append('stale page')
    pending[0].resolve({ mode: 'pagedjs', pageCount: 1, warnings: [] })
    await nextTick()

    expect(wrapper.get('.paged-output').text()).toBe('new page')
  })
})
