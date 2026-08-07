<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, useTemplateRef, watch } from 'vue'
import { DEFAULT_PRINT_SETTINGS, findPagesHidingContentWhenSettled, installNativePageRule, paginate } from '@stackedit/print'
import '@stackedit/print/print-document.css'
import '@stackedit/print/print-shell.css'
// The document stylesheet as text. Paged.js reads @page geometry only from the
// stylesheets it is handed, never from the live document. The shell stylesheet
// is deliberately withheld: Paged.js de-mediates @media print, which would
// apply the off-screen staging `display: none` rule to the tree it lays out.
import printDocumentCssText from '@stackedit/print/print-document.css?inline'
import type { RenderedMarkdown } from '@stackedit/markdown'

const props = defineProps<{
  rendered: RenderedMarkdown
  mermaidSvg: Readonly<Record<string, string>>
  forceFallback: boolean
}>()

const printSource = useTemplateRef('printSource')
const pagedTarget = useTemplateRef('pagedTarget')
const printDocument = useTemplateRef('printDocument')
const stagingHost = useTemplateRef('stagingHost')
const status = ref('Preparing printable document…')
const paginationState = ref<'preparing' | 'pagedjs' | 'plain-css'>('preparing')
let generation = 0
const stagingNodes = new Set<HTMLElement>()

const printableHtml = computed(() => hydrateStaticPrintHtml(props.rendered.html, props.mermaidSvg))

watch(printableHtml, () => { void paginateDocument() }, { flush: 'post', immediate: true })

onBeforeUnmount(() => {
  generation += 1
  stagingNodes.forEach((node) => node.remove())
  stagingNodes.clear()
})

async function paginateDocument(): Promise<void> {
  const currentGeneration = ++generation
  await nextTick()
  if (!printSource.value || !pagedTarget.value || !printDocument.value || !stagingHost.value) return

  const detachedSource = printSource.value.cloneNode(true) as HTMLElement
  const detachedTarget = document.createElement('div')
  stagingNodes.add(detachedSource)
  stagingNodes.add(detachedTarget)
  stagingHost.value.append(detachedSource, detachedTarget)
  replacePagedMermaidWithAtomicImages(detachedSource)
  status.value = 'Preparing printable document…'
  paginationState.value = 'preparing'
  const result = await paginate({
    document,
    source: detachedSource,
    target: detachedTarget,
    waitForKatex: async () => { await document.fonts?.ready },
    waitForMermaid: async () => { await waitForStaticMermaid() },
    preview: props.forceFallback ? async () => new Promise(() => undefined) : undefined,
    timeoutMs: props.forceFallback ? 1 : 10_000,
    stylesheets: [{ [new URL('print-document.css', window.location.href).href]: printDocumentCssText }],
  })
  // Must run after pagination: Paged.js appends its own @page (letter, no
  // margins) to the head during setup, which would otherwise outrank ours on
  // the native print path.
  installNativePageRule(printDocumentCssText, document)
  stagingNodes.delete(detachedSource)
  stagingNodes.delete(detachedTarget)
  if (currentGeneration !== generation || !pagedTarget.value) {
    detachedSource.remove()
    detachedTarget.remove()
    return
  }

  let mode = result.mode
  let warning = result.warnings[0]?.message
  if (mode === 'pagedjs') {
    pagedTarget.value.replaceChildren(...Array.from(detachedTarget.childNodes))
    pagedTarget.value.querySelectorAll('.pagedjs_page').forEach((page, index) => {
      page.setAttribute('data-preview-page-number', String(index + 1))
    })
    // Pagination is computed off-screen and then re-parented here, where the
    // browser lays it out again. Only this tree is shown, so only this tree can
    // be trusted, and only once it has settled: measured at placement it still
    // reports the staging positions and always looks correct.
    void verifyPlacedPreview(pagedTarget.value, currentGeneration)
  } else {
    pagedTarget.value.replaceChildren()
  }
  detachedSource.remove()
  detachedTarget.remove()
  paginationState.value = mode
  status.value = mode === 'pagedjs'
    ? `${result.pageCount} pages ready for printing.`
    : `Using plain CSS fallback: ${warning}`
}

async function verifyPlacedPreview(placed: HTMLElement, generationAtPlacement: number): Promise<void> {
  const hiding = await findPagesHidingContentWhenSettled(placed, {
    nextFrame: () => new Promise<void>((resolve) => { window.requestAnimationFrame(() => resolve()) }),
    now: () => window.performance.now(),
    fontsReady: document.fonts?.ready,
  })
  if (hiding.length === 0 || generationAtPlacement !== generation || pagedTarget.value !== placed) return

  paginationState.value = 'plain-css'
  status.value = `Using plain CSS fallback: Paged.js hides content outside the page box on page ${hiding.join(', ')}; using plain CSS.`
  placed.replaceChildren()
}

const svgPresentationAttributes = [
  'color',
  'fill',
  'fill-opacity',
  'font-family',
  'font-size',
  'font-style',
  'font-weight',
  'opacity',
  'stroke',
  'stroke-dasharray',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-opacity',
  'stroke-width',
] as const

function replacePagedMermaidWithAtomicImages(source: HTMLElement): void {
  source.querySelectorAll<SVGSVGElement>('.mermaid-static svg').forEach((svg) => {
    ;[svg, ...svg.querySelectorAll<SVGElement>('*')].forEach((element) => {
      const computed = window.getComputedStyle(element)
      svgPresentationAttributes.forEach((attribute) => {
        const value = computed.getPropertyValue(attribute)
        if (value) element.setAttribute(attribute, value)
      })
    })
    svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg')

    const image = document.createElement('img')
    image.alt = 'Mermaid diagram'
    image.className = 'mermaid-print-image'
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg.outerHTML)}`
    const viewBox = svg.viewBox.baseVal
    if (viewBox.width > 0 && viewBox.height > 0) {
      image.width = viewBox.width
      image.height = viewBox.height
    }
    svg.replaceWith(image)
  })
}

async function waitForStaticMermaid(): Promise<void> {
  const expected = props.rendered.mermaidBlocks.map((block) => block.id)
  const deadline = window.performance.now() + 5_000
  while (!expected.every((id) => props.mermaidSvg[id])) {
    if (window.performance.now() >= deadline) {
      throw new Error('Sanitized Mermaid output did not become ready for printing.')
    }
    await new Promise<void>((resolve) => window.setTimeout(resolve, 25))
  }
}

function hydrateStaticPrintHtml(html: string, mermaidSvg: Readonly<Record<string, string>>): string {
  const parsed = new DOMParser().parseFromString(html, 'text/html')
  parsed.querySelectorAll<HTMLElement>('[data-mermaid-placeholder]').forEach((placeholder) => {
    const id = placeholder.dataset.mermaidPlaceholder
    const svg = id ? mermaidSvg[id] : undefined
    if (!svg) return
    const staticDiagram = parsed.createElement('div')
    staticDiagram.className = 'mermaid-static'
    // MermaidSandbox has already returned this value through the distinct SVG sanitizer.
    staticDiagram.innerHTML = svg
    const svgRoot = staticDiagram.querySelector('svg')
    const viewBox = svgRoot?.getAttribute('viewBox')?.trim().split(/[\s,]+/).map(Number)
    if (svgRoot && viewBox?.length === 4 && Number.isFinite(viewBox[2]) && viewBox[2] > 0) {
      svgRoot.setAttribute('width', String(viewBox[2]))
    }
    placeholder.replaceWith(staticDiagram)
  })
  return parsed.body.innerHTML
}
</script>

<template>
  <section class="proof-card print-proof-card" aria-labelledby="print-proof-heading">
    <h2 id="print-proof-heading">Print proof</h2>
    <p data-testid="print-pagination-status" role="status">{{ status }}</p>
    <article
      ref="printDocument"
      data-testid="print-document"
      class="stackedit-print-document"
      :class="{
        'pagedjs-ready': paginationState === 'pagedjs',
        'pagedjs-failed': paginationState === 'plain-css',
      }"
      :data-page-size="DEFAULT_PRINT_SETTINGS.pageSize"
    >
      <!-- eslint-disable vue/no-v-html -- only sanitized Markdown and separately sanitized static Mermaid SVG enter here. -->
      <div ref="printSource" class="print-source stackedit-print-document" v-html="printableHtml" />
      <div ref="pagedTarget" class="paged-output" aria-label="Paginated print pages" />
    </article>
    <div ref="stagingHost" class="pagination-staging" aria-hidden="true" />
  </section>
</template>
