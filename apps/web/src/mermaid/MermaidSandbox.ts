import { sanitizeMermaidSvg } from '@stackedit/markdown/mermaid/svg-sanitizer'
import {
  MERMAID_PROTOCOL_VERSION,
  isMermaidRenderResponse,
  type MermaidRenderRequest,
} from '@stackedit/markdown/mermaid/protocol'

export class MermaidSandbox {
  private readonly frame: HTMLIFrameElement
  private readonly ready: Promise<void>
  private readonly pending = new Map<string, { resolve: (svg: string) => void; reject: (error: Error) => void; timer: number }>()

  private constructor() {
    this.frame = document.createElement('iframe')
    this.frame.setAttribute('aria-hidden', 'true')
    this.frame.tabIndex = -1
    this.frame.style.cssText = 'position:fixed;left:-10000px;top:0;width:1024px;height:768px;border:0;opacity:0;pointer-events:none'
    this.frame.setAttribute('sandbox', 'allow-scripts')
    this.frame.src = '/generated/mermaid-renderer.html'
    this.ready = new Promise((resolve) => this.frame.addEventListener('load', () => resolve(), { once: true }))
    window.addEventListener('message', this.receive)
    document.body.append(this.frame)
  }

  static async create(): Promise<MermaidSandbox> {
    return new MermaidSandbox()
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
