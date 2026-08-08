export const MERMAID_PROTOCOL_VERSION = 1 as const

export interface MermaidRenderRequest {
  type: 'stackmark:mermaid:render'
  version: typeof MERMAID_PROTOCOL_VERSION
  id: string
  source: string
  theme: 'default' | 'dark' | 'neutral'
}

export interface MermaidRenderResponse {
  type: 'stackmark:mermaid:result'
  version: typeof MERMAID_PROTOCOL_VERSION
  id: string
  svg?: string
  error?: string
}

export function isMermaidRenderRequest(value: unknown): value is MermaidRenderRequest {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<MermaidRenderRequest>
  return candidate.type === 'stackmark:mermaid:render'
    && candidate.version === MERMAID_PROTOCOL_VERSION
    && typeof candidate.id === 'string'
    && typeof candidate.source === 'string'
    && (candidate.theme === 'default' || candidate.theme === 'dark' || candidate.theme === 'neutral')
}

export function isMermaidRenderResponse(value: unknown): value is MermaidRenderResponse {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<MermaidRenderResponse>
  return candidate.type === 'stackmark:mermaid:result'
    && candidate.version === MERMAID_PROTOCOL_VERSION
    && typeof candidate.id === 'string'
    && (typeof candidate.svg === 'string' || typeof candidate.error === 'string')
}
