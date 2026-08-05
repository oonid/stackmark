export const NATIVE_PAGE_RULE_ATTRIBUTE = 'data-stackedit-native-page'

/**
 * Returns the top-level `@page` block's geometry declarations, or null when the
 * stylesheet declares none.
 *
 * Nested margin boxes (`@top-center` and friends) are dropped: no browser
 * implements them natively, only a paged-media polyfill consumes them, and
 * jsdom throws when asked to compute styles against them.
 */
export function extractPageRule(cssText: string): string | null {
  const opening = /@page\b[^{]*\{/.exec(cssText)
  if (!opening) return null

  let depth = 1
  const declarations: string[] = []
  // Text seen since the last `;` — either a declaration, or the prelude of a
  // nested at-rule, which is only known once `{` or `;` arrives.
  let pending = ''

  for (let index = opening.index + opening[0].length; index < cssText.length; index += 1) {
    const character = cssText[index]

    if (character === '{') {
      depth += 1
      if (depth === 2) pending = '' // discard the nested at-rule's prelude
      continue
    }

    if (character === '}') {
      depth -= 1
      if (depth === 0) {
        if (pending.trim()) declarations.push(pending.trim())
        return `@page {\n  ${declarations.join('\n  ')}\n}`
      }
      continue
    }

    if (depth !== 1) continue

    if (character === ';') {
      if (pending.trim()) declarations.push(`${pending.trim()};`)
      pending = ''
      continue
    }

    pending += character
  }
  return null
}

/**
 * Re-declares the print stylesheet's `@page` rule as the last one in the
 * document.
 *
 * Paged.js appends its own base stylesheet — which carries
 * `@page { size: letter; margin: 0 }` — to the head during `polisher.setup()`.
 * That lands after the application's print stylesheet and therefore wins the
 * cascade, so the native print path silently becomes Letter. Re-appending the
 * real rule afterwards restores it without duplicating the geometry anywhere.
 */
export function installNativePageRule(cssText: string, doc: Document): void {
  const rule = extractPageRule(cssText)
  if (!rule) return

  doc.head.querySelectorAll(`style[${NATIVE_PAGE_RULE_ATTRIBUTE}]`).forEach((node) => node.remove())
  const style = doc.createElement('style')
  style.setAttribute(NATIVE_PAGE_RULE_ATTRIBUTE, '')
  style.textContent = rule
  doc.head.appendChild(style)
}
