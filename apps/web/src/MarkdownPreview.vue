<script setup lang="ts">
import type { RenderedMarkdown } from '@stackedit/markdown'
import { createApp, nextTick, onBeforeUnmount, onMounted, useTemplateRef, watch, type App } from 'vue'
import MermaidBlock from './mermaid/MermaidBlock.vue'

const props = defineProps<{ rendered: RenderedMarkdown }>()
const preview = useTemplateRef('preview')
let childApps: App[] = []
let generation = 0

function unmountChildren(): void {
  childApps.forEach((app) => app.unmount())
  childApps = []
}

async function mountMermaidBlocks(): Promise<void> {
  const currentGeneration = ++generation
  unmountChildren()
  await nextTick()
  if (currentGeneration !== generation || !preview.value) return

  const placeholderElements = preview.value.querySelectorAll('[data-mermaid-placeholder]')
  const placeholders = new Map<string, (typeof placeholderElements)[number]>()
  placeholderElements.forEach((placeholder) => {
    const id = placeholder.getAttribute('data-mermaid-placeholder')
    if (id && !placeholders.has(id)) placeholders.set(id, placeholder)
  })

  props.rendered.mermaidBlocks.forEach((block) => {
    const placeholder = placeholders.get(block.id)
    if (!placeholder) return
    placeholder.removeAttribute('role')
    placeholder.classList.remove('mermaid-placeholder')
    const app = createApp(MermaidBlock, { source: block.source })
    childApps.push(app)
    app.mount(placeholder)
  })
}

onMounted(mountMermaidBlocks)
watch(() => props.rendered, mountMermaidBlocks, { flush: 'post' })
onBeforeUnmount(() => {
  generation += 1
  unmountChildren()
})
</script>

<template>
  <!-- eslint-disable-next-line vue/no-v-html -- renderMarkdown is the single reviewed DOMPurify boundary. -->
  <div ref="preview" v-html="rendered.html" />
</template>
