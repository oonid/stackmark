import {
  UnsupportedOnWebError,
  type ExternalChange,
  type Unsubscribe,
  type WorkspaceHost,
} from '../contracts'

/**
 * The browser has no workspace.
 *
 * A browser document lives in IndexedDB, not in a folder the user chose, so
 * there is nothing to adopt and nothing outside the application that can change
 * it. Every method rejects rather than resolving with an empty result: a caller
 * that waits forever for changes which cannot arrive is a worse failure than
 * one that is told immediately, and `supported` exists so a caller can ask
 * before it commits to the interaction.
 */
export function createWebWorkspaceHost(): WorkspaceHost {
  return {
    supported: false,

    adopt(): Promise<string | null> {
      return Promise.reject(new UnsupportedOnWebError('choosing a workspace folder'))
    },

    current(): Promise<string | null> {
      return Promise.reject(new UnsupportedOnWebError('reading the current workspace folder'))
    },

    watch(listener: (change: ExternalChange) => void): Promise<Unsubscribe> {
      void listener
      return Promise.reject(new UnsupportedOnWebError('watching a workspace folder'))
    },
  }
}
