# StackEdit Modernization: Phase-One Design

**Status:** Approved design  
**Date:** 2026-08-04  
**Target:** Web and Linux desktop, with KDE Neon/Ubuntu LTS as the initial desktop reference  
**Approach:** Clean shared TypeScript core with selective porting from StackEdit v5 and a thin Rust/Tauri shell

## 1. Context

StackEdit v5.15.4 is a browser-first Vue 2 application whose last release was in May 2023. Its runtime includes a custom editor, IndexedDB and `localStorage` persistence, browser-based OAuth, provider synchronization, a Node server, and server-side Pandoc and wkhtmltopdf export. Its frontend toolchain is based on Vue 2.5, Vuex 3, Webpack 2, Babel 6, Jest 23, and Node Sass 4.

Phase one will not upgrade that architecture in place. It will create a new application using current supported technologies, while treating the old source as a behavioral reference and a source of selected assets, algorithms, fixtures, and interaction ideas.

The product focus is Markdown authoring with excellent live preview and attractive printed/PDF output. Cloud providers and broad StackEdit compatibility are future work.

## 2. Product Decisions

The following decisions are approved:

- One shared application core serves a web application and a Tauri desktop application.
- The new application starts with a clean workspace and does not migrate StackEdit v5 browser data, settings, or credentials.
- Markdown source plus live preview is the initial editor experience.
- Markdown remains the canonical document format. Preview HTML and future WYSIWYG state are derived representations.
- The architecture must permit a future optional WYSIWYG adapter without making it a phase-one deliverable.
- The initial desktop target is Linux x86-64, tested on KDE Neon based on Ubuntu LTS.
- The primary desktop artifact is a Debian package. AppImage may be added after the Debian package is stable.
- Web and desktop workspaces are independent in phase one. Transfer is explicit through Markdown and ZIP import/export.
- Printing and PDF output are phase-one capabilities. PDF is produced through the browser or GTK print dialog rather than a headless one-click exporter.
- Google Drive, GitHub, GitLab, Dropbox, and other providers will be adopted later through provider and synchronization interfaces.

## 3. Goals

Phase one will provide:

1. A modern Vue and TypeScript web application that works offline.
2. A Linux Tauri application using the same UI and application core.
3. Browser workspaces stored in a new IndexedDB database.
4. Desktop workspaces backed by ordinary folders and `.md` files.
5. Safe autosave, recovery, bounded history, and external-change conflict handling.
6. A CodeMirror-based Markdown editor with a synchronized, sanitized preview.
7. CommonMark, GitHub-style Markdown features, footnotes, tasks, syntax-highlighted code, KaTeX, and Mermaid.
8. A first-class Print Studio with page preview, print themes, resource preflight, physical printing, and Save-to-PDF through the system dialog.
9. A reproducible Linux `.deb` release and a test suite covering core, platform, rendering, security, and print behavior.

## 4. Non-Goals

Phase one explicitly excludes:

- Legacy StackEdit data or credential migration.
- Accounts or a hosted application backend.
- Automatic synchronization between web and desktop.
- Google Drive, GitHub, GitLab, Dropbox, CouchDB, Blogger, WordPress, Zendesk, Gist, or similar integrations.
- Collaboration, discussions, comments, or multi-user editing.
- WYSIWYG editing.
- DOCX, EPUB, LaTeX, or other Pandoc formats.
- A one-click headless PDF generator.
- User-supplied JavaScript template helpers.
- Unrestricted custom HTML, CSS, scripts, or remote extensions.
- Windows, macOS, or mobile packages.
- A plugin marketplace.

## 5. Architecture

The application uses dependency inversion around platform operations:

```text
Vue 3 application
  |-- Workspace explorer
  |-- CodeMirror editor
  |-- Live preview
  |-- Print Studio
  `-- Settings
           |
Application services
  |-- DocumentService
  |-- WorkspaceService
  |-- HistoryService
  |-- SearchService
  `-- PrintService
           |
Platform contracts
  |-- WorkspaceRepository
  |-- HistoryRepository
  |-- SettingsRepository
  |-- RecoveryRepository
  |-- FileTransfer
  |-- PrintGateway
  `-- PlatformInfo
       |                   |
Web adapters          Tauri adapters
IndexedDB             Real filesystem
Browser import        Native dialogs
Browser printing      GTK printing
ZIP download          Native folder watching
```

Vue components call application services. They do not directly call IndexedDB, filesystem APIs, or Tauri commands. Core packages contain no Vue, DOM, browser-storage, or Rust assumptions.

The proposed repository layout is:

```text
apps/
  web/              Vue application, PWA entry, and web composition root
  desktop/          Tauri configuration, Rust shell, and desktop composition root
packages/
  core/             Documents, workspaces, history policy, and search
  editor/           CodeMirror adapter and editor session
  markdown/         Parsing, extensions, rendering, and sanitization
  print/            Print document, themes, pagination, and preflight
  platform/         Contracts plus web and Tauri adapters
  ui/               Shared Vue components and design tokens
```

The desktop shell uses official Tauri plugins where they provide the required security and behavior. Custom Rust commands are restricted to operations that require stronger guarantees, particularly atomic file replacement, canonical path validation, and native folder watching.

No hosted backend is required in phase one. The web build is deployable as static assets, and the desktop application performs all core authoring and printing operations offline.

## 6. Technology Choices

The implementation will use stable supported releases pinned at implementation time:

| Area | Choice |
|---|---|
| Workspace | pnpm workspaces |
| Frontend | Vue 3 Composition API and TypeScript |
| Build | Vite |
| UI/session state | Pinia |
| Business logic | Framework-independent application services |
| Editor | CodeMirror 6 |
| Markdown | markdown-it with an explicit extension registry |
| HTML/SVG sanitization | DOMPurify with distinct allowlists |
| Code highlighting | Shiki, cached and kept off the editor's critical path |
| Mathematics | KaTeX |
| Diagrams | Mermaid rendered in isolation and inserted as sanitized static SVG |
| Pagination | Paged.js with plain CSS printing as fallback |
| Web persistence | IndexedDB through a typed repository adapter |
| Desktop shell | Tauri 2 and Rust |
| Desktop metadata/history | SQLite in application data |
| Testing | Vitest, Vue Test Utils, browser end-to-end tests, Rust tests, and visual print fixtures |

The Node version is a supported LTS release compatible with the selected Vite version and is pinned in repository tooling. Rust is pinned through a toolchain file. Lockfiles are committed.

## 7. Document and Workspace Model

The shared document model is deliberately small:

```ts
interface Document {
  id: string
  workspaceId: string
  path: string
  content: string
  contentHash: string
  modifiedAt: number
}
```

Paths are normalized, workspace-relative POSIX-style logical paths inside the core. Platform adapters translate them to platform paths.

### Web identity

Web workspaces and documents receive generated stable IDs. The IndexedDB schema stores workspaces, documents, revisions, recovery entries, and settings. Renaming a web document changes its path but not its ID.

### Desktop identity

A desktop workspace receives a generated ID stored in the application database and associated with its canonical root path. A document ID is mapped to its workspace-relative path in application data. An in-application rename preserves the ID. If an external rename cannot be identified safely, the watcher treats it as deletion plus creation rather than guessing.

The application does not create hidden metadata files in a user's workspace. Moving a complete workspace to a different root may cause it to be recognized as a new workspace; this is acceptable in phase one because document content remains portable.

### Desktop folder content

Markdown files are ordinary user files. Other files are treated as assets and are shown only when relevant. Recent documents, cursor positions, layout preferences, recovery entries, and revision history remain in application data rather than polluting the workspace.

## 8. Saving, Recovery, History, and Conflicts

Editor changes update the active in-memory document immediately. Autosave starts after 750 milliseconds without another content change. Recovery journaling is independent of the final save and occurs at least every two seconds while dirty, on window blur, and before application shutdown when possible.

Desktop saves use this sequence:

1. Verify the target remains within the canonical workspace scope.
2. Compare the last-known modification time and content hash.
3. Write to an adjacent temporary file.
4. Flush and close the temporary file.
5. Atomically replace the target where the filesystem supports it.
6. Update the known hash and modification time only after success.

Web saves use one IndexedDB transaction so failure leaves the previous committed document intact.

A native desktop watcher observes workspace changes. If the editor buffer is clean, external changes reload automatically with a visible notice. If both the editor and external file changed, the application creates a conflict record and preserves both versions. The conflict view offers keep local, accept external, save both, or manual merge. No automatic conflict choice may discard content.

History is bounded. Each document retains its most recent 50 meaningful revisions plus at most one daily snapshot for 30 days. Restoring a revision loads it into the editor as a dirty change or writes a separate recovered file; it does not silently overwrite the current version.

Desktop deletion uses the operating-system trash when supported. If trash is unavailable, permanent deletion requires an explicit confirmation. Web deletion is represented as a recoverable workspace change until history retention expires.

## 9. Editor and Preview

CodeMirror is isolated behind an `EditorAdapter`. Vue components do not persist CodeMirror state as document content. An `EditorSession` coordinates editor transactions, autosave, recovery, preview refresh, and conflict state.

Phase-one editor behavior includes:

- Markdown syntax highlighting.
- Undo and redo.
- Search and replace.
- Multiple selections.
- Configurable line wrapping, indentation, and line numbers.
- Keyboard shortcuts with visible menu equivalents.
- Bracket and Markdown-marker matching.
- Native spellchecking where supported.
- Current-line and selection highlighting.

The Markdown pipeline is:

```text
Markdown source
  -> parser and registered extensions
  -> tokens with source-line positions
  -> HTML generation
  -> sanitization
  -> live preview or Print Studio
```

Initial extensions support CommonMark, tables, strikethrough, task lists, footnotes, heading anchors, a table of contents, fenced-code highlighting, KaTeX, Mermaid, and sanitized inline HTML.

Rendered block elements retain source-line information. Scroll synchronization maps the editor's visible source position to corresponding preview blocks and interpolates between neighboring mappings. It does not rely on equal editor and preview heights.

Rendering is debounced. Mathematics, highlighted code, and diagrams are cached by content hash and rendering configuration. The renderer contract permits parsing to move to a web worker if large-document profiling shows that it is needed.

## 10. Mermaid and SVG Rendering

Mermaid fenced blocks are supported in live preview and printed output. Mermaid source is never inserted as HTML and is not executed in the privileged application window.

The rendering pipeline is:

```text
Mermaid source
  -> isolated renderer without Tauri capabilities
  -> Mermaid strict security configuration
  -> generated SVG string
  -> SVG-specific sanitization
  -> inert static SVG in preview and print output
```

The renderer uses a current patched Mermaid release, `securityLevel: "strict"`, and `htmlLabels: false`. It has no access to Tauri APIs or application repositories. Its Content Security Policy blocks network access, including external diagram images.

The final SVG allowlist removes scripts, event-handler attributes, `foreignObject`, unsafe style constructs, external URLs, and external resource references. Diagram click handlers are disabled. The sanitized result receives a responsive `viewBox` and is cached by source, theme, and Mermaid version.

Invalid Mermaid syntax produces a localized preview placeholder with a useful error and source location. It cannot crash editing, autosave, or unrelated preview blocks.

Print Studio attempts to keep a diagram on one page. Oversized diagrams use fit-to-page behavior and produce a warning when scaling would make labels unreadable. The UI may recommend landscape orientation.

Security regression tests cover representative diagram families, malformed definitions, resource-loading attempts, CSS injection, HTML injection, script attributes, and known advisory patterns.

## 11. Print Studio and PDF

Print Studio is a dedicated workspace rather than a generic export dialog:

```text
Markdown
  -> shared sanitized HTML
  -> print theme and document settings
  -> Paged.js layout
  -> in-application page preview
  -> window.print()
  -> physical printer or PDF file
```

Paged.js provides pagination, margin content, running headers, page counters, and print-oriented page breaking. Plain CSS printing remains a mandatory fallback. Paged.js behavior on the reference KDE Neon/WebKitGTK environment is an early technical gate; unsupported enhancements are disabled individually rather than blocking printing.

Print Studio supports:

- A4 and Letter paper.
- Portrait and landscape orientation.
- Adjustable page margins.
- Body and code font selection from bundled fonts.
- Font size and line-height controls.
- Article, Report, and Compact themes.
- Optional title page and generated table of contents.
- Page numbers, document title, current-section running header, and optional footer text.
- Color and ink-saving modes.
- Code wrapping or clipping selection.
- Image sizing and alignment.

Themes are versioned CSS packages with declared variables. Phase one exposes safe theme controls rather than arbitrary CSS or JavaScript.

Pagination rules avoid orphaned headings, keep captions with figures, avoid splitting short code blocks and tables, permit unavoidable splits in long content, repeat table headings where supported, and constrain images to printable bounds.

Print remains disabled until bundled fonts, permitted images, KaTeX, Mermaid, and highlighted code finish rendering. A preflight panel lists missing or failed resources. Users may fix them or explicitly print with warnings.

The printable document runs in an isolated view without filesystem, shell, process, updater, or repository capabilities. `window.print()` opens the browser or GTK print dialog. Phase one does not directly write PDF bytes and does not bundle Chromium, wkhtmltopdf, Pandoc, or LaTeX.

## 12. Interface and Workflow

The primary layout contains a command bar, explorer, Markdown editor, preview, and status bar. Explorer, editor, and preview panes are independently resizable. Users can switch between editor-only, split, preview-only, and Print Studio modes. Narrow browser windows use tabs rather than compressing all panes.

Web startup offers recent browser workspaces plus create, import, and open actions. Desktop startup offers recent folders plus native Open Folder and Create Workspace actions. The last document and pane layout are restored when possible.

Explorer operations include create, rename, move, and delete for Markdown files and folders. Autosave state is always visible through concise states such as Saving, Saved, External changes, Conflict, and Offline.

A command palette exposes file, layout, formatting, and print actions. Every keyboard shortcut also has a discoverable menu path.

The visual direction is modern and restrained rather than a pixel-perfect StackEdit copy. It uses system-aware light and dark themes, strong document typography, accessible contrast and focus states, keyboard navigation, and native desktop menu integration where useful.

Phase one contains no accounts, provider buttons, sponsorship UI, publishing panels, or collaboration controls.

## 13. Security Model

The Tauri main window receives only the capabilities required for dialogs, approved workspace operations, and opening external links. Preview and print views receive no native capabilities.

Filesystem access is dynamically scoped to the selected workspace. Paths are canonicalized before use, traversal is rejected, and symlinks cannot escape the permitted root. No shell or arbitrary process execution capability is included.

External links open in the system browser through a narrowly scoped opener. Markdown, HTML, SVG, and print content cannot directly invoke native commands.

Content Security Policy permits bundled application assets and explicit local resource schemes. Runtime evaluation and remote scripts are forbidden. Remote images are blocked by default and can be enabled per workspace; Print Studio reports unloaded remote resources during preflight.

HTML and SVG use separate sanitizer policies. Scripts, event handlers, unsafe URLs, dangerous SVG elements, and active embedded content are rejected.

Phase one has no analytics or automatic crash uploading. Logs omit document content. Future credentials use encrypted secure storage rather than IndexedDB or `localStorage`.

## 14. Error Handling and Diagnostics

Errors are classified as transient, action-required, or conflicts.

- Transient rendering or resource failures remain local to the affected block or panel and offer retry.
- Disk-full, permission, missing-folder, or browser-quota failures pause final autosave while preserving the recovery journal and showing corrective actions.
- Conflicts preserve both versions and open the comparison workflow.

Vue error boundaries isolate the explorer, editor, preview, and Print Studio. A failed extension cannot crash autosave or unrelated panels.

Errors have stable codes and structured context. Desktop logs rotate locally and exclude document content. Diagnostic export contains application and dependency versions, platform details, enabled extensions, and redacted errors. Paths are redacted by default.

Release artifacts include checksums. Dependency manifests and vulnerability audits run in continuous integration. Public package signing is added when a stable public distribution channel is established.

## 15. Testing Strategy

Testing is layered:

1. Unit tests cover core document rules, path normalization, history retention, conflict decisions, and print settings.
2. Contract tests run the same repository behavior against web and desktop adapters.
3. Vue component tests cover explorer actions, editor state, settings, error boundaries, and Print Studio controls.
4. Browser integration tests use real IndexedDB and service-worker behavior.
5. Rust tests cover capability scope, canonical paths, traversal, symlinks, atomic replacement, and watcher event translation.
6. End-to-end tests cover creating, editing, recovering, importing, exporting, conflicting, and printing documents.
7. Rendering fixtures cover CommonMark, tables, code, KaTeX, Mermaid, images, footnotes, and sanitized HTML.
8. Print visual tests compare representative paginated pages. Chromium automation is supplemented with WebKitGTK smoke tests on Linux.
9. Security tests exercise malicious HTML, SVG, Mermaid, paths, URLs, and oversized inputs.
10. Fault-injection tests simulate quota exhaustion, permission errors, disk failures, interrupted writes, and application restarts.

Tests must verify observable behavior rather than private implementation details. Platform contract tests are a release gate because they keep the web and desktop application core genuinely shared.

## 16. Delivery Stages

### Stage 0: Technical proof

On KDE Neon, prove folder selection, atomic Markdown save, external-change detection, Mermaid and KaTeX rendering, Paged.js pagination, GTK print-to-PDF, and `.deb` installation. Failure of an enhancement must identify a fallback before further implementation.

### Stage 1: Shared foundation

Create the monorepo, core models, platform contracts, web IndexedDB adapter, desktop filesystem adapter, settings, history, and recovery repositories, with contract tests.

### Stage 2: Daily editing

Build the Vue shell, explorer, CodeMirror adapter, autosave, recovery, preview, scroll synchronization, search, and conflict workflow.

### Stage 3: Print Studio

Integrate Paged.js, print themes, controls, Mermaid/KaTeX/code/table/image printing, preflight, and GTK print/PDF behavior.

### Stage 4: Release hardening

Complete accessibility and keyboard review, large-document profiling, security audits, recovery fault injection, KDE Neon packaging tests, reproducible `.deb` generation, checksums, and user documentation.

Each stage is a separate implementation plan with its own acceptance checks. Stage 0 is mandatory before committing to deeper implementation of platform-specific or paged-output behavior.

## 17. Phase-One Acceptance Criteria

Phase one is complete only when:

1. The web application can create, edit, recover, search, import, export, and print a workspace offline.
2. The `.deb` installs, launches, and uninstalls correctly on the KDE Neon reference system.
3. The desktop application can open a normal folder and safely create, rename, move, delete, and externally modify Markdown files.
4. Markdown preview and printed output render representative text, tables, code, mathematics, images, footnotes, and Mermaid diagrams.
5. Mermaid output is static sanitized SVG with no Tauri access, external resource load, or script execution.
6. Print Studio produces attractive A4 and Letter PDF output through the standard print dialog.
7. Crashes, quota failures, disk failures, and conflicting edits do not silently discard content.
8. Preview and print content cannot invoke Tauri commands or execute embedded scripts.
9. Filesystem permissions and path handling cannot escape the selected workspace.
10. Core editing and printing work without network access.
11. Web and desktop repository implementations pass the same behavioral contract suite.
12. Future provider integration can be added without changing the canonical document model.

## 18. Future Provider Compatibility

Provider work begins only after phase-one acceptance. A provider supplies authentication, remote listing, download, upload, revision metadata, and optional change polling through explicit interfaces. Synchronization consumes those interfaces and the shared document repository; it does not add provider-specific state to Vue components or Markdown content.

Providers that require a private OAuth secret may require a small hosted broker. Secrets are never embedded in the web bundle or Tauri binary. Desktop credentials use secure encrypted storage. Each provider is independently optional and testable.

Initial candidates are GitHub/GitLab and Google Drive, but their order is not part of phase one.

## 19. Implementation and Review Loop

The workflow for later implementation is:

1. **Planning:** a planner creates or approves the detailed implementation plan for each delivery stage.
2. **Coding and testing:** an implementer implements the selected plan task and runs its prescribed tests.
3. **Escalation:** if the same task has completed two substantive attempts without satisfying its acceptance checks, assign the next attempt to a second implementer, with the failure evidence and current worktree state.
4. **Final review:** after implementation and prescribed tests are complete, an independent reviewer examines the resulting diff, test evidence, architecture conformance, and security boundaries.

An attempt counts only when it produces an implementation or a documented technical blocker and executes all feasible prescribed checks. Interruptions, unavailable tooling, or a task that was never started do not consume an attempt.

No implementation is considered complete solely because its implementer reports success. Completion requires fresh verification evidence and the final independent review.

Roles are filled as specified above. If a role cannot be filled, work pauses and reports the mismatch rather than silently reassigning it.

## 20. External Technical References

- [Vue 2 end-of-life notice](https://v2.vuejs.org/eol/)
- [Vue tooling guidance](https://vuejs.org/guide/scaling-up/tooling)
- [Vite getting started and runtime requirements](https://vite.dev/guide/)
- [Tauri process model](https://v2.tauri.app/concept/process-model/)
- [Tauri capabilities](https://v2.tauri.app/security/capabilities/)
- [Tauri Debian packaging](https://v2.tauri.app/distribute/debian/)
- [Tauri AppImage packaging](https://v2.tauri.app/distribute/appimage/)
- [Tauri webview printing](https://docs.rs/tauri/latest/tauri/webview/struct.WebviewWindow.html)
- [Paged.js](https://github.com/pagedjs/pagedjs/)
- [CSS printing](https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Media_queries/Printing)
- [CSS paged media](https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Paged_media)
- [Mermaid security configuration](https://mermaid.js.org/config/schema-docs/config-properties-securitylevel.html)
- [Mermaid security advisories](https://github.com/mermaid-js/mermaid/security)

