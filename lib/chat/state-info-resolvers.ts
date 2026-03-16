/**
 * State-Info Resolvers (6x.8 Phase 3)
 *
 * Deterministic resolvers that answer "what is open/active" queries
 * from live UI/session state. No LLM. No freeform generation.
 */

/**
 * Resolve note state-info queries from UI context.
 *
 * Returns a bounded human-readable answer string.
 */
export function resolveNoteStateInfo(uiContext: {
  workspace?: {
    activeNoteId?: string | null
    openNotes?: Array<{ id: string; title?: string }>
  }
}): string {
  const activeNoteId = uiContext?.workspace?.activeNoteId
  if (!activeNoteId) return 'No note is currently open.'

  const notes = uiContext?.workspace?.openNotes ?? []
  const activeNote = notes.find(n => n.id === activeNoteId)
  const title = activeNote?.title ?? 'Untitled'

  if (notes.length > 1) {
    return `The active note is ${title}. ${notes.length} notes are open.`
  }
  return `The open note is ${title}.`
}
