import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/** Reads a stylesheet with comments stripped, so prose about a rule is not mistaken for the rule. */
const read = (name: string) => readFileSync(fileURLToPath(new URL(name, import.meta.url)), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')

describe('print stylesheet boundary', () => {
  const documentCss = read('./print-document.css')

  it('gives the document stylesheet the page geometry Paged.js needs', () => {
    expect(documentCss).toContain('@page')
    expect(documentCss).toContain('size: A4 portrait')
    expect(documentCss).toContain('.stackedit-print-document')
  })

  it('keeps app-shell rules out of the stylesheet handed to Paged.js', () => {
    // Paged.js's print-media handler strips the @media print wrapper and appends
    // those rules to the main list, so they apply unconditionally. An app-shell
    // rule such as `.pagination-staging { display: none }` would then hide the
    // very subtree being laid out, and Paged.js crashes on a null offsetParent.
    expect(documentCss).not.toContain('@media print')
    expect(documentCss).not.toContain('pagination-staging')
    expect(documentCss).not.toContain('proof-grid')
    expect(documentCss).not.toContain('proof-shell')
    expect(documentCss).not.toContain('paged-output')
  })

  it('keeps the shell stylesheet free of page geometry so it has one owner', () => {
    const shellCss = read('./print-shell.css')

    expect(shellCss).toContain('pagination-staging')
    expect(shellCss).toContain('@media print')
    expect(shellCss).not.toContain('@page')
  })
})
