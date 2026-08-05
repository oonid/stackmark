import { expect, test } from '@playwright/test'

test('paginates sanitized proof content and records screen-preview page metadata', async ({ page }) => {
  await page.goto('/')

  await expect(page.getByTestId('print-pagination-status')).toHaveText(/2 pages|ready/i)
  const pages = page.getByTestId('print-document').locator('.pagedjs_page')
  expect(await pages.count()).toBeGreaterThanOrEqual(2)
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
  await expect(pages.locator('.katex').first()).toBeVisible()
  await expect(pages.locator('.mermaid-static svg').first()).toBeVisible()
  await pages.first().screenshot({ path: 'test-results/print/pagedjs-page-1.png' })
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

test('prints the native plain-CSS source exactly once when screen pagination succeeds', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('print-pagination-status')).toContainText(/pages ready/i)
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
  const pdf = await page.pdf({
    path: 'test-results/print/native-print-source.pdf',
    format: 'A4',
    preferCSSPageSize: true,
    printBackground: true,
  })
  expect(pdf.subarray(0, 5).toString()).toBe('%PDF-')
  expect(pdf.byteLength).toBeGreaterThan(10_000)
  expect(pdf.toString('latin1').match(/\/Type\s*\/Page\b/g)?.length ?? 0).toBeGreaterThanOrEqual(2)
})

test('prints sanitized Mermaid with explicit light-paper colors in dark mode', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.goto('/')
  await expect(page.getByTestId('print-pagination-status')).toContainText(/pages ready/i)
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
