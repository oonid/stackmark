<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { renderMarkdown } from '@stackmark/markdown'
import MarkdownPreview from './MarkdownPreview.vue'
import PrintProof from './print/PrintProof.vue'
import { isTauri } from '@tauri-apps/api/core'
import type { DocumentMetadata } from '@stackmark/core'
import {
  createTauriDocumentStore,
  createTauriWorkspaceHost,
  createWebWorkspaceHost,
  type DocumentStore,
  type ExternalChange,
  isStoreError,
  type WorkspaceHost,
} from '@stackmark/platform'
import initialMarkdown from '../../../tests/fixtures/print-proof.md?raw'

const PROOF_PATH = 'stage-zero-proof.md'

const markdownSource = ref(initialMarkdown)
const renderedMarkdown = ref(renderMarkdown(markdownSource.value))
const mermaidSvg = ref<Record<string, string>>({})
// The same two contracts both surfaces implement. The browser reports
// `supported: false` and rejects, so the interface asks before it commits to
// the interaction rather than branching on which platform it is running on.
const workspaceHost: WorkspaceHost = isTauri()
  ? createTauriWorkspaceHost()
  : createWebWorkspaceHost()
let documentStore: DocumentStore | undefined
const desktopBusy = ref(false)
const desktopStatus = ref(
  workspaceHost.supported
    ? 'Choose a workspace to write stage-zero-proof.md atomically.'
    : 'Folder selection and atomic saves require the Tauri desktop capability.',
)
const savedFile = ref<DocumentMetadata>()
const externalChange = ref<ExternalChange>()
let stopWatching: (() => void) | undefined
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
  stopWatching?.()
})

function printProof(): void {
  window.print()
}

function recordMermaidSvg(id: string, svg: string): void {
  mermaidSvg.value = { ...mermaidSvg.value, [id]: svg }
}

async function runDesktopProof(): Promise<void> {
  if (!workspaceHost.supported || desktopBusy.value) return
  desktopBusy.value = true
  desktopStatus.value = 'Waiting for workspace selection…'
  try {
    stopWatching ??= await workspaceHost.watch((change) => {
      externalChange.value = change
    })
    // A workspace may already be adopted, from a folder named when the process
    // was launched. Asking the user to pick it again would be wrong.
    const root = (await workspaceHost.current()) ?? (await workspaceHost.adopt())
    if (root === null) {
      desktopStatus.value = 'Workspace selection cancelled.'
      return
    }

    documentStore ??= createTauriDocumentStore(root)
    // The path is used once to find or register the document; every later
    // operation addresses it by identifier.
    const existing = (await documentStore.list()).find((entry) => entry.path === PROOF_PATH)
    savedFile.value = existing
      ? await documentStore.write(existing.id, markdownSource.value)
      : await documentStore.create(PROOF_PATH, markdownSource.value)
    desktopStatus.value = `Saved ${PROOF_PATH} in ${root}`
  } catch (error) {
    desktopStatus.value = describeFailure(error)
  } finally {
    desktopBusy.value = false
  }
}

/** Turns a contract error into something a person can read. */
function describeFailure(error: unknown): string {
  if (isStoreError(error)) {
    switch (error.kind) {
      case 'outside-workspace':
        return `Refused: ${error.path} is outside the workspace.`
      case 'not-found':
        return 'That document is no longer there.'
      case 'changed-underneath':
        return 'The file changed underneath us; saving would discard the other change.'
      default:
        return error.message
    }
  }
  return error instanceof Error ? error.message : String(error)
}

// A seam for the browser test that exercises the plain-CSS fallback, and
// nothing else. `import.meta.env.DEV` is replaced at build time, so this whole
// expression folds to `false` and the branch leaves the production bundle
// entirely: it is not a runtime guard that could be bypassed, the parameter
// simply has no meaning in a shipped build. Without this, any user who landed
// on the query string would get degraded printing.
const forcePrintFallback =
  import.meta.env.DEV && new URLSearchParams(window.location.search).has('printFallback')
</script>

<template>
  <main class="proof-shell">
    <header class="proof-header">
      <p class="eyebrow">Shared Vue proof screen</p>
      <h1 data-testid="stage-zero-title">StackMark Stage 0</h1>
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
        <p data-testid="desktop-status">{{ desktopStatus }}</p>
        <button
          type="button"
          data-testid="desktop-proof-action"
          :disabled="!workspaceHost.supported || desktopBusy"
          @click="runDesktopProof"
        >
          {{ desktopBusy ? 'Saving proof…' : 'Choose folder and save proof' }}
        </button>
        <dl v-if="savedFile" class="proof-metadata" data-testid="desktop-save-metadata">
          <dt>Saved hash</dt>
          <dd>{{ savedFile.contentHash }}</dd>
          <dt>Modified</dt>
          <dd>{{ savedFile.modifiedAt }}</dd>
        </dl>
        <dl v-if="externalChange" class="proof-metadata" data-testid="desktop-external-change">
          <dt>External change</dt>
          <dd>{{ externalChange.path }}</dd>
          <dt>Hash</dt>
          <dd>{{ externalChange.contentHash }}</dd>
        </dl>
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
