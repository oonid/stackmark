import { describe, expect, it } from 'vitest'

import { InvalidPathError, normalizeWorkspacePath } from './path'

describe('normalizeWorkspacePath', () => {
  it('collapses redundant separators and current-directory segments', () => {
    expect(normalizeWorkspacePath('notes//./daily.md')).toBe('notes/daily.md')
  })

  it('keeps an already-normal path unchanged', () => {
    expect(normalizeWorkspacePath('notes/daily.md')).toBe('notes/daily.md')
  })

  it('rejects a path that escapes the workspace', () => {
    expect(() => normalizeWorkspacePath('../secrets.md')).toThrow(InvalidPathError)
  })

  it('rejects a parent segment in the middle, which also escapes', () => {
    expect(() => normalizeWorkspacePath('notes/../../secrets.md')).toThrow(InvalidPathError)
  })

  it('rejects an absolute path', () => {
    expect(() => normalizeWorkspacePath('/etc/passwd')).toThrow(InvalidPathError)
  })

  it('rejects a backslash, which some platforms treat as a separator', () => {
    expect(() => normalizeWorkspacePath('notes\\daily.md')).toThrow(InvalidPathError)
  })

  it('rejects a NUL byte, which truncates a path inside a C string', () => {
    expect(() => normalizeWorkspacePath('notes/daily.md\u0000.png')).toThrow(InvalidPathError)
  })

  it('rejects an empty path', () => {
    expect(() => normalizeWorkspacePath('')).toThrow(InvalidPathError)
  })

  it('rejects a path that is only separators and dots', () => {
    expect(() => normalizeWorkspacePath('.//.')).toThrow(InvalidPathError)
  })
})
