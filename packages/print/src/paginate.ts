export interface PrintSettings {
  pageSize: 'A4'
  orientation: 'portrait'
  margins: Readonly<{ top: '16mm'; right: '14mm'; bottom: '18mm'; left: '14mm' }>
  runningTitle: string
  pageCounter: string
}

export interface PrintPolicy {
  pageClass: 'stackmark-print-document'
  imageMaxWidth: '100%'
  imageMaxHeight: '240mm'
  codeWhiteSpace: 'pre-wrap'
  codeOverflowWrap: 'anywhere'
  headingBreakAfter: 'avoid-page'
  tableHeaderDisplay: 'table-header-group'
}

export interface PaginationWarning {
  code: 'PAGEDJS_FAILED' | 'PAGEDJS_TIMEOUT' | 'PAGEDJS_INCOMPLETE'
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
  runningTitle: 'StackMark print proof',
  pageCounter: 'Page {{page}} of {{pages}}',
}

const printPolicyValue: PrintPolicy = {
  pageClass: 'stackmark-print-document',
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

const COMPARISON_CHUNK = 40

/**
 * Runs of source text that the paged output does not contain.
 *
 * Both sides have all whitespace removed before comparison, which makes the
 * check immune to three things that are not content loss: adjacent elements
 * whose text runs together in one tree but not the other (`<td>a</td><td>b</td>`
 * yields `ab`), a word split across a page boundary, and text duplicated into
 * an engine's overflow area. Chunks are matched in order, so a run that the
 * engine dropped is reported even in repetitive documents, where searching the
 * whole output for each chunk independently would find the missing text again
 * in an identical row above it.
 */
export function findDroppedText(sourceText: string, pagedText: string): string[] {
  const source = normalizeForComparison(sourceText)
  const paged = normalizeForComparison(pagedText)
  if (source.length === 0) return []
  if (source.length <= COMPARISON_CHUNK) {
    return paged.includes(source) ? [] : [source]
  }

  const missing: string[] = []
  // Each chunk must appear *after* the previous one. Searching the whole output
  // for every chunk independently is blind to repetitive documents: a dropped
  // table row is simply found again in the row above it, and tables, code and
  // lists are exactly what the engine breaks worst on.
  let searchFrom = 0
  for (let start = 0; start + COMPARISON_CHUNK <= source.length; start += COMPARISON_CHUNK) {
    const chunk = source.slice(start, start + COMPARISON_CHUNK)
    const found = paged.indexOf(chunk, searchFrom)
    if (found === -1) missing.push(chunk)
    else searchFrom = found + chunk.length
  }
  // The tail is shorter than a chunk, so check it inside a full-width window.
  // It may legitimately sit before `searchFrom` when the engine duplicated text.
  const tail = source.slice(-COMPARISON_CHUNK)
  if (paged.indexOf(tail, searchFrom) === -1 && !paged.includes(tail)) missing.push(tail)
  return [...new Set(missing)]
}

function normalizeForComparison(text: string): string {
  return text.toLowerCase().replace(/\s+/g, '')
}

/** Selector for elements that carry readable content on a page. */
const CONTENT_SELECTOR = 'p,h1,h2,h3,h4,h5,h6,pre,td,th,li,blockquote,figure,img,.katex,.mermaid-static'
const OVERFLOW_TOLERANCE_PX = 1

/**
 * How far the furthest item escapes the page box, in pixels.
 *
 * An engine may lay content out and then leave it in a clipped column beside
 * the page instead of moving it to the next one. The text is present in the
 * document, so comparing text cannot see it, but a reader cannot read it.
 */
export interface Box {
  left: number
  top: number
  right: number
  bottom: number
}

export function worstHiddenOverflow(box: Box, items: Box[]): number {
  let worst = 0
  for (const item of items) {
    worst = Math.max(
      worst,
      item.right - box.right,
      item.bottom - box.bottom,
      box.left - item.left,
      box.top - item.top,
    )
  }
  return worst
}

export function findPagesHidingContent(target: HTMLElement): number[] {
  const pages = Array.from(target.querySelectorAll<HTMLElement>('.pagedjs_page_content'))
  const hiding: number[] = []
  pages.forEach((content, index) => {
    const box = content.getBoundingClientRect()
    const items = Array.from(content.querySelectorAll<HTMLElement>(CONTENT_SELECTOR))
      .filter((element) => element.tagName === 'IMG' || (element.textContent ?? '').trim().length > 0)
      .map((element) => element.getBoundingClientRect())
    if (worstHiddenOverflow(box, items) > OVERFLOW_TOLERANCE_PX) hiding.push(index + 1)
  })
  return hiding
}

export interface SettleOptions {
  nextFrame: () => Promise<void>
  now: () => number
  /** Resolves after roughly the given delay. Bounds the wait when frames stall. */
  afterDelay?: (ms: number) => Promise<void>
  fontsReady?: Promise<unknown>
  deadlineMs?: number
}

/**
 * Watches the placed pages until they stop moving, and reports any that hide
 * content.
 *
 * Pages are paginated off-screen and then re-parented for display, and the
 * browser lays them out again afterwards. A verdict taken at placement measures
 * the old positions and always looks correct, so this samples until a page is
 * seen hiding content — which is conclusive — or the window expires.
 */
export async function findPagesHidingContentWhenSettled(
  root: HTMLElement,
  options: SettleOptions,
): Promise<number[]> {
  const deadlineMs = options.deadlineMs ?? 2_000
  if (options.fontsReady) await options.fontsReady
  const start = options.now()
  for (;;) {
    const hiding = findPagesHidingContent(root)
    if (hiding.length > 0) return hiding
    const remaining = deadlineMs - (options.now() - start)
    if (remaining <= 0) return []
    // requestAnimationFrame does not fire in a hidden window, so the deadline
    // has to be able to win the race rather than only being checked between
    // frames.
    await (options.afterDelay
      ? Promise.race([options.nextFrame(), options.afterDelay(remaining)])
      : options.nextFrame())
  }
}

function readPagedText(target: HTMLElement): string {
  const pages = target.querySelectorAll('.pagedjs_page_content')
  if (pages.length === 0) return target.textContent ?? ''
  return Array.from(pages)
    .map((page) => page.textContent ?? '')
    .join(' ')
}

export async function paginate(options: PaginateOptions): Promise<PaginationResult> {
  const timeoutMs = options.timeoutMs ?? 10_000
  // Captured before pagination, because the engine consumes the source tree.
  const sourceText = options.source.textContent ?? ''
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
    // With no source text there is nothing to lose, and nothing to read.
    if (normalizeForComparison(sourceText).length > 0) {
      const dropped = findDroppedText(sourceText, readPagedText(options.target))
      if (dropped.length > 0) {
        throw new IncompletePaginationError(`dropped content near "${dropped[0]}"`)
      }
    }
    return { mode: 'pagedjs', pageCount: flow.total ?? countPages(options.target), warnings: [] }
  } catch (cause) {
    options.target.classList.add('pagedjs-failed')
    if (cause instanceof IncompletePaginationError) {
      return {
        mode: 'plain-css',
        pageCount: 0,
        warnings: [{
          code: 'PAGEDJS_INCOMPLETE',
          message: `Paged.js ${cause.reason}; using plain CSS.`,
        }],
      }
    }
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

class IncompletePaginationError extends Error {
  constructor(readonly reason: string) {
    super(`pagination ${reason}`)
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
