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
  expect(await frameElement.evaluate((element) => (element as HTMLIFrameElement).contentDocument)).toBeNull()
  expect(await frame!.evaluate(() => {
    try {
      void window.parent.document
      return false
    } catch {
      return true
    }
  })).toBe(true)

  const diagram = page.getByTestId('mermaid-static').locator('svg')
  await expect(diagram).toBeVisible()
  const svg = await diagram.evaluate((element) => element.outerHTML)
  const geometry = await diagram.evaluate((element) => {
    const viewBox = element.viewBox.baseVal
    const content = element.getBBox()
    return {
      viewBox: { x: viewBox.x, y: viewBox.y, width: viewBox.width, height: viewBox.height },
      content: { x: content.x, y: content.y, width: content.width, height: content.height },
    }
  })
  expect(svg).not.toMatch(/<script|foreignObject|\son\w+=|javascript:|(?:href|src)=["']https?:|url\(\s*https?:|@import/i)
  expect(svg).toContain('role="img"')
  expect(geometry.content.x).toBeGreaterThanOrEqual(geometry.viewBox.x)
  expect(geometry.content.y).toBeGreaterThanOrEqual(geometry.viewBox.y)
  expect(geometry.content.x + geometry.content.width).toBeLessThanOrEqual(geometry.viewBox.x + geometry.viewBox.width)
  expect(geometry.content.y + geometry.content.height).toBeLessThanOrEqual(geometry.viewBox.y + geometry.viewBox.height)
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

test('rejects CSS-escaped external URLs before SVG enters the parent document', async ({ page }) => {
  const offOriginRequests: string[] = []
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (url.origin !== 'http://127.0.0.1:1420') offOriginRequests.push(request.url())
  })
  await page.goto('/')

  const sanitized = await page.evaluate(async () => {
    const modulePath = '/@fs/workspace/packages/markdown/src/mermaid/svg-sanitizer.ts'
    const sanitizer = await import(/* @vite-ignore */ modulePath) as {
      sanitizeMermaidSvg: (source: string) => string
    }
    const host = document.createElement('div')
    host.innerHTML = sanitizer.sanitizeMermaidSvg(String.raw`
      <svg viewBox="0 0 10 10">
        <style>.node { fill: u\\72l(https://attacker.invalid/style.svg); }</style>
        <path fill="u\\72l(https://attacker.invalid/paint.svg)" d="M0 0L1 1" />
      </svg>
    `)
    document.body.append(host)
    return host.innerHTML
  })

  await page.waitForTimeout(100)
  expect(sanitized).toContain('<path')
  expect(sanitized).not.toMatch(/<style|attacker\.invalid|u\\72l/i)
  expect(offOriginRequests).toEqual([])
})

test('renders from an opaque external sandbox document under the restrictive Tauri parent CSP', async ({ page }) => {
  const rendererDocument = await page.request.get(
    'http://127.0.0.1:1420/generated/mermaid-renderer.html',
  )
  const rendererHtml = await rendererDocument.text()
  const nonce = rendererHtml.match(/script-src 'nonce-([^']+)'/)?.[1]
  expect(nonce).toBeTruthy()
  expect(rendererHtml).toContain(`<script nonce="${nonce}" src="/generated/mermaid-renderer.iife.js"`)

  await page.route('**/', async (route) => {
    const response = await route.fetch()
    await route.fulfill({
      response,
      headers: {
        ...response.headers(),
        'content-security-policy': "default-src 'self' customprotocol: asset:; connect-src ipc: http://ipc.localhost; img-src 'self' asset: http://asset.localhost data:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; frame-src 'self'; object-src 'none'",
      },
    })
  })
  await page.goto('/')

  const frameElement = page.locator('iframe[sandbox="allow-scripts"]')
  await expect(frameElement).toHaveAttribute('src', '/generated/mermaid-renderer.html')
  await expect(frameElement).not.toHaveAttribute('srcdoc', /./)
  await expect(page.getByTestId('mermaid-static').locator('svg')).toBeVisible()
  const frame = page.frames().find((candidate) => candidate !== page.mainFrame())
  expect(frame).toBeTruthy()
  expect(await frameElement.evaluate((element) => (element as HTMLIFrameElement).contentDocument)).toBeNull()
  expect(await frame!.evaluate(() => {
    try {
      void window.parent.document
      return false
    } catch {
      return true
    }
  })).toBe(true)
})
