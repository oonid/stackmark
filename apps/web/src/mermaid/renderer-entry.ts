import mermaid from 'mermaid'
import {
  MERMAID_PROTOCOL_VERSION,
  isMermaidRenderRequest,
  type MermaidRenderResponse,
} from '@stackedit/markdown/mermaid/protocol'

mermaid.initialize({
  startOnLoad: false,
  securityLevel: 'strict',
  htmlLabels: false,
  deterministicIds: true,
})

window.addEventListener('message', async (event: MessageEvent<unknown>) => {
  if (event.source !== window.parent || !isMermaidRenderRequest(event.data)) return

  const response: MermaidRenderResponse = {
    type: 'stackedit:mermaid:result',
    version: MERMAID_PROTOCOL_VERSION,
    id: event.data.id,
  }

  try {
    const rendered = await mermaid.render(`diagram-${event.data.id}`, event.data.source)
    response.svg = rendered.svg
  } catch (error) {
    response.error = error instanceof Error ? error.message : 'Mermaid rendering failed.'
  }

  window.parent.postMessage(response, '*')
})
