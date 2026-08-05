import { sanitizeMermaidSvg } from '@stackedit/markdown/mermaid/svg-sanitizer'
import {
  MERMAID_PROTOCOL_VERSION,
  isMermaidRenderResponse,
  type MermaidRenderRequest,
} from '@stackedit/markdown/mermaid/protocol'

const CSP = "default-src 'none'; script-src 'unsafe-inline'; img-src data:; style-src 'unsafe-inline'; font-src data:; connect-src 'none'; media-src 'none'; object-src 'none'; frame-src 'none'"

export class MermaidSandbox {
  private readonly frame: HTMLIFrameElement
  private readonly ready: Promise<void>
  private readonly pending = new Map<string, { resolve: (svg: string) => void; reject: (error: Error) => void; timer: number }>()

  private constructor(bundle: string) {
    this.frame = document.createElement('iframe')
    this.frame.hidden = true
    this.frame.setAttribute('sandbox', 'allow-scripts')
    this.frame.srcdoc = `<!doctype html><meta http-equiv="Content-Security-Policy" content="${CSP}"><script>${bundle.replaceAll('</script', '<\\/script')}</script>`
    this.ready = new Promise((resolve) => this.frame.addEventListener('load', () => resolve(), { once: true }))
    window.addEventListener('message', this.receive)
    document.body.append(this.frame)
  }

  static async create(): Promise<MermaidSandbox> {
    const response = await fetch('/generated/mermaid-renderer.iife.js', { credentials: 'same-origin' })
    if (!response.ok) throw new Error(`Mermaid renderer unavailable (${response.status}).`)
    return new MermaidSandbox(await response.text())
  }

  async render(source: string, theme: MermaidRenderRequest['theme'] = 'default'): Promise<string> {
    await this.ready
    const id = crypto.randomUUID()
    const request: MermaidRenderRequest = { type: 'stackedit:mermaid:render', version: MERMAID_PROTOCOL_VERSION, id, source, theme }
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.pending.delete(id)
        reject(new Error('Mermaid rendering timed out.'))
      }, 5000)
      this.pending.set(id, { resolve, reject, timer })
      this.frame.contentWindow?.postMessage(request, '*')
    })
  }

  private readonly receive = (event: MessageEvent<unknown>): void => {
    if (event.source !== this.frame.contentWindow || event.origin !== 'null' || !isMermaidRenderResponse(event.data)) return
    const pending = this.pending.get(event.data.id)
    if (!pending) return
    window.clearTimeout(pending.timer)
    this.pending.delete(event.data.id)
    if (event.data.error) pending.reject(new Error(event.data.error))
    else pending.resolve(sanitizeMermaidSvg(event.data.svg ?? ''))
  }
}

let sandbox: Promise<MermaidSandbox> | undefined
export function getMermaidSandbox(): Promise<MermaidSandbox> {
  sandbox ??= MermaidSandbox.create()
  return sandbox
}
