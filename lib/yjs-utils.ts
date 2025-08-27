import * as Y from 'yjs'

// Track loading state for Y.Docs
export const docLoadingStates = new Map<string, Promise<void>>()

// Helper to wait for Y.Doc to load from persistence
export async function waitForDocLoad(docKey: string): Promise<void> {
  const loadingPromise = docLoadingStates.get(docKey)
  if (loadingPromise) {
    await loadingPromise
  }
}

// Helper to check if doc is still loading
export function isDocLoading(docKey: string): boolean {
  return docLoadingStates.has(docKey)
}

// Clear loading state
export function clearDocLoadingState(docKey: string): void {
  docLoadingStates.delete(docKey)
}