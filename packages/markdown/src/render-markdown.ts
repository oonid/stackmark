import katex from 'katex'
import MarkdownIt from 'markdown-it'
import { sanitizeHtml } from './sanitize-html'

export interface RenderedMarkdown {
  html: string
  mermaidBlocks: Array<{ id: string; source: string }>
  warnings: Array<{ code: string; message: string }>
}

interface RenderEnvironment {
  mermaidBlocks: RenderedMarkdown['mermaidBlocks']
  warnings: RenderedMarkdown['warnings']
}

const mermaidWarning = 'Mermaid rendering is pending.'
const markdown = createMarkdownRenderer()

export function renderMarkdown(source: string): RenderedMarkdown {
  const environment: RenderEnvironment = { mermaidBlocks: [], warnings: [] }

  return {
    html: sanitizeHtml(markdown.render(source, environment)),
    mermaidBlocks: environment.mermaidBlocks,
    warnings: environment.warnings,
  }
}

function createMarkdownRenderer(): MarkdownIt {
  const renderer = new MarkdownIt({ html: true })

  renderer.inline.ruler.after('escape', 'math_inline', (state, silent) => {
    if (state.src.charCodeAt(state.pos) !== 0x24) return false

    const start = state.pos + 1
    if (start >= state.posMax || /\s/.test(state.src[start]) || state.src[start] === '$') return false

    let end = start
    while (end < state.posMax) {
      end = state.src.indexOf('$', end)
      if (end === -1) return false
      if (state.src[end - 1] !== '\\') break
      end += 1
    }

    if (end === start || /\s/.test(state.src[end - 1])) return false

    if (!silent) {
      const token = state.push('math_inline', 'math', 0)
      token.content = state.src.slice(start, end)
    }
    state.pos = end + 1
    return true
  })

  renderer.block.ruler.before('fence', 'math_block', (state, startLine, endLine, silent) => {
    const start = state.bMarks[startLine] + state.tShift[startLine]
    const maximum = state.eMarks[startLine]
    const delimiterLine = state.src.slice(start, maximum).trim()
    const singleLineMath = /^\$\$(.+)\$\$$/.exec(delimiterLine)
    if (singleLineMath) {
      if (!silent) {
        const token = state.push('math_block', 'math', 0)
        token.block = true
        token.content = singleLineMath[1]
        token.map = [startLine, startLine + 1]
      }
      state.line = startLine + 1
      return true
    }
    if (delimiterLine !== '$$') return false

    let nextLine = startLine + 1
    while (nextLine < endLine) {
      const lineStart = state.bMarks[nextLine] + state.tShift[nextLine]
      const lineEnd = state.eMarks[nextLine]
      if (state.src.slice(lineStart, lineEnd).trim() === '$$') break
      nextLine += 1
    }
    if (nextLine === endLine) return false

    if (!silent) {
      const token = state.push('math_block', 'math', 0)
      token.block = true
      token.content = state.getLines(startLine + 1, nextLine, state.blkIndent, false).trim()
      token.map = [startLine, nextLine + 1]
    }
    state.line = nextLine + 1
    return true
  })

  renderer.renderer.rules.math_inline = (tokens, index) => renderMath(tokens[index].content, false)
  renderer.renderer.rules.math_block = (tokens, index) => `${renderMath(tokens[index].content, true)}\n`

  const defaultFence = renderer.renderer.rules.fence
  renderer.renderer.rules.fence = (tokens, index, options, environment, self) => {
    const token = tokens[index]
    if (token.info.trim().split(/\s+/)[0] !== 'mermaid') {
      return defaultFence ? defaultFence(tokens, index, options, environment, self) : self.renderToken(tokens, index, options)
    }

    const context = environment as RenderEnvironment
    const id = `mermaid-${context.mermaidBlocks.length + 1}`
    context.mermaidBlocks.push({ id, source: token.content })
    context.warnings.push({ code: 'MERMAID_PENDING', message: mermaidWarning })
    return `<div data-mermaid-placeholder="${id}" class="mermaid-placeholder" role="status">${mermaidWarning}</div>\n`
  }

  return renderer
}

function renderMath(source: string, displayMode: boolean): string {
  return katex.renderToString(source, { displayMode, output: 'html', throwOnError: false })
}
