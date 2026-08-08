import { resolve } from 'node:path'
import { defineConfig } from 'vite'

const rendererNonce = 'stackmark-mermaid-renderer-v1'

export default defineConfig({
  publicDir: false,
  plugins: [{
    name: 'emit-mermaid-sandbox-document',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'mermaid-renderer.html',
        source: `<!doctype html>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${rendererNonce}'; img-src data:; style-src 'unsafe-inline'; font-src data:; connect-src 'none'; media-src 'none'; object-src 'none'; frame-src 'none'">
<title>StackMark Mermaid renderer</title>
<script nonce="${rendererNonce}" src="/generated/mermaid-renderer.iife.js" referrerpolicy="no-referrer"></script>
`,
      })
    },
  }],
  build: {
    emptyOutDir: false,
    lib: {
      entry: resolve(import.meta.dirname, 'src/mermaid/renderer-entry.ts'),
      formats: ['iife'],
      name: 'StackMarkMermaidRenderer',
      fileName: () => 'mermaid-renderer.iife.js',
    },
    outDir: resolve(import.meta.dirname, 'public/generated'),
  },
})
