import { expect, test } from '@playwright/test'

test('paginates sanitized proof content and records screen-preview page metadata', async ({ page }) => {
  await page.setViewportSize({ width: 1180, height: 820 })
  await page.goto('/')

  await expect(page.getByTestId('print-pagination-status')).toHaveText(/2 pages|ready/i)
  const pages = page.getByTestId('print-document').locator('.pagedjs_page')
  const visibleTextLengths = await pages.evaluateAll((elements) => elements.map((element) => {
    const content = element.querySelector<HTMLElement>('.pagedjs_page_content')
    const text = content?.innerText.replace(/\s+/g, ' ').trim() ?? ''
    return text.length
  }))
  await expect(pages).toHaveCount(2)
  expect(visibleTextLengths.every((length) => length >= 100)).toBe(true)
  expect(await pages.evaluateAll((elements) => elements.map((element) => Number(element.getAttribute('data-preview-page-number')))))
    .toEqual(Array.from({ length: await pages.count() }, (_, index) => index + 1))
  const overflowingPages = await pages.evaluateAll((elements) => elements.flatMap((element, index) => {
    const content = element.querySelector<HTMLElement>('.pagedjs_page_content')
    if (!content) return [{ index: index + 1, reason: 'missing page content' }]
    const pageBox = content.getBoundingClientRect()
    const overflowedChildren = Array.from(content.querySelectorAll<HTMLElement>('h1, h2, h3, p, table, pre, img, svg, .katex')).flatMap((child) => {
      const box = child.getBoundingClientRect()
      const style = getComputedStyle(child)
      const intersectsPage = box.width > 0
        && box.height > 0
        && style.visibility !== 'hidden'
        && box.right > pageBox.left
        && box.left < pageBox.right
        && box.bottom > pageBox.top
        && box.top < pageBox.bottom
      if (!intersectsPage) return []
      if (box.left >= pageBox.left - 1 && box.right <= pageBox.right + 1 && box.top >= pageBox.top - 1 && box.bottom <= pageBox.bottom + 1) return []
      return [{
        tag: child.tagName,
        className: child.className,
        text: child.textContent?.slice(0, 80),
        left: box.left,
        right: box.right,
        top: box.top,
        bottom: box.bottom,
        width: style.width,
        marginLeft: style.marginLeft,
        marginRight: style.marginRight,
        paddingLeft: style.paddingLeft,
        paddingRight: style.paddingRight,
        position: style.position,
        visibility: style.visibility,
      }]
    })
    if (overflowedChildren.length === 0) return []
    return [{
      index: index + 1,
      scrollWidth: content.scrollWidth,
      clientWidth: content.clientWidth,
      scrollHeight: content.scrollHeight,
      clientHeight: content.clientHeight,
      pageBox: {
        left: pageBox.left,
        right: pageBox.right,
        top: pageBox.top,
        bottom: pageBox.bottom,
      },
      overflowedChildren: overflowedChildren.slice(0, 3),
    }]
  }))
  expect(overflowingPages).toEqual([])
  const previewContainment = await page.getByTestId('print-document').evaluate((documentElement) => {
    const card = documentElement.closest<HTMLElement>('.print-proof-card')!
    const output = documentElement.querySelector<HTMLElement>(':scope > .paged-output')!
    const page = documentElement.querySelector<HTMLElement>('.pagedjs_page')!
    const cardBox = card.getBoundingClientRect()
    const pageBox = page.getBoundingClientRect()
    return {
      cardLeft: cardBox.left,
      cardRight: cardBox.right,
      pageLeft: pageBox.left,
      pageRight: pageBox.right,
      overflowX: getComputedStyle(output).overflowX,
    }
  })
  expect(previewContainment.pageLeft).toBeGreaterThanOrEqual(previewContainment.cardLeft)
  expect(previewContainment.pageRight).toBeLessThanOrEqual(previewContainment.cardRight)
  expect(previewContainment.overflowX).toBe('auto')
  await expect(pages.locator('.katex').first()).toBeVisible()
  const pagedDiagram = pages.locator('.mermaid-static img[alt="Mermaid diagram"]').first()
  await expect(pagedDiagram).toBeVisible()
  await expect(pagedDiagram).toHaveAttribute('src', /^data:image\/svg\+xml/)
  await pages.first().screenshot({ path: 'test-results/print/pagedjs-page-1.png' })
})

test('renders screen preview pages at the stylesheet A4 geometry with generated margin boxes', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('print-pagination-status')).toContainText(/pages ready/i)

  const geometry = await page.getByTestId('print-document').evaluate((documentElement) => {
    const generatedContent = (root: HTMLElement, selector: string) => {
      const element = root.querySelector<HTMLElement>(selector)
      if (!element) return ''
      return getComputedStyle(element, '::after').content.replace(/^"|"$/g, '').trim()
    }

    // Measure a millimetre reference in the live document rather than assuming 96dpi.
    const probe = document.createElement('div')
    probe.style.cssText = 'position:absolute;top:0;left:0;width:210mm;height:297mm;visibility:hidden;pointer-events:none'
    document.body.appendChild(probe)
    const a4 = probe.getBoundingClientRect()
    const millimetre = a4.width / 210
    probe.remove()

    const sheet = documentElement.querySelector<HTMLElement>('.pagedjs_sheet')!
    const content = documentElement.querySelector<HTMLElement>('.pagedjs_page_content')!
    const sheetBox = sheet.getBoundingClientRect()
    const contentBox = content.getBoundingClientRect()

    return {
      sheetWidthMm: sheetBox.width / millimetre,
      sheetHeightMm: sheetBox.height / millimetre,
      contentWidthMm: contentBox.width / millimetre,
      contentHeightMm: contentBox.height / millimetre,
      // Paged.js emits margin-box text as generated ::after content, so it is
      // never present in textContent.
      runningTitle: generatedContent(documentElement, '.pagedjs_margin-top-center .pagedjs_margin-content'),
      pageCounter: generatedContent(documentElement, '.pagedjs_margin-bottom-center .pagedjs_margin-content'),
    }
  })

  // A4 portrait, per the @page rule in packages/print/src/print-document.css.
  expect(geometry.sheetWidthMm).toBeCloseTo(210, 0)
  expect(geometry.sheetHeightMm).toBeCloseTo(297, 0)
  // A4 minus the configured 16mm/14mm/18mm margins.
  expect(geometry.contentWidthMm).toBeCloseTo(182, 0)
  expect(geometry.contentHeightMm).toBeCloseTo(263, 0)
  // Generated margin boxes from the same @page rule. Before the stylesheet was
  // handed to Paged.js these boxes were not generated at all.
  expect(geometry.runningTitle).toBe('StackEdit print proof')
  // Computed style keeps counter() unresolved, so assert the rule reached the
  // margin box rather than trying to read the rendered number.
  expect(geometry.pageCounter).toMatch(/counter\(page\)/)
  expect(geometry.pageCounter).toMatch(/counter\(pages\)/)
})

test('carries every sentence of the source into the paged preview', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('print-pagination-status')).toContainText(/pages ready/i)

  const paged = await page.getByTestId('print-document').evaluate((root) =>
    Array.from(root.querySelectorAll<HTMLElement>('.pagedjs_page .pagedjs_page_content'))
      .map((element) => element.innerText)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim())

  // A break must split text, never discard it. Losing a break token silently
  // drops the content it pointed at, which a page-count assertion cannot see.
  const required = [
    'This source document seeds the shared Stage 0 editor shell with inline math',
    'The print proof deliberately repeats ordinary editorial prose so the browser must create multiple A4 pages.',
    'This sentence is representative of the Markdown content a StackEdit author can review before opening the print dialog.',
    'Documentation is rarely a single screen.',
    'When a page is nearly full, a heading should travel with the content that follows it.',
    'The same policy applies to long-form notes.',
    'An author might describe an experiment, explain its constraints, and include a table of findings.',
    'Reliable fallback behavior matters as much as the happy path.',
    'This paragraph supplies further continuous prose for the page-flow check.',
    'The local application bundle contains the fonts required by the mathematical expression below, so a disconnected review remains representative of the desktop target.',
    'The diagram below is rendered in the opaque Mermaid iframe and then passed only as separately sanitized static SVG.',
  ]
  const missing = required.filter((sentence) => !paged.includes(sentence))
  expect(missing).toEqual([])
})

test('keeps application shell chrome out of the rebuilt page ancestors', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('print-pagination-status')).toContainText(/pages ready/i)

  // Paged.js rebuilds a broken node's ancestor chain onto each new page. Those
  // rebuilt wrappers must not contribute the app shell's screen chrome, or they
  // consume page space and force extra breaks.
  const chrome = await page.getByTestId('print-document').evaluate((root) =>
    Array.from(root.querySelectorAll<HTMLElement>('.pagedjs_page_content .proof-card, .pagedjs_page_content .proof-shell, .pagedjs_page_content .proof-grid'))
      .map((element) => {
        const style = getComputedStyle(element)
        return {
          tag: element.tagName,
          minHeight: style.minHeight,
          padding: style.padding,
          borderTopWidth: style.borderTopWidth,
          rowGap: style.rowGap,
        }
      })
      .filter((entry) =>
        entry.minHeight !== '0px'
        || entry.padding !== '0px'
        || entry.borderTopWidth !== '0px'
        || (entry.rowGap !== 'normal' && entry.rowGap !== '0px'),
      ))

  expect(chrome).toEqual([])
})

test('falls back to printable plain CSS when pagination is forced to fail', async ({ page }) => {
  await page.goto('/?printFallback=1')

  await expect(page.getByTestId('print-document')).toHaveClass(/pagedjs-failed/)
  await expect(page.getByTestId('print-pagination-status')).toContainText(/plain CSS/i)
  await page.getByTestId('print-document').screenshot({ path: 'test-results/print/plain-css-fallback.png' })
  await page.emulateMedia({ media: 'print' })
  await expect(page.getByTestId('print-document').locator(':scope > .print-source')).toBeVisible()
  await expect(page.getByTestId('print-document').locator(':scope > .paged-output')).toBeHidden()
})

test('prints the native plain-CSS source exactly once at A4, whichever preview mode settles', async ({ page }) => {
  await page.goto('/')
  // The native print path is authoritative and must not depend on Paged.js
  // succeeding, so this gate accepts either settled preview mode.
  await expect(page.getByTestId('print-pagination-status')).toContainText(/pages ready|plain CSS/i)
  await page.emulateMedia({ media: 'print' })

  const printDocument = page.locator('#app > .proof-shell > .proof-grid > .print-proof-card > [data-testid="print-document"]')
  const printCard = page.locator('#app > .proof-shell > .proof-grid > .print-proof-card')
  const source = printDocument.locator(':scope > .print-source')
  const output = printDocument.locator(':scope > .paged-output')
  await expect(printDocument).toBeVisible()
  await expect(printCard.locator(':scope > #print-proof-heading')).toBeHidden()
  await expect(printCard.locator(':scope > [data-testid="print-pagination-status"]')).toBeHidden()
  expect(await page.locator('#app > .proof-shell').evaluate((shell) => ({
    padding: getComputedStyle(shell).padding,
    width: getComputedStyle(shell).width,
  }))).toEqual({ padding: '0px', width: '1280px' })
  expect(await page.locator('#app > .proof-shell > .proof-grid').evaluate((grid) => getComputedStyle(grid).display))
    .toBe('block')
  await expect(source).toHaveCount(1)
  await expect(source).toBeVisible()
  await expect(output).toBeHidden()
  // No `format` here on purpose: the page size must come from the document's own
  // @page rule, otherwise this gate cannot prove A4 correctness.
  const pdf = await page.pdf({
    path: 'test-results/print/native-print-source.pdf',
    preferCSSPageSize: true,
    printBackground: true,
  })
  expect(pdf.subarray(0, 5).toString()).toBe('%PDF-')
  expect(pdf.byteLength).toBeGreaterThan(10_000)
  expect(pdf.toString('latin1').match(/\/Type\s*\/Page\b/g)?.length ?? 0).toBe(2)

  const mediaBox = pdf.toString('latin1').match(/\/MediaBox\s*\[\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\]/)
  expect(mediaBox, 'PDF declares a MediaBox').not.toBeNull()
  const widthPt = Number(mediaBox![3]) - Number(mediaBox![1])
  const heightPt = Number(mediaBox![4]) - Number(mediaBox![2])
  // A4 portrait in PostScript points: 210mm x 297mm.
  expect(widthPt).toBeCloseTo(595.28, 0)
  expect(heightPt).toBeCloseTo(841.89, 0)
})

test('prints sanitized Mermaid with explicit light-paper colors in dark mode', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.goto('/')
  // Asserts on the native print source, which does not depend on Paged.js,
  // so either settled preview mode is acceptable here.
  await expect(page.getByTestId('print-pagination-status')).toContainText(/pages ready|plain CSS/i)
  await page.emulateMedia({ colorScheme: 'dark', media: 'print' })

  const printSource = page
    .getByTestId('print-document')
    .locator(':scope > .print-source')
  const node = printSource.locator('.mermaid-static .node rect').first()
  const edge = printSource.locator('.mermaid-static .flowchart-link').first()
  const arrow = printSource.locator('.mermaid-static marker path').first()

  await expect(node).toBeVisible()
  expect(await node.evaluate((element) => {
    const style = getComputedStyle(element)
    return { fill: style.fill, stroke: style.stroke }
  })).toEqual({ fill: 'rgb(248, 250, 252)', stroke: 'rgb(71, 85, 105)' })
  expect(await edge.evaluate((element) => getComputedStyle(element).stroke))
    .toBe('rgb(71, 85, 105)')
  expect(await arrow.evaluate((element) => getComputedStyle(element).fill))
    .toBe('rgb(71, 85, 105)')
})

test('keeps the simple Mermaid proof centered within a readable print width', async ({ page }) => {
  await page.goto('/')
  // Asserts on the native print source, which does not depend on Paged.js,
  // so either settled preview mode is acceptable here.
  await expect(page.getByTestId('print-pagination-status')).toContainText(/pages ready|plain CSS/i)
  await page.emulateMedia({ media: 'print' })

  const diagram = page
    .getByTestId('print-document')
    .locator(':scope > .print-source .mermaid-static svg')
    .first()
  await expect(diagram).toBeVisible()
  const layout = await diagram.evaluate((element) => {
    const box = element.getBoundingClientRect()
    const parent = element.parentElement!.getBoundingClientRect()
    const viewBoxWidth = element.viewBox.baseVal.width
    return {
      width: box.width,
      expectedNaturalWidth: Math.min(viewBoxWidth, parent.width),
      centeredWithinOnePixel: Math.abs(box.left - (parent.left + (parent.width - box.width) / 2)) <= 1,
    }
  })

  expect(layout.expectedNaturalWidth).toBeGreaterThan(0)
  expect(layout.width).toBeCloseTo(layout.expectedNaturalWidth, 0)
  expect(layout.centeredWithinOnePixel).toBe(true)
})
