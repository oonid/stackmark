export interface PrintSettings {
  pageSize: 'A4'
  orientation: 'portrait'
  margins: Readonly<{ top: '16mm'; right: '14mm'; bottom: '18mm'; left: '14mm' }>
  runningTitle: string
  pageCounter: string
}

export interface PrintPolicy {
  pageClass: 'stackedit-print-document'
  imageMaxWidth: '100%'
  imageMaxHeight: '240mm'
  codeWhiteSpace: 'pre-wrap'
  codeOverflowWrap: 'anywhere'
  headingBreakAfter: 'avoid-page'
  tableHeaderDisplay: 'table-header-group'
}

export interface PaginationWarning {
  code: 'PAGEDJS_FAILED' | 'PAGEDJS_TIMEOUT'
  message: string
}

export interface PaginationResult {
  mode: 'pagedjs' | 'plain-css'
  pageCount: number
  warnings: PaginationWarning[]
}

export interface PaginateOptions {
  document: Document
  source: HTMLElement
  target: HTMLElement
  timeoutMs?: number
  waitForKatex?: () => Promise<void>
  waitForMermaid?: () => Promise<void>
  preview?: (source: HTMLElement, target: HTMLElement) => Promise<{ total?: number }>
}

export const DEFAULT_PRINT_SETTINGS: PrintSettings = {
  pageSize: 'A4',
  orientation: 'portrait',
  margins: { top: '16mm', right: '14mm', bottom: '18mm', left: '14mm' },
  runningTitle: 'StackEdit print proof',
  pageCounter: 'Page {{page}} of {{pages}}',
}

const printPolicyValue: PrintPolicy = {
  pageClass: 'stackedit-print-document',
  imageMaxWidth: '100%',
  imageMaxHeight: '240mm',
  codeWhiteSpace: 'pre-wrap',
  codeOverflowWrap: 'anywhere',
  headingBreakAfter: 'avoid-page',
  tableHeaderDisplay: 'table-header-group',
}

export function printPolicy(settings: PrintSettings): PrintPolicy {
  void settings
  return printPolicyValue
}

export async function awaitPrintResources(document: Document): Promise<void> {
  const images = Array.from(document.querySelectorAll('img'))
  await Promise.all([
    document.fonts?.ready ?? Promise.resolve(),
    ...images.map((image) => awaitImage(image)),
  ])
}

export async function paginate(options: PaginateOptions): Promise<PaginationResult> {
  await awaitPrintResources(options.document)
  await options.waitForKatex?.()
  await options.waitForMermaid?.()

  const timeoutMs = options.timeoutMs ?? 10_000
  try {
    const flow = await withTimeout(
      options.preview ? options.preview(options.source, options.target) : previewPaged(options.source, options.target),
      timeoutMs,
    )
    return { mode: 'pagedjs', pageCount: flow.total ?? countPages(options.target), warnings: [] }
  } catch (cause) {
    options.target.classList.add('pagedjs-failed')
    const timedOut = cause instanceof PaginationTimeoutError
    return {
      mode: 'plain-css',
      pageCount: 0,
      warnings: [{
        code: timedOut ? 'PAGEDJS_TIMEOUT' : 'PAGEDJS_FAILED',
        message: timedOut
          ? 'Paged.js pagination timed out; using plain CSS.'
          : 'Paged.js pagination failed; using plain CSS.',
      }],
    }
  }
}

async function previewPaged(source: HTMLElement, target: HTMLElement): Promise<{ total?: number }> {
  const previewer = new Previewer()
  return previewer.preview(source, [], target)
}

function countPages(target: HTMLElement): number {
  return target.querySelectorAll('.pagedjs_page').length
}

function awaitImage(image: HTMLImageElement): Promise<void> {
  if (image.complete) return Promise.resolve()
  return new Promise((resolve) => {
    image.addEventListener('load', () => resolve(), { once: true })
    image.addEventListener('error', () => resolve(), { once: true })
  })
}

class PaginationTimeoutError extends Error {}

function withTimeout<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new PaginationTimeoutError()), timeoutMs)
    operation.then(
      (value) => { window.clearTimeout(timer); resolve(value) },
      (error: unknown) => { window.clearTimeout(timer); reject(error) },
    )
  })
}
import { Previewer } from 'pagedjs'
