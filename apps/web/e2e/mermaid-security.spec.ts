import { expect, test } from '@playwright/test'

test('renders Mermaid as inert sanitized SVG in an opaque sandbox', async ({ page }) => {
  const offOriginRequests: string[] = []
  const dialogs: string[] = []
  let popupCount = 0

  page.on('request', (request) => {
    const url = new URL(request.url())
    if (url.origin !== 'http://127.0.0.1:1420') offOriginRequests.push(request.url())
  })
  page.on('dialog', async (dialog) => {
    dialogs.push(dialog.message())
    await dialog.dismiss()
  })
  page.on('popup', () => { popupCount += 1 })

  await page.addInitScript(() => {
    Object.defineProperty(window, '__mermaidSentinel', { value: 'safe', writable: true })
  })
  await page.goto('/')

  const frameElement = page.locator('iframe[sandbox="allow-scripts"]')
  await expect(frameElement).toHaveCount(1)
  expect(await frameElement.getAttribute('sandbox')).toBe('allow-scripts')

  const frame = page.frames().find((candidate) => candidate !== page.mainFrame())
  expect(frame).toBeTruthy()
  expect(await frame!.evaluate(() => location.origin)).toBe('null')

  const diagram = page.getByTestId('mermaid-static').locator('svg')
  await expect(diagram).toBeVisible()
  const svg = await diagram.evaluate((element) => element.outerHTML)
  expect(svg).not.toMatch(/<script|foreignObject|\son\w+=|javascript:|(?:href|src)=["']https?:|url\(\s*https?:|@import/i)
  expect(svg).toContain('role="img"')
  expect(await page.evaluate(() => (window as Window & { __mermaidSentinel?: string }).__mermaidSentinel)).toBe('safe')
  expect(offOriginRequests).toEqual([])
  expect(dialogs).toEqual([])
  expect(popupCount).toBe(0)
  expect(new URL(page.url()).origin).toBe('http://127.0.0.1:1420')
})

test('contains malicious and malformed Mermaid failures to the diagram block', async ({ page }) => {
  await page.goto('/')
  const source = page.getByTestId('markdown-source')

  await source.fill(`\`\`\`mermaid
flowchart TD
  A["<img src=x onerror=alert(1)>"] --> B
  click A "https://attacker.invalid/"
\`\`\``)
  await expect(page.getByTestId('mermaid-static').locator('svg')).toBeVisible()
  const svg = await page.getByTestId('mermaid-static').locator('svg').evaluate((element) => element.outerHTML)
  expect(svg).not.toMatch(/onerror|javascript:|https:\/\/attacker\.invalid|<image|foreignObject/i)

  await source.fill('```mermaid\nthis is not valid mermaid syntax !!!\n```')
  await expect(page.getByTestId('mermaid-static').getByRole('status')).toContainText(/syntax|parse|mermaid/i)
  await expect(source).toHaveValue(/not valid mermaid/)
  await expect(page.getByTestId('stage-zero-title')).toBeVisible()
})
