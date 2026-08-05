import { expect, test } from '@playwright/test'

test('paginates sanitized proof content and records deterministic review pages', async ({ page }) => {
  await page.goto('/')

  await expect(page.getByTestId('print-pagination-status')).toHaveText(/2 pages|ready/i)
  const pages = page.getByTestId('print-document').locator('.pagedjs_page')
  expect(await pages.count()).toBeGreaterThanOrEqual(2)
  expect(await pages.evaluateAll((elements) => elements.map((element) => Number(element.getAttribute('data-page-number')))))
    .toEqual(Array.from({ length: await pages.count() }, (_, index) => index + 1))
  const overflowingPages = await pages.evaluateAll((elements) => elements.flatMap((element, index) => {
    const content = element.querySelector<HTMLElement>('.pagedjs_page_content')
    if (!content) return [{ index: index + 1, reason: 'missing page content' }]
    const pageBox = content.getBoundingClientRect()
    const overflowedChildren = Array.from(content.querySelectorAll<HTMLElement>('h1, h2, h3, p, table, pre, img, svg, .katex')).flatMap((child) => {
      const box = child.getBoundingClientRect()
      if (box.left >= pageBox.left - 1 && box.right <= pageBox.right + 1 && box.top >= pageBox.top - 1 && box.bottom <= pageBox.bottom + 1) return []
      return [{ tag: child.tagName, className: child.className, left: box.left, right: box.right, top: box.top, bottom: box.bottom }]
    })
    if (overflowedChildren.length === 0) return []
    return [{
      index: index + 1,
      scrollWidth: content.scrollWidth,
      clientWidth: content.clientWidth,
      scrollHeight: content.scrollHeight,
      clientHeight: content.clientHeight,
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
})
