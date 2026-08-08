import { describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_PRINT_SETTINGS,
  awaitPrintResources,
  findDroppedText,
  findPagesHidingContent,
  findPagesHidingContentWhenSettled,
  worstHiddenOverflow,
  paginate,
  printPolicy,
} from './paginate'

describe('findDroppedText', () => {
  const long = (text: string) => text.repeat(4)

  it('reports nothing when the paged output carries all of the source text', () => {
    const source = long('The local application bundle contains the fonts required. ')

    expect(findDroppedText(source, `Page 1 of 2 ${source}`)).toEqual([])
  })

  it('reports the missing run when a break discards a sentence', () => {
    const kept = long('Alpha paragraph retained. ')
    const source = `${kept}Omega paragraph discarded entirely and never rendered anywhere.`

    const dropped = findDroppedText(source, kept)

    expect(dropped.length).toBeGreaterThan(0)
    expect(dropped.join('')).toContain('omega')
  })

  it('ignores whitespace differences where adjacent elements run together', () => {
    // textContent yields "KaTeXproved" for adjacent cells in one tree and
    // "KaTeX proved" in another; that is not content loss.
    const source = long('KaTeXproved Paged.js bounded fallback Mermaid static SVG ')
    const paged = source.replace(/KaTeXproved/g, 'KaTeX proved')

    expect(findDroppedText(source, paged)).toEqual([])
  })

  it('tolerates a word split across a page boundary', () => {
    const source = long('representative of the desktop target for review ')
    const split = source.replace('representative', 'representa tive')

    expect(findDroppedText(source, split)).toEqual([])
  })

  it('tolerates text duplicated into an overflow area', () => {
    const source = long('alpha beta gamma delta epsilon ')

    expect(findDroppedText(source, `${source} ${source}`)).toEqual([])
  })
})

describe('worstHiddenOverflow', () => {
  const box = { left: 0, top: 0, right: 688, bottom: 994 }

  it('is zero when every item sits inside the page box', () => {
    expect(worstHiddenOverflow(box, [
      { left: 0, top: 0, right: 688, bottom: 994 },
      { left: 10, top: 10, right: 400, bottom: 200 },
    ])).toBe(0)
  })

  it('measures content parked in a clipped column beside the page', () => {
    expect(worstHiddenOverflow(box, [{ left: 1793, top: 0, right: 2481, bottom: 994 }])).toBe(1793)
  })

  it('measures content parked to the left of the page box', () => {
    // WebKitGTK leaves the remainder of a split paragraph 90px left of the
    // visible column, where it is laid out, present in the text, and unreadable.
    expect(worstHiddenOverflow(box, [{ left: -90, top: 0, right: -778 + 688, bottom: 994 }])).toBe(90)
  })

  it('measures content that runs below the page box', () => {
    expect(worstHiddenOverflow(box, [{ left: 0, top: 0, right: 688, bottom: 1200 }])).toBe(206)
  })

  it('measures content that runs above the page box', () => {
    expect(worstHiddenOverflow(box, [{ left: 0, top: -40, right: 688, bottom: 994 }])).toBe(40)
  })
})

describe('findPagesHidingContent', () => {
  const rect = (left: number, top: number, right: number, bottom: number) => () =>
    ({ left, top, right, bottom, width: right - left, height: bottom - top, x: left, y: top, toJSON: () => ({}) }) as DOMRect

  const buildPage = (root: HTMLElement, text: string, itemRect: () => DOMRect) => {
    const page = globalThis.document.createElement('div')
    page.className = 'pagedjs_page_content'
    page.getBoundingClientRect = rect(0, 0, 688, 994)
    const item = globalThis.document.createElement('p')
    item.textContent = text
    item.getBoundingClientRect = itemRect
    page.appendChild(item)
    root.appendChild(page)
  }

  it('reports no page when all content sits inside its box', () => {
    const root = globalThis.document.createElement('div')
    buildPage(root, 'visible content', rect(0, 0, 600, 400))

    expect(findPagesHidingContent(root)).toEqual([])
  })

  it('reports the page whose content is parked outside the box', () => {
    const root = globalThis.document.createElement('div')
    buildPage(root, 'visible content', rect(0, 0, 600, 400))
    buildPage(root, 'unreadable remainder', rect(-90, 0, -90 + 688, 994))

    expect(findPagesHidingContent(root)).toEqual([2])
  })
})

describe('print policy', () => {
  it('uses typed A4 portrait defaults without accepting CSS strings', () => {
    expect(DEFAULT_PRINT_SETTINGS).toEqual({
      pageSize: 'A4',
      orientation: 'portrait',
      margins: { top: '16mm', right: '14mm', bottom: '18mm', left: '14mm' },
      runningTitle: 'StackMark print proof',
      pageCounter: 'Page {{page}} of {{pages}}',
    })
    expect(printPolicy(DEFAULT_PRINT_SETTINGS).pageClass).toBe('stackmark-print-document')
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

  it('falls back to plain CSS when pagination silently drops source content', async () => {
    // WebKitGTK reaches a break-token path that discards the content it points
    // at. The pages that survive still look plausible, so only comparing the
    // paged text against the source can catch it.
    const document = {
      fonts: { ready: Promise.resolve() },
      querySelectorAll: () => [],
    } as unknown as Document
    const source = globalThis.document.createElement('article')
    source.textContent = 'Alpha paragraph retained. Omega paragraph discarded entirely.'
    const target = globalThis.document.createElement('div')

    const result = await paginate({
      document,
      source,
      target,
      preview: async (_source, into) => {
        const page = globalThis.document.createElement('div')
        page.className = 'pagedjs_page_content'
        page.textContent = 'Alpha paragraph retained.'
        into.appendChild(page)
        return { total: 1 }
      },
    })

    expect(result.mode).toBe('plain-css')
    expect(result.warnings[0]?.code).toBe('PAGEDJS_INCOMPLETE')
    expect(result.warnings[0]?.message).toMatch(/omega|content/i)
  })

  it('keeps the Paged.js result when every source word survives', async () => {
    const document = {
      fonts: { ready: Promise.resolve() },
      querySelectorAll: () => [],
    } as unknown as Document
    const source = globalThis.document.createElement('article')
    source.textContent = 'Alpha paragraph retained. Omega paragraph retained.'
    const target = globalThis.document.createElement('div')

    const result = await paginate({
      document,
      source,
      target,
      preview: async (_source, into) => {
        const page = globalThis.document.createElement('div')
        page.className = 'pagedjs_page_content'
        page.textContent = 'Alpha paragraph retained. Omega paragraph retained.'
        into.appendChild(page)
        return { total: 2 }
      },
    })

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

describe('findPagesHidingContentWhenSettled', () => {
  const rect = (left: number, right: number) => () =>
    ({ left, top: 0, right, bottom: 100, width: right - left, height: 100, x: left, y: 0, toJSON: () => ({}) }) as DOMRect

  const build = () => {
    const root = globalThis.document.createElement('div')
    const page = globalThis.document.createElement('div')
    page.className = 'pagedjs_page_content'
    page.getBoundingClientRect = rect(0, 688)
    const item = globalThis.document.createElement('p')
    item.textContent = 'content'
    item.getBoundingClientRect = rect(0, 600)
    page.appendChild(item)
    root.appendChild(page)
    return { root, item }
  }

  const clock = () => {
    let time = 0
    return { now: () => time, advance: (ms: number) => { time += ms } }
  }

  it('catches content that only escapes once layout settles', async () => {
    // Re-parented pages measure as correct until the browser lays them out
    // again, so a verdict taken immediately after placement sees nothing.
    const { root, item } = build()
    const time = clock()
    let frames = 0
    const nextFrame = async () => {
      frames += 1
      time.advance(16)
      if (frames === 3) item.getBoundingClientRect = rect(-90, 598)
    }

    await expect(findPagesHidingContentWhenSettled(root, { nextFrame, now: time.now }))
      .resolves.toEqual([1])
  })

  it('reports nothing when the pages stay correct for the whole window', async () => {
    const { root } = build()
    const time = clock()
    const nextFrame = async () => { time.advance(16) }

    await expect(findPagesHidingContentWhenSettled(root, { nextFrame, now: time.now, deadlineMs: 200 }))
      .resolves.toEqual([])
  })
})

describe('findPagesHidingContentWhenSettled deadline', () => {
  it('gives up when frames stop arriving', async () => {
    // requestAnimationFrame does not fire in a hidden window, so a loop that
    // only checks its deadline after awaiting a frame would never settle.
    const root = globalThis.document.createElement('div')
    let time = 0
    const never = new Promise<void>(() => {})

    await expect(findPagesHidingContentWhenSettled(root, {
      nextFrame: () => never,
      now: () => time,
      afterDelay: async (ms: number) => { time += ms },
      deadlineMs: 500,
    })).resolves.toEqual([])
  })
})
