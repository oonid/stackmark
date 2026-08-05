import { describe, expect, it } from 'vitest'
import { sanitizeMermaidSvg } from './svg-sanitizer'

describe('sanitizeMermaidSvg', () => {
  it.each([
    ['flowchart', '<svg viewBox="0 0 100 40"><path d="M0 0L100 40" marker-end="url(#arrow)"/><text x="10" y="20">Flow</text><marker id="arrow"><path d="M0 0L5 2L0 4z"/></marker></svg>'],
    ['sequence', '<svg viewBox="0 0 100 40"><path d="M0 20H100" stroke-dasharray="5,5"/><text x="10" y="10">Alice</text></svg>'],
    ['class', '<svg viewBox="0 0 100 40"><rect x="1" y="1" width="98" height="38"/><text x="10" y="20">User</text></svg>'],
    ['state', '<svg viewBox="0 0 100 40"><circle cx="20" cy="20" r="10"/><path d="M30 20H90"/></svg>'],
    ['er', '<svg viewBox="0 0 100 40"><path d="M0 0V40M100 0V40"/><text x="10" y="20">CUSTOMER</text></svg>'],
  ])('keeps static %s diagram geometry and text', (_kind, source) => {
    const result = sanitizeMermaidSvg(source)

    expect(result).toContain('<svg')
    expect(result).toContain('viewBox="0 0 100 40"')
    expect(result).toMatch(/<(path|rect|circle)/)
    expect(result).toContain('role="img"')
    expect(result).toContain('width="100%"')
  })

  it('removes executable and externally loaded SVG content', () => {
    const result = sanitizeMermaidSvg(`
      <svg viewBox="0 0 10 10" onload="window.__mermaidPwned = true">
        <style>@import url(https://attacker.invalid/style.css);</style>
        <script>window.__mermaidPwned = true</script>
        <foreignObject><iframe src="https://attacker.invalid/"></iframe></foreignObject>
        <a href="https://attacker.invalid/"><text onclick="alert(1)">unsafe link</text></a>
        <image href="https://attacker.invalid/pixel.svg" />
        <path fill="url(https://attacker.invalid/paint.svg)" style="fill:url(javascript:alert(1))" d="M0 0L1 1" />
        <use href="javascript:alert(1)" />
      </svg>
    `)

    expect(result).toContain('<svg')
    expect(result).toContain('<path')
    expect(result).not.toMatch(/<script|foreignObject|onload|onclick/i)
    expect(result).not.toMatch(/https:\/\/attacker\.invalid|javascript:|<image|url\(/i)
  })

  it('removes style elements and CSS-escaped external URL values', () => {
    const result = sanitizeMermaidSvg(String.raw`
      <svg viewBox="0 0 10 10">
        <style>.node { fill: u\\72l(https://attacker.invalid/style.svg); }</style>
        <path fill="u\\72l(https://attacker.invalid/paint.svg)" d="M0 0L1 1" />
      </svg>
    `)

    expect(result).toContain('<path')
    expect(result).not.toMatch(/<style|attacker\.invalid|u\\\\72l/i)
  })

  it('keeps fragment-only marker references while rejecting all non-fragment URLs', () => {
    const result = sanitizeMermaidSvg(`
      <svg viewBox="0 0 10 10">
        <defs><marker id="arrow"><path d="M0 0L1 1" /></marker></defs>
        <path d="M0 0L10 10" marker-end="url(#arrow)" />
        <use href="data:image/svg+xml;base64,PHN2Zy8+" />
      </svg>
    `)

    expect(result).toContain('marker-end="url(#arrow)"')
    expect(result).not.toContain('data:image')
  })

  it('synthesizes a viewBox from intrinsic dimensions before making SVG responsive', () => {
    const result = sanitizeMermaidSvg('<svg width="320" height="180"><path d="M0 0L1 1" /></svg>')

    expect(result).toContain('viewBox="0 0 320 180"')
    expect(result).toContain('width="100%"')
  })
})
