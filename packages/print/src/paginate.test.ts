import { describe, expect, it } from 'vitest'
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

  it('selects the plain-CSS fallback when Paged.js fails or times out', async () => {
    const document = {
      fonts: { ready: Promise.resolve() },
      querySelectorAll: () => [],
    } as unknown as Document
    const target = { classList: { add: (name: string) => expect(name).toBe('pagedjs-failed') } } as unknown as HTMLElement

    const result = await paginate({
      document,
      source: {} as HTMLElement,
      target,
      timeoutMs: 1,
      preview: async () => new Promise(() => undefined),
    })

    expect(result.mode).toBe('plain-css')
    expect(result.pageCount).toBe(0)
    expect(result.warnings).toEqual([{ code: 'PAGEDJS_TIMEOUT', message: 'Paged.js pagination timed out; using plain CSS.' }])
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

    await awaitPrintResources(document)

    expect(events).toEqual(expect.arrayContaining(['fonts', 'load', 'error']))
  })
})
