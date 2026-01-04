/**
 * Notes Write Bridge API Handlers
 * Phase 3.3: Permission Gating + Write APIs
 *
 * Write handlers for note operations (require write:notes permission).
 */

// =============================================================================
// Types
// =============================================================================

/** Params for updateNote */
export interface UpdateNoteParams {
  noteId: string
  content?: string
  title?: string
}

/** Params for createNote */
export interface CreateNoteParams {
  title: string
  content?: string
  parentId?: string
}

/** Params for deleteNote */
export interface DeleteNoteParams {
  noteId: string
}

/** Result for write operations */
export interface NoteWriteResult {
  success: boolean
  noteId?: string
  error?: string
}

/** Callbacks for notes write operations */
export interface NotesWriteCallbacks {
  updateNote?: (params: { noteId: string; content?: string; title?: string }) => Promise<boolean>
  createNote?: (params: { title: string; content?: string; parentId?: string }) => Promise<string | null>
  deleteNote?: (noteId: string) => Promise<boolean>
}

// =============================================================================
// Handler Functions
// =============================================================================

/**
 * Update a note's content or title
 * Permission: write:notes
 */
export async function handleUpdateNote(
  params: UpdateNoteParams,
  callbacks: NotesWriteCallbacks
): Promise<NoteWriteResult> {
  if (!params.noteId) {
    return { success: false, error: 'noteId is required' }
  }

  if (params.content === undefined && params.title === undefined) {
    return { success: false, error: 'content or title is required' }
  }

  if (!callbacks.updateNote) {
    return { success: false, error: 'updateNote not implemented' }
  }

  try {
    const success = await callbacks.updateNote({
      noteId: params.noteId,
      content: params.content,
      title: params.title,
    })
    return { success, noteId: params.noteId }
  } catch (error) {
    console.error('[BridgeAPI] Error updating note:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

/**
 * Create a new note
 * Permission: write:notes
 */
export async function handleCreateNote(
  params: CreateNoteParams,
  callbacks: NotesWriteCallbacks
): Promise<NoteWriteResult> {
  if (!params.title) {
    return { success: false, error: 'title is required' }
  }

  if (!callbacks.createNote) {
    return { success: false, error: 'createNote not implemented' }
  }

  try {
    const noteId = await callbacks.createNote({
      title: params.title,
      content: params.content,
      parentId: params.parentId,
    })
    if (noteId) {
      return { success: true, noteId }
    }
    return { success: false, error: 'Failed to create note' }
  } catch (error) {
    console.error('[BridgeAPI] Error creating note:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

/**
 * Delete a note
 * Permission: write:notes
 */
export async function handleDeleteNote(
  params: DeleteNoteParams,
  callbacks: NotesWriteCallbacks
): Promise<NoteWriteResult> {
  if (!params.noteId) {
    return { success: false, error: 'noteId is required' }
  }

  if (!callbacks.deleteNote) {
    return { success: false, error: 'deleteNote not implemented' }
  }

  try {
    const success = await callbacks.deleteNote(params.noteId)
    return { success, noteId: params.noteId }
  } catch (error) {
    console.error('[BridgeAPI] Error deleting note:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}
