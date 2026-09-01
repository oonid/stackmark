import { expect, test } from '@playwright/test'

// The sanitizer is a strict allowlist, so a construct that only one diagram
// type emits can be stripped without any other test noticing. Every diagram
// rendered elsewhere in this proof is the same two-node flowchart, so these
// exercise the four types that were otherwise never rendered at all.
const fence = (source: string) => ['```mermaid', source, '```'].join('\n')

interface DiagramCase {
  type: string
  source: string
  /** Labels the reader must still be able to read after sanitizing. */
  labels: string[]
  /** Whether the diagram draws arrowheads, which live in <marker> defs. */
  arrows: boolean
}

const diagrams: DiagramCase[] = [
  {
    type: 'flowchart',
    source: 'flowchart TD\n  Alpha --> Beta',
    labels: ['Alpha', 'Beta'],
    arrows: true,
  },
  {
    type: 'sequence',
    source: 'sequenceDiagram\n  Alice->>Bob: Ping\n  Bob-->>Alice: Pong',
    labels: ['Alice', 'Bob', 'Ping', 'Pong'],
    arrows: true,
  },
  {
    type: 'class',
    source: 'classDiagram\n  class Ledger {\n    +append()\n  }\n  Ledger <|-- Journal',
    labels: ['Ledger', 'Journal', 'append'],
    arrows: true,
  },
  {
    type: 'state',
    source: 'stateDiagram-v2\n  [*] --> Draft\n  Draft --> Published',
    labels: ['Draft', 'Published'],
    arrows: true,
  },
  {
    type: 'entity relationship',
    source: 'erDiagram\n  AUTHOR ||--o{ DOCUMENT : writes',
    labels: ['AUTHOR', 'DOCUMENT', 'writes'],
    arrows: false,
  },
]

for (const diagram of diagrams) {
  test(`renders a ${diagram.type} diagram as readable sanitized SVG`, async ({ page }) => {
    await page.goto('/')
    await page.getByTestId('markdown-source').fill(fence(diagram.source))

    const svg = page.getByTestId('mermaid-static').locator('svg')
    await expect(svg).toBeVisible({ timeout: 15_000 })
    // The preview is debounced and the sandbox renders asynchronously, so wait
    // for this diagram's own content instead of measuring the previous one.
    await expect(svg).toContainText(diagram.labels[0], { timeout: 15_000 })

    const rendered = await svg.evaluate((element) => {
      const box = (element as unknown as SVGSVGElement).viewBox.baseVal
      return {
        // Only text that is actually painted counts. textContent would also
        // include text left behind when a sanitizer drops a <text> node, and a
        // <tspan> orphaned from its <text> parent occupies no space at all, so
        // both are measured out by requiring a non-empty box.
        text: Array.from(element.querySelectorAll('text'))
          .filter((node) => {
            const box = node.getBoundingClientRect()
            return box.width > 0 && box.height > 0
          })
          .map((node) => node.textContent ?? '')
          .join(' ')
          .replace(/\s+/g, ' ')
          .trim(),
        viewBox: { width: box.width, height: box.height },
        shapes: element.querySelectorAll('path, rect, circle, ellipse, polygon, line').length,
        markers: element.querySelectorAll('marker').length,
        // Active or externally loaded content must not survive.
        scripts: element.querySelectorAll('script, foreignObject, image, use').length,
        externalRefs: Array.from(element.querySelectorAll('*')).some((node) =>
          Array.from(node.attributes).some((attribute) =>
            /^(https?:)?\/\//i.test(attribute.value) || /url\(\s*['"]?(?!#)/i.test(attribute.value))),
      }
    })

    // The labels are the whole point of a diagram: if the sanitizer drops the
    // text nodes, the picture is meaningless even though it still renders.
    for (const label of diagram.labels) {
      expect(rendered.text, `${diagram.type} should still show "${label}"`).toContain(label)
    }

    expect(rendered.shapes, 'diagram geometry survives').toBeGreaterThan(0)
    if (diagram.arrows) {
      expect(rendered.markers, 'arrowhead markers survive in defs').toBeGreaterThan(0)
    }
    // A viewBox that does not enclose the drawing renders a clipped or
    // invisible diagram, which is how the hidden-iframe defect showed up.
    expect(rendered.viewBox.width).toBeGreaterThan(0)
    expect(rendered.viewBox.height).toBeGreaterThan(0)

    expect(rendered.scripts, 'no active or externally loaded SVG content').toBe(0)
    expect(rendered.externalRefs, 'no external URL references').toBe(false)
  })
}
