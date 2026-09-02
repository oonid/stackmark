import { describe, expect, it } from 'vitest'
import { sanitizeHtml } from './sanitize-html'

describe('sanitizeHtml', () => {
  it('removes active content', () => {
    expect(sanitizeHtml('<script>alert(1)</script>')).not.toContain('alert')
    expect(sanitizeHtml('<img src="x" onerror="alert(1)">')).not.toContain('onerror')
  })

  it('keeps the inline geometry KaTeX depends on', () => {
    // KaTeX positions every glyph with inline styles; dropping the attribute
    // outright would silently break every equation in the document.
    const html = sanitizeHtml('<span style="height:1.0404em;vertical-align:-0.345em;">x</span>')
    expect(html).toContain('height:1.0404em')
    expect(html).toContain('vertical-align:-0.345em')
  })

  it('strips CSS that fetches a remote resource', () => {
    // DOMPurify does not look inside style values, so an untrusted document can
    // otherwise beacon out on render. The browser build ships no CSP at all.
    const html = sanitizeHtml('<div style="background:url(https://evil.example/beacon)">x</div>')
    expect(html).not.toContain('evil.example')
  })

  it('strips positioning that can cover the application window', () => {
    // A full-viewport fixed overlay inside the desktop shell is UI redress.
    const html = sanitizeHtml('<div style="position:fixed;top:0;left:0;width:100vw;height:100vh">x</div>')
    expect(html).not.toContain('position')
  })

  it('gives a new-tab link an opener-safe relationship', () => {
    const html = sanitizeHtml('<a href="//example.com/" target="_blank">x</a>')
    expect(html).toContain('rel="noopener noreferrer"')
  })
})
