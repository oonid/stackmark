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

/** A Paged.js stylesheet: either a URL, or a single `{ url: cssText }` entry. */
export type PagedStylesheet = string | Record<string, string>

export interface PaginateOptions {
  document: Document
  source: HTMLElement
  target: HTMLElement
  timeoutMs?: number
  waitForKatex?: () => Promise<void>
  waitForMermaid?: () => Promise<void>
  preview?: (source: HTMLElement, target: HTMLElement) => Promise<{ total?: number }>
  /**
   * Print stylesheets handed to Paged.js. Required for the Paged.js path:
   * @page geometry is read from these, never from the live document.
   */
  stylesheets?: PagedStylesheet[]
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

export async function awaitPrintResources(source: HTMLElement, document: Document): Promise<void> {
  const images = Array.from(source.querySelectorAll('img'))
  await Promise.all([
    document.fonts?.ready ?? Promise.resolve(),
    ...images.map((image) => awaitImage(image)),
  ])
}

export async function paginate(options: PaginateOptions): Promise<PaginationResult> {
  const timeoutMs = options.timeoutMs ?? 10_000
  try {
    const flow = await withTimeout(async () => {
      await awaitPrintResources(options.source, options.document)
      await options.waitForKatex?.()
      await options.waitForMermaid?.()
      return options.preview
        ? options.preview(options.source, options.target)
        : previewPaged(options.source, options.target, options.stylesheets ?? [])
    },
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
          : `Paged.js pagination failed (${cause instanceof Error ? cause.message : 'unknown error'}); using plain CSS.`,
      }],
    }
  }
}

async function previewPaged(
  source: HTMLElement,
  target: HTMLElement,
  stylesheets: PagedStylesheet[],
): Promise<{ total?: number }> {
  if (stylesheets.length === 0) {
    // Paged.js treats an empty-but-present list as "already collected", so it
    // would paginate against its built-in Letter defaults and report success.
    throw new Error('no print stylesheet was supplied to Paged.js')
  }
  const previewer = new Previewer()
  // Paged.js's bundled types declare `string[]`, but Polisher.add also accepts
  // the `{ url: cssText }` form that Paged.js's own removeStyles() produces.
  // That form keeps a real base URL for relative url() references.
  return previewer.preview(source, stylesheets as unknown as string[], target)
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

function withTimeout<T>(operation: () => Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new PaginationTimeoutError()), timeoutMs)
    operation().then(
      (value) => { window.clearTimeout(timer); resolve(value) },
      (error: unknown) => { window.clearTimeout(timer); reject(error) },
    )
  })
}
import { Previewer } from 'pagedjs'

export { NATIVE_PAGE_RULE_ATTRIBUTE, extractPageRule, installNativePageRule } from './native-page-rule'
