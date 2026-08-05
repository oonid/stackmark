import DOMPurify from 'dompurify'

const forbiddenTags = [
  'animate',
  'animateMotion',
  'animateTransform',
  'audio',
  'embed',
  'foreignObject',
  'iframe',
  'image',
  'object',
  'script',
  'set',
  'style',
  'video',
]

const fragmentUrlAttributes = new Set([
  'clip-path',
  'fill',
  'filter',
  'marker-end',
  'marker-mid',
  'marker-start',
  'mask',
  'stroke',
])

const directUrlAttributes = new Set(['href', 'src', 'xlink:href'])

export function sanitizeMermaidSvg(svg: string): string {
  const sanitized = DOMPurify.sanitize(svg, {
    USE_PROFILES: { svg: true, svgFilters: true },
    FORBID_TAGS: forbiddenTags,
    FORBID_ATTR: ['style'],
  })
  const template = document.createElement('template')
  template.innerHTML = sanitized

  const root = template.content.querySelector('svg')
  if (!root) return ''

  root.querySelectorAll(forbiddenTags.join(',')).forEach((node) => node.remove())
  const elements = [root, ...root.querySelectorAll('*')]
  elements.forEach((element) => {
    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLowerCase()
      const value = attribute.value.trim()

      if (name.startsWith('on') || name === 'style') {
        element.removeAttribute(attribute.name)
        continue
      }

      if (directUrlAttributes.has(name) && !isFragment(value)) {
        element.removeAttribute(attribute.name)
        continue
      }

      if (fragmentUrlAttributes.has(name)) {
        if (isFragmentUrl(value)) continue
        if (/\\|\/\*|\*\/|(?:^|[^\w-])url|(?:https?|data|blob|file):|\/\//i.test(value)) {
          element.removeAttribute(attribute.name)
        }
      }
    }
  })

  const intrinsicWidth = positiveNumber(root.getAttribute('width'))
  const intrinsicHeight = positiveNumber(root.getAttribute('height'))
  if (!root.hasAttribute('viewBox')) {
    root.setAttribute('viewBox', `0 0 ${intrinsicWidth} ${intrinsicHeight}`)
  }
  root.setAttribute('role', 'img')
  root.setAttribute('width', '100%')

  return root.outerHTML
}

function isFragment(value: string): boolean {
  return /^#[A-Za-z][\w:.-]*$/.test(value)
}

function isFragmentUrl(value: string): boolean {
  return /^url\(\s*#[A-Za-z][\w:.-]*\s*\)$/i.test(value)
}

function positiveNumber(value: string | null): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 100
}
