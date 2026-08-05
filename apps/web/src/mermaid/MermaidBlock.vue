<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { getMermaidSandbox } from './MermaidSandbox'

const props = defineProps<{ source: string }>()
const emit = defineEmits<{ rendered: [svg: string] }>()
const svg = ref('')
const error = ref('')
let generation = 0

async function render(): Promise<void> {
  const currentGeneration = ++generation
  const source = props.source
  svg.value = ''
  error.value = ''
  try {
    const rendered = await (await getMermaidSandbox()).render(source)
    if (currentGeneration === generation) {
      svg.value = rendered
      emit('rendered', rendered)
    }
  } catch (cause) {
    if (currentGeneration === generation) {
      error.value = cause instanceof Error ? cause.message : 'Mermaid rendering failed.'
    }
  }
}

onMounted(render)
watch(() => props.source, render)
onBeforeUnmount(() => { generation += 1 })
</script>

<template>
  <div class="mermaid-static" data-testid="mermaid-static">
    <p v-if="error" role="status">{{ error }}</p>
    <!-- eslint-disable-next-line vue/no-v-html -- MermaidSandbox returns SVG from the distinct SVG sanitizer. -->
    <div v-else-if="svg" v-html="svg" />
    <p v-else role="status">Rendering diagram…</p>
  </div>
</template>

<style scoped>
.mermaid-static :deep(svg) {
  display: block;
  height: auto;
  margin: 1rem auto;
  max-width: 100%;
}

.mermaid-static :deep(text) {
  fill: #1f2937;
  font-family: Inter, ui-sans-serif, system-ui, sans-serif;
  font-size: 14px;
}

.mermaid-static :deep(.node rect),
.mermaid-static :deep(.node circle),
.mermaid-static :deep(.node ellipse),
.mermaid-static :deep(.node polygon),
.mermaid-static :deep(.actor),
.mermaid-static :deep(.entityBox) {
  fill: #f8fafc;
  stroke: #475569;
}

.mermaid-static :deep(.edgePath path),
.mermaid-static :deep(.flowchart-link),
.mermaid-static :deep(.messageLine0),
.mermaid-static :deep(.messageLine1),
.mermaid-static :deep(.relationshipLine) {
  fill: none;
  stroke: #475569;
}

.mermaid-static :deep(marker path) {
  fill: #475569;
  stroke: #475569;
}
</style>
