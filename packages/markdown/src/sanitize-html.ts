import DOMPurify from 'dompurify'

const allowedTags = [
  'a', 'b', 'blockquote', 'br', 'code', 'del', 'div', 'em', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'i', 'img', 'kbd', 'li', 'ol', 'p', 'pre', 's', 'span', 'strong', 'sub', 'sup', 'table', 'tbody', 'td', 'th', 'thead', 'tr', 'ul',
]

const allowedAttributes = [
  'alt', 'aria-label', 'class', 'colspan', 'data-mermaid-placeholder', 'href', 'id', 'role', 'rowspan', 'src', 'style', 'target', 'title',
]

/**
 * CSS properties a declaration may not use.
 *
 * DOMPurify does not inspect the inside of a `style` value, and the attribute
 * cannot simply be dropped: KaTeX positions every glyph with inline geometry,
 * so removing it would break every equation. These are the two shapes that
 * matter — a value that fetches a remote resource, which beacons out of an
 * untrusted document, and positioning that can float content over the rest of
 * the application.
 */
const forbiddenStyleProperties = new Set(['position', 'behavior', '-moz-binding'])
const remoteValuePattern = /url\s*\(|expression\s*\(|@import/i

function sanitizeStyleValue(style: string): string {
  return style
    .split(';')
    .filter((declaration) => {
      const [property] = declaration.split(':')
      if (property === undefined) return false
      if (forbiddenStyleProperties.has(property.trim().toLowerCase())) return false
      return !remoteValuePattern.test(declaration)
    })
    .map((declaration) => declaration.trim())
    .filter((declaration) => declaration.length > 0)
    .join('; ')
}

export function sanitizeHtml(html: string): string {
  DOMPurify.addHook('afterSanitizeAttributes', hardenAttributes)
  try {
    return DOMPurify.sanitize(html, {
      ALLOWED_TAGS: allowedTags,
      ALLOWED_ATTR: allowedAttributes,
      ALLOW_DATA_ATTR: false,
      ALLOW_ARIA_ATTR: false,
      FORBID_TAGS: ['svg'],
    })
  } finally {
    DOMPurify.removeHook('afterSanitizeAttributes')
  }
}

function hardenAttributes(node: Element): void {
  if (!('getAttribute' in node)) return

  const style = node.getAttribute('style')
  if (style !== null) {
    const safe = sanitizeStyleValue(style)
    if (safe.length === 0) node.removeAttribute('style')
    else node.setAttribute('style', safe)
  }

  // A link that opens a new context must not hand it a usable `opener`.
  if (node.tagName === 'A' && node.getAttribute('target') !== null) {
    node.setAttribute('rel', 'noopener noreferrer')
  }
}
