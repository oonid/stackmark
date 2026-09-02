import { sanitizeMermaidSvg } from '@stackmark/markdown/mermaid/svg-sanitizer'
import {
  MERMAID_PROTOCOL_VERSION,
  isMermaidRenderResponse,
  type MermaidRenderRequest,
} from '@stackmark/markdown/mermaid/protocol'

export class MermaidSandbox {
  private readonly frame: HTMLIFrameElement
  private readonly ready: Promise<void>
  private readonly pending = new Map<string, { resolve: (svg: string) => void; reject: (error: Error) => void; timer: number }>()

  private constructor(readyTimeoutMs: number) {
    this.frame = document.createElement('iframe')
    this.frame.setAttribute('aria-hidden', 'true')
    this.frame.tabIndex = -1
    this.frame.style.cssText = 'position:fixed;left:-10000px;top:0;width:1024px;height:768px;border:0;opacity:0;pointer-events:none'
    this.frame.setAttribute('sandbox', 'allow-scripts')
    this.frame.src = '/generated/mermaid-renderer.html'
    // Without a bound this promise can never settle: render() awaits it before
    // arming its own timer, so a frame that never loads — which is exactly what
    // a refused renderer script produces — hangs every diagram forever with no
    // error anywhere.
    this.ready = new Promise((resolve, reject) => {
      const timer = window.setTimeout(
        () => reject(new Error('The Mermaid renderer frame did not load.')),
        readyTimeoutMs,
      )
      this.frame.addEventListener('load', () => { window.clearTimeout(timer); resolve() }, { once: true })
      this.frame.addEventListener('error', () => {
        window.clearTimeout(timer)
        reject(new Error('The Mermaid renderer frame failed to load.'))
      }, { once: true })
    })
    // Awaited by render(); this keeps a failure from surfacing as an unhandled
    // rejection when nothing has asked for a diagram yet.
    void this.ready.catch(() => undefined)
    window.addEventListener('message', this.receive)
    document.body.append(this.frame)
  }

  static async create(readyTimeoutMs = 10_000): Promise<MermaidSandbox> {
    return new MermaidSandbox(readyTimeoutMs)
  }

  async render(source: string, theme: MermaidRenderRequest['theme'] = 'default'): Promise<string> {
    await this.ready
    const id = crypto.randomUUID()
    const request: MermaidRenderRequest = { type: 'stackmark:mermaid:render', version: MERMAID_PROTOCOL_VERSION, id, source, theme }
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
