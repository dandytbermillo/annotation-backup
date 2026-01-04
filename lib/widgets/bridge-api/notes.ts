/**
 * Notes Bridge API Handlers
 * Phase 3.2: Widget Bridge Handler Wiring (Read-Only)
 *
 * Pure functions that transform note state into bridge responses.
 * These are called by the sandbox bridge when widgets request note data.
 */

// =============================================================================
// Types
// =============================================================================

/** Maximum content preview length to avoid overexposure */
const MAX_CONTENT_PREVIEW_LENGTH = 500

/** Minimal note info returned to widgets (read-only) */
export interface BridgeNoteInfo {
  id: string
  title: string
  /** Content preview (first N characters, not full content) */
  contentPreview: string
  /** Whether full content was truncated */
  isTruncated: boolean
}

/** Input state for notes handlers */
export interface NotesHandlerState {
  /** Currently open/active note (if any) */
  currentNote: {
    id: string
    title: string
    content: string
  } | null
  /** Function to fetch a note by ID (async) */
  getNoteById?: (noteId: string) => Promise<{
    id: string
    title: string
    content: string
  } | null>
}

// =============================================================================
// Response Types
// =============================================================================

export interface GetCurrentNoteResponse {
  note: BridgeNoteInfo | null
}

export interface GetNoteResponse {
  note: BridgeNoteInfo | null
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Create a content preview (truncate if needed)
 */
function createContentPreview(content: string): { preview: string; isTruncated: boolean } {
  if (content.length <= MAX_CONTENT_PREVIEW_LENGTH) {
    return { preview: content, isTruncated: false }
  }
  return {
    preview: content.slice(0, MAX_CONTENT_PREVIEW_LENGTH) + '...',
    isTruncated: true,
  }
}

/**
 * Transform note data to bridge format
 */
function toBridgeNoteInfo(note: { id: string; title: string; content: string }): BridgeNoteInfo {
  const { preview, isTruncated } = createContentPreview(note.content)
  return {
    id: note.id,
    title: note.title,
    contentPreview: preview,
    isTruncated,
  }
}

// =============================================================================
// Handler Functions
// =============================================================================

/**
 * Get the currently open note
 * Permission: read:notes
 */
export function handleGetCurrentNote(state: NotesHandlerState): GetCurrentNoteResponse {
  if (!state.currentNote) {
    return { note: null }
  }

  return {
    note: toBridgeNoteInfo(state.currentNote),
  }
}

/**
 * Get a note by ID
 * Permission: read:notes
 *
 * Note: This is async because it may need to fetch from API
 */
export async function handleGetNote(
  state: NotesHandlerState,
  params: { noteId: string }
): Promise<GetNoteResponse> {
  // If it's the current note, return it directly
  if (state.currentNote && state.currentNote.id === params.noteId) {
    return {
      note: toBridgeNoteInfo(state.currentNote),
    }
  }

  // Otherwise, try to fetch via the provided function
  if (!state.getNoteById) {
    // No fetch function provided, can't get other notes
    return { note: null }
  }

  try {
    const note = await state.getNoteById(params.noteId)
    if (!note) {
      return { note: null }
    }
    return {
      note: toBridgeNoteInfo(note),
    }
  } catch (error) {
    console.error('[BridgeAPI] Error fetching note:', error)
    return { note: null }
  }
}
