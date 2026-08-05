<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { getMermaidSandbox } from './MermaidSandbox'

const props = defineProps<{ source: string }>()
const svg = ref('')
const error = ref('')

async function render(): Promise<void> {
  svg.value = ''
  error.value = ''
  try { svg.value = await (await getMermaidSandbox()).render(props.source) }
  catch (cause) { error.value = cause instanceof Error ? cause.message : 'Mermaid rendering failed.' }
}

onMounted(render)
watch(() => props.source, render)
</script>

<template>
  <div class="mermaid-static" data-testid="mermaid-static">
    <p v-if="error" role="status">{{ error }}</p>
    <!-- eslint-disable-next-line vue/no-v-html -- MermaidSandbox returns SVG from the distinct SVG sanitizer. -->
    <div v-else-if="svg" v-html="svg" />
    <p v-else role="status">Rendering diagram…</p>
  </div>
</template>
