/**
 * Workspace-relative path handling.
 *
 * Paths inside the core are normalized, workspace-relative and POSIX-style.
 * Platform adapters translate them to platform paths; nothing here knows what a
 * filesystem is.
 *
 * The desktop side confines every resolution beneath a held root descriptor, so
 * this is not the security boundary. It is the layer that refuses a path the
 * boundary would have to reject anyway, close to where a mistake is made and
 * with a readable error.
 */

export class InvalidPathError extends Error {
  constructor(reason: string, readonly path: string) {
    super(`invalid workspace path (${reason}): ${JSON.stringify(path)}`)
    this.name = 'InvalidPathError'
  }
}

/**
 * Normalizes a workspace-relative path, or throws.
 *
 * Collapses empty and current-directory segments. Refuses anything absolute,
 * anything escaping the workspace, and the two characters that mean different
 * things to different layers: a backslash, which some platforms read as a
 * separator, and a NUL, which truncates a path inside a C string — so
 * `notes.md\0.png` would pass a suffix check and open `notes.md`.
 */
export function normalizeWorkspacePath(input: string): string {
  if (input.length === 0) throw new InvalidPathError('empty', input)
  if (input.startsWith('/')) throw new InvalidPathError('absolute', input)
  if (input.includes('\\')) throw new InvalidPathError('backslash', input)
  if (input.includes('\u0000')) throw new InvalidPathError('NUL byte', input)

  const segments: string[] = []
  for (const segment of input.split('/')) {
    if (segment === '' || segment === '.') continue
    // Resolving `..` against the segments collected so far would still let a
    // path escape when it climbs past the root, and quietly accepting
    // `a/../b` invites the caller to believe traversal is handled. Refusing
    // outright keeps one rule with no cases.
    if (segment === '..') throw new InvalidPathError('escapes the workspace', input)
    segments.push(segment)
  }

  if (segments.length === 0) throw new InvalidPathError('empty after normalizing', input)
  return segments.join('/')
}
