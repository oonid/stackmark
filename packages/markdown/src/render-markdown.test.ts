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

    expect(result.mermaidBlocks).toEqual([
      { id: 'mermaid-1', source: 'flowchart TD\n  A --> B\n' },
    ])
    expect(result.html).toContain('data-mermaid-placeholder="mermaid-1"')
    expect(result.html).not.toContain('flowchart TD')
    expect(result.html).toContain('Mermaid rendering is pending')
    expect(result.warnings).toEqual([
      { code: 'MERMAID_PENDING', message: 'Mermaid rendering is pending.' },
    ])
  })
})
