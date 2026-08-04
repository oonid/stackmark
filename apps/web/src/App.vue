<script setup lang="ts">
import { ref } from 'vue'
import initialMarkdown from '../../../tests/fixtures/print-proof.md?raw'

const markdownSource = ref(initialMarkdown)

function printProof(): void {
  window.print()
}
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
          <p>Markdown rendering is intentionally proved in the next Stage 0 slice.</p>
          <pre>{{ markdownSource }}</pre>
        </article>
      </section>

      <section data-testid="desktop-file-proof" class="proof-card" aria-labelledby="desktop-file-heading">
        <h2 id="desktop-file-heading">Desktop file proof</h2>
        <p>Folder selection and atomic saves require the Tauri desktop capability.</p>
        <button type="button" disabled>Choose folder in desktop app</button>
      </section>

      <section class="proof-card" aria-labelledby="print-proof-heading">
        <h2 id="print-proof-heading">Print proof</h2>
        <p>Use the browser print dialog to prove the shared output path.</p>
        <button type="button" data-testid="print-proof" @click="printProof">Print proof</button>
      </section>
    </section>
  </main>
</template>
