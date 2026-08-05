import { describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_PRINT_SETTINGS,
  awaitPrintResources,
  paginate,
  printPolicy,
} from './paginate'

describe('print policy', () => {
  it('uses typed A4 portrait defaults without accepting CSS strings', () => {
    expect(DEFAULT_PRINT_SETTINGS).toEqual({
      pageSize: 'A4',
      orientation: 'portrait',
      margins: { top: '16mm', right: '14mm', bottom: '18mm', left: '14mm' },
      runningTitle: 'StackEdit print proof',
      pageCounter: 'Page {{page}} of {{pages}}',
    })
    expect(printPolicy(DEFAULT_PRINT_SETTINGS).pageClass).toBe('stackedit-print-document')
  })

  it('keeps pages readable with safe image, code, heading, and table policies', () => {
    expect(printPolicy(DEFAULT_PRINT_SETTINGS)).toMatchObject({
      imageMaxWidth: '100%',
      imageMaxHeight: '240mm',
      codeWhiteSpace: 'pre-wrap',
      codeOverflowWrap: 'anywhere',
      headingBreakAfter: 'avoid-page',
      tableHeaderDisplay: 'table-header-group',
    })
  })
})

describe('pagination adapter', () => {
  it('reports Paged.js page count after resources are ready', async () => {
    const events: string[] = []
    const document = {
      fonts: { ready: Promise.resolve() },
      querySelectorAll: () => [
        { complete: true, addEventListener: () => undefined, removeEventListener: () => undefined },
      ],
    } as unknown as Document
    const source = globalThis.document.createElement('article')
    const target = {} as HTMLElement

    const result = await paginate({
      document,
      source,
      target,
      waitForMermaid: async () => { events.push('mermaid') },
      waitForKatex: async () => { events.push('katex') },
      preview: async () => ({ total: 2 }),
    })

    expect(events).toEqual(['katex', 'mermaid'])
    expect(result).toEqual({ mode: 'pagedjs', pageCount: 2, warnings: [] })
  })

  it('refuses the Paged.js path when no print stylesheet is supplied', async () => {
    // Paged.js only learns @page geometry from the stylesheets it is handed. Given
    // none, it silently falls back to its built-in Letter defaults, so an empty
    // stylesheet list must be treated as a failure rather than a successful run.
    const document = {
      fonts: { ready: Promise.resolve() },
      querySelectorAll: () => [],
    } as unknown as Document
    const source = globalThis.document.createElement('article')
    const target = globalThis.document.createElement('div')

    const result = await paginate({ document, source, target, stylesheets: [] })

    expect(result.mode).toBe('plain-css')
    expect(result.warnings[0]?.code).toBe('PAGEDJS_FAILED')
    expect(result.warnings[0]?.message).toMatch(/stylesheet/i)
  })

  it('selects the plain-CSS fallback when Paged.js fails or times out', async () => {
    const document = {
      fonts: { ready: Promise.resolve() },
      querySelectorAll: () => [],
    } as unknown as Document
    const target = { classList: { add: (name: string) => expect(name).toBe('pagedjs-failed') } } as unknown as HTMLElement

    const result = await paginate({
      document,
      source: globalThis.document.createElement('article'),
      target,
      timeoutMs: 1,
      preview: async () => new Promise(() => undefined),
    })

    expect(result.mode).toBe('plain-css')
    expect(result.pageCount).toBe(0)
    expect(result.warnings).toEqual([{ code: 'PAGEDJS_TIMEOUT', message: 'Paged.js pagination timed out; using plain CSS.' }])
  })

  it('returns the typed fallback when a readiness step rejects', async () => {
    const document = {
      fonts: { ready: Promise.reject(new Error('font load failed')) },
      querySelectorAll: () => [],
    } as unknown as Document
    const target = { classList: { add: () => undefined } } as unknown as HTMLElement

    await expect(paginate({
      document,
      source: globalThis.document.createElement('article'),
      target,
      preview: async () => ({ total: 2 }),
    })).resolves.toEqual({
      mode: 'plain-css',
      pageCount: 0,
      warnings: [{ code: 'PAGEDJS_FAILED', message: 'Paged.js pagination failed (font load failed); using plain CSS.' }],
    })
  })

  it('times out stalled resource readiness before preview starts', async () => {
    const document = {
      fonts: { ready: new Promise(() => undefined) },
    } as unknown as Document
    const preview = vi.fn(async () => ({ total: 2 }))

    const result = await paginate({
      document,
      source: globalThis.document.createElement('article'),
      target: globalThis.document.createElement('div'),
      timeoutMs: 1,
      preview,
    })

    expect(result).toEqual({
      mode: 'plain-css',
      pageCount: 0,
      warnings: [{ code: 'PAGEDJS_TIMEOUT', message: 'Paged.js pagination timed out; using plain CSS.' }],
    })
    expect(preview).not.toHaveBeenCalled()
  })

  it('does not wait for incomplete images outside the print source', async () => {
    const outsideImage = {
      complete: false,
      addEventListener: () => undefined,
    }
    const document = {
      fonts: { ready: Promise.resolve() },
      querySelectorAll: () => [outsideImage],
    } as unknown as Document
    const source = Object.assign(globalThis.document.createElement('article'), {
      querySelectorAll: () => [],
    })
    const target = {} as HTMLElement

    const result = await Promise.race([
      paginate({ document, source, target, preview: async () => ({ total: 2 }) }),
      new Promise<'still waiting'>((resolve) => window.setTimeout(() => resolve('still waiting'), 25)),
    ])

    expect(result).toEqual({ mode: 'pagedjs', pageCount: 2, warnings: [] })
  })

  it('waits for font and image completion before pagination', async () => {
    const events: string[] = []
    let complete = false
    const image = {
      get complete() { return complete },
      addEventListener: (name: string, listener: () => void) => {
        events.push(name)
        complete = true
        listener()
      },
      removeEventListener: () => undefined,
    }
    const document = {
      fonts: { ready: Promise.resolve().then(() => { events.push('fonts') }) },
      querySelectorAll: () => [image],
    } as unknown as Document

    const source = { querySelectorAll: () => [image] } as unknown as HTMLElement
    await awaitPrintResources(source, document)

    expect(events).toEqual(expect.arrayContaining(['fonts', 'load', 'error']))
  })
})
