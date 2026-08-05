<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, useTemplateRef, watch } from 'vue'
import { DEFAULT_PRINT_SETTINGS, paginate } from '@stackedit/print'
import '@stackedit/print/print.css'
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
  })
  stagingNodes.delete(detachedSource)
  stagingNodes.delete(detachedTarget)
  if (currentGeneration !== generation || !pagedTarget.value) {
    detachedSource.remove()
    detachedTarget.remove()
    return
  }

  if (result.mode === 'pagedjs') {
    pagedTarget.value.replaceChildren(...Array.from(detachedTarget.childNodes))
    pagedTarget.value.querySelectorAll('.pagedjs_page').forEach((page, index) => {
      page.setAttribute('data-preview-page-number', String(index + 1))
    })
  } else {
    pagedTarget.value.replaceChildren()
  }
  detachedSource.remove()
  detachedTarget.remove()
  paginationState.value = result.mode
  status.value = result.mode === 'pagedjs'
    ? `${result.pageCount} pages ready for printing.`
    : `Using plain CSS fallback: ${result.warnings[0]?.message}`
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
