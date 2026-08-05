declare module 'pagedjs' {
  export class Previewer {
    preview(source: HTMLElement, stylesheets: string[], target: HTMLElement): Promise<{ total?: number }>
  }
}
