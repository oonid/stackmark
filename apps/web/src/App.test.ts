import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import App from './App.vue'

describe('Stage 0 proof screen', () => {
  it('presents the required web and desktop proof gates', () => {
    const wrapper = mount(App)

    expect(wrapper.get('[data-testid="stage-zero-title"]').text()).toBe('StackEdit Stage 0')
    expect(wrapper.find('[data-testid="markdown-source"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="rendered-preview"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="desktop-file-proof"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="print-proof"]').exists()).toBe(true)
  })

  it('keeps desktop controls unavailable in a browser and offers browser printing', async () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined)
    const wrapper = mount(App)

    expect(wrapper.get('[data-testid="desktop-file-proof"] button').attributes('disabled')).toBeDefined()

    await wrapper.get('[data-testid="print-proof"]').trigger('click')

    expect(print).toHaveBeenCalledOnce()
  })

  it('renders the initial Markdown document into the reviewed sanitized preview boundary', () => {
    const wrapper = mount(App)

    expect(wrapper.get('[data-testid="rendered-preview"]').html()).toContain(
      '<h1>StackEdit print proof</h1>',
    )
  })

  it('updates the sanitized preview after the render debounce', async () => {
    vi.useFakeTimers()
    const wrapper = mount(App)

    try {
      await wrapper.get('[data-testid="markdown-source"]').setValue('# Updated preview')
      expect(wrapper.get('[data-testid="rendered-preview"]').html()).not.toContain(
        '<h1>Updated preview</h1>',
      )

      await vi.advanceTimersByTimeAsync(150)
      await wrapper.vm.$nextTick()

      expect(wrapper.get('[data-testid="rendered-preview"]').html()).toContain(
        '<h1>Updated preview</h1>',
      )
    } finally {
      wrapper.unmount()
      vi.useRealTimers()
    }
  })
})
