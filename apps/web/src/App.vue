<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { renderMarkdown } from '@stackedit/markdown'
import MarkdownPreview from './MarkdownPreview.vue'
import PrintProof from './print/PrintProof.vue'
import initialMarkdown from '../../../tests/fixtures/print-proof.md?raw'

const markdownSource = ref(initialMarkdown)
const renderedMarkdown = ref(renderMarkdown(markdownSource.value))
const mermaidSvg = ref<Record<string, string>>({})
let renderTimer: ReturnType<typeof window.setTimeout> | undefined

watch(markdownSource, (source) => {
  if (renderTimer) {
    window.clearTimeout(renderTimer)
  }
  renderTimer = window.setTimeout(() => {
    renderedMarkdown.value = renderMarkdown(source)
    mermaidSvg.value = {}
  }, 150)
})

onBeforeUnmount(() => {
  if (renderTimer) {
    window.clearTimeout(renderTimer)
  }
})

function printProof(): void {
  window.print()
}

function recordMermaidSvg(id: string, svg: string): void {
  mermaidSvg.value = { ...mermaidSvg.value, [id]: svg }
}

const forcePrintFallback = new URLSearchParams(window.location.search).has('printFallback')
</script>

<template>
  <main class="proof-shell">
    <header class="proof-header">
      <p class="eyebrow">Shared Vue proof screen</p>
      <h1 data-testid="stage-zero-title">StackEdit Stage 0</h1>
      <p>One frontend shell for the browser today and the Tauri host in the next proof.</p>
    </header>

    <section class="proof-grid" aria-label="Stage 0 proof gates">
      <section class="proof-card" aria-labelledby="markdown-source-heading">
        <h2 id="markdown-source-heading">Markdown source</h2>
        <textarea
          v-model="markdownSource"
          data-testid="markdown-source"
          aria-label="Markdown source"
          spellcheck="false"
        />
      </section>

      <section class="proof-card" aria-labelledby="preview-heading">
        <h2 id="preview-heading">Preview</h2>
        <article data-testid="rendered-preview" class="preview-panel">
          <MarkdownPreview :rendered="renderedMarkdown" @mermaid-rendered="recordMermaidSvg" />
        </article>
      </section>

      <section data-testid="desktop-file-proof" class="proof-card" aria-labelledby="desktop-file-heading">
        <h2 id="desktop-file-heading">Desktop file proof</h2>
        <p>Folder selection and atomic saves require the Tauri desktop capability.</p>
        <button type="button" disabled>Choose folder in desktop app</button>
      </section>

      <PrintProof
        :rendered="renderedMarkdown"
        :mermaid-svg="mermaidSvg"
        :force-fallback="forcePrintFallback"
      />

      <section class="proof-card print-action-card" aria-label="Print action">
        <p>Use the browser print dialog to prove the shared output path.</p>
        <button type="button" data-testid="print-proof" @click="printProof">Print proof</button>
      </section>
    </section>
  </main>
</template>
