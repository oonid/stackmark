import { resolve } from 'node:path'
import { defineConfig } from 'vite'

export default defineConfig({
  publicDir: false,
  build: {
    emptyOutDir: false,
    lib: {
      entry: resolve(import.meta.dirname, 'src/mermaid/renderer-entry.ts'),
      formats: ['iife'],
      name: 'StackEditMermaidRenderer',
      fileName: () => 'mermaid-renderer.iife.js',
    },
    outDir: resolve(import.meta.dirname, 'public/generated'),
  },
})
