import { describe, expect, it } from 'vitest'
import { NATIVE_PAGE_RULE_ATTRIBUTE, extractPageRule, installNativePageRule } from './native-page-rule'

const printCss = `
@page {
  size: A4 portrait;
  margin: 16mm 14mm 18mm;

  @top-center {
    content: "StackMark print proof";
    font-size: 9pt;
  }

  @bottom-center {
    content: "Page " counter(page) " of " counter(pages);
    font-size: 9pt;
  }
}

.print-proof-card {
  grid-column: 1 / -1;
}
`

describe('extractPageRule', () => {
  it('keeps the page geometry declarations', () => {
    const rule = extractPageRule(printCss)

    expect(rule).toContain('size: A4 portrait')
    expect(rule).toContain('margin: 16mm 14mm 18mm')
    // The block must close after the nested boxes, not at the first inner brace.
    expect(rule?.endsWith('}')).toBe(true)
    expect(rule).not.toContain('.print-proof-card')
  })

  it('drops nested margin boxes, which only a paged-media polyfill consumes', () => {
    // Browsers ignore @top-center/@bottom-center natively, and jsdom's CSS
    // engine throws when asked to compute styles against them.
    const rule = extractPageRule(printCss)

    expect(rule).not.toContain('@top-center')
    expect(rule).not.toContain('@bottom-center')
    expect(rule).not.toContain('counter(page)')
    expect(rule).not.toContain('StackMark print proof')
  })

  it('returns null when the stylesheet declares no page rule', () => {
    expect(extractPageRule('.print-source { color: black; }')).toBeNull()
  })
})

describe('installNativePageRule', () => {
  it('appends the page rule last so it outranks a previously injected one', () => {
    const document = new DOMParser().parseFromString('<html><head></head><body></body></html>', 'text/html')
    const pagedBase = document.createElement('style')
    pagedBase.textContent = '@page { size: letter; margin: 0; }'
    document.head.appendChild(pagedBase)

    installNativePageRule(printCss, document)

    const styles = Array.from(document.head.querySelectorAll('style'))
    expect(styles).toHaveLength(2)
    expect(styles[1].hasAttribute(NATIVE_PAGE_RULE_ATTRIBUTE)).toBe(true)
    expect(styles[1].textContent).toContain('size: A4 portrait')
  })

  it('replaces its own previous rule instead of stacking duplicates', () => {
    const document = new DOMParser().parseFromString('<html><head></head><body></body></html>', 'text/html')

    installNativePageRule(printCss, document)
    installNativePageRule(printCss, document)

    expect(document.head.querySelectorAll(`style[${NATIVE_PAGE_RULE_ATTRIBUTE}]`)).toHaveLength(1)
  })

  it('does nothing when the stylesheet declares no page rule', () => {
    const document = new DOMParser().parseFromString('<html><head></head><body></body></html>', 'text/html')

    installNativePageRule('.print-source { color: black; }', document)

    expect(document.head.querySelectorAll('style')).toHaveLength(0)
  })
})
