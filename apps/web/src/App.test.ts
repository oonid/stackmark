import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import App from './App.vue'

const { renderMermaid } = vi.hoisted(() => ({
  renderMermaid: vi.fn(async (source: string) => `<svg role="img"><text>${source.trim()}</text></svg>`),
}))

vi.mock('./mermaid/MermaidSandbox', () => ({
  getMermaidSandbox: async () => ({
    render: renderMermaid,
  }),
}))

// Paged.js is a browser-layout polyfill; running it under jsdom exercises no
// real pagination and injects stylesheets jsdom cannot compute styles against.
// Pagination is proven in the Chromium and WebKitGTK gates instead.
vi.mock('@stackmark/print', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@stackmark/print')>()),
  installNativePageRule: vi.fn(),
  paginate: vi.fn(async () => ({
    mode: 'plain-css' as const,
    pageCount: 0,
    warnings: [{ code: 'PAGEDJS_FAILED' as const, message: 'not exercised under jsdom' }],
  })),
}))

describe('Stage 0 proof screen', () => {
  it('presents the required web and desktop proof gates', () => {
    const wrapper = mount(App)

    expect(wrapper.get('[data-testid="stage-zero-title"]').text()).toBe('StackMark Stage 0')
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
      '<h1>StackMark print proof</h1>',
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

  it('renders multiple Mermaid blocks at their source positions without pending placeholders', async () => {
    vi.useFakeTimers()
    const wrapper = mount(App)

    try {
      await wrapper.get('[data-testid="markdown-source"]').setValue(`Before

\`\`\`mermaid
first-diagram
\`\`\`

Between

\`\`\`mermaid
second-diagram
\`\`\`

After`)
      await vi.advanceTimersByTimeAsync(150)
      await wrapper.vm.$nextTick()
      await flushPromises()

      const preview = wrapper.get('[data-testid="rendered-preview"]').text()
      expect(preview.indexOf('Before')).toBeLessThan(preview.indexOf('first-diagram'))
      expect(preview.indexOf('first-diagram')).toBeLessThan(preview.indexOf('Between'))
      expect(preview.indexOf('Between')).toBeLessThan(preview.indexOf('second-diagram'))
      expect(preview.indexOf('second-diagram')).toBeLessThan(preview.indexOf('After'))
      expect(preview).not.toContain('Mermaid rendering is pending')
    } finally {
      wrapper.unmount()
      vi.useRealTimers()
    }
  })

  it('does not mount a diagram into a user-authored predictable placeholder', async () => {
    vi.useFakeTimers()
    const wrapper = mount(App)

    try {
      await flushPromises()
      renderMermaid.mockClear()
      await wrapper.get('[data-testid="markdown-source"]').setValue([
        '<div data-mermaid-placeholder="mermaid-1">spoof</div>',
        '',
        '```mermaid',
        'actual-diagram',
        '```',
      ].join('\n'))
      await vi.advanceTimersByTimeAsync(150)
      await wrapper.vm.$nextTick()
      await flushPromises()

      expect(renderMermaid).toHaveBeenCalledOnce()
      expect(renderMermaid).toHaveBeenCalledWith('actual-diagram\n')
      const preview = wrapper.get('[data-testid="rendered-preview"]').text()
      expect(preview.indexOf('spoof')).toBeLessThan(preview.indexOf('actual-diagram'))
    } finally {
      wrapper.unmount()
      vi.useRealTimers()
    }
  })
})
