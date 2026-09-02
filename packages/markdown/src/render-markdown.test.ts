import { describe, expect, it } from 'vitest'
import { renderMarkdown } from './render-markdown'

describe('renderMarkdown', () => {
  it('preserves headings, tables, and fenced code in the preview output', () => {
    const result = renderMarkdown(`# Heading

| Name | Value |
| --- | --- |
| proof | 1 |

\`\`\`ts
const proof = true
\`\`\``)

    expect(result.html).toContain('<h1>Heading</h1>')
    expect(result.html).toContain('<table>')
    expect(result.html).toContain('<code class="language-ts">')
  })

  it('renders inline KaTeX instead of leaving inline math source in the preview', () => {
    const result = renderMarkdown('Inline math: $x^2$.')

    expect(result.html).toContain('class="katex"')
    expect(result.html).not.toContain('$x^2$')
  })

  it('renders block KaTeX instead of leaving display math source in the preview', () => {
    const result = renderMarkdown('$$\n\\frac{a}{b}\n$$')

    expect(result.html).toContain('class="katex-display"')
    expect(result.html).not.toContain('\\frac{a}{b}')
  })

  it('renders paired single-line display KaTeX instead of leaving its delimiters in the preview', () => {
    const result = renderMarkdown('$$x^2$$')

    expect(result.html).toContain('class="katex-display"')
    expect(result.html).not.toContain('$$x^2$$')
  })

  it('removes scripts, event attributes, javascript URLs, and SVG from preview HTML', () => {
    const result = renderMarkdown(
      '<script>alert(1)</script><img src="x" onerror="alert(1)"><a href="javascript:alert(1)">unsafe</a><svg><circle /></svg>',
    )

    expect(result.html).not.toContain('<script')
    expect(result.html).not.toContain('onerror')
    expect(result.html).not.toContain('javascript:')
    expect(result.html).not.toContain('<svg')
  })

  it('extracts Mermaid fences without retaining their source in returned HTML', () => {
    const result = renderMarkdown('```mermaid\nflowchart TD\n  A --> B\n```')

    expect(result.mermaidBlocks).toHaveLength(1)
    expect(result.mermaidBlocks[0].id).toMatch(
      /^mermaid-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    )
    expect(result.mermaidBlocks[0].source).toBe('flowchart TD\n  A --> B\n')
    expect(result.html).toContain(`data-mermaid-placeholder="${result.mermaidBlocks[0].id}"`)
    expect(result.html).not.toContain('flowchart TD')
    expect(result.html).toContain('Mermaid rendering is pending')
    expect(result.warnings).toEqual([
      { code: 'MERMAID_PENDING', message: 'Mermaid rendering is pending.' },
    ])
  })

  it('uses an unguessable marker that cannot collide with a user-authored predictable placeholder', () => {
    const result = renderMarkdown([
      '<div data-mermaid-placeholder="mermaid-1">spoof</div>',
      '',
      '```mermaid',
      'flowchart TD',
      '  A --> B',
      '```',
    ].join('\n'))

    expect(result.mermaidBlocks).toHaveLength(1)
    expect(result.mermaidBlocks[0].id).not.toBe('mermaid-1')
    expect(result.html.match(/data-mermaid-placeholder=/g)).toHaveLength(2)
  })
})

describe('inline math boundaries', () => {
  const rendersMath = (source: string) => renderMarkdown(source).html.includes('katex')

  it('still renders genuine inline math', () => {
    expect(rendersMath('Real math $E = mc^2$ here')).toBe(true)
    expect(rendersMath('$x$')).toBe(true)
    expect(rendersMath('A fraction $\\frac{a}{b}$.')).toBe(true)
  })

  it('leaves currency amounts alone', () => {
    // A dollar sign followed by a digit is money far more often than maths, and
    // a reader typing prices should not watch their prose turn into equations.
    expect(rendersMath('Prices: $5-$10 per unit')).toBe(false)
    expect(rendersMath('Costs $5, $10')).toBe(false)
  })

  it('leaves shell variables alone', () => {
    expect(rendersMath('Set $HOME/$USER now')).toBe(false)
  })

  it('does not swallow a link whose text contains a dollar amount', () => {
    const html = renderMarkdown('[Buy for $5](/shop)$10').html
    expect(html).toContain('href="/shop"')
    expect(html).not.toContain('katex')
  })
})

