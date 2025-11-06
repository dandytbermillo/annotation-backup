/**
 * Shared note utilities
 * Used across the app for consistent note creation, tracking, and recent notes management
 */

interface CreateNoteOptions {
  name?: string
  parentId?: string | null
  metadata?: Record<string, any>
  initialPosition?: { x: number; y: number } | null
  workspaceId?: string | null
}

interface CreateNoteResult {
  success: boolean
  noteId?: string
  error?: string
}

/**
 * Track note access in recent notes (database-only)
 * Extracted from notes-explorer-phase1.tsx for reuse across active components
 * @throws Error if tracking fails (non-2xx response or network error)
 */
export async function trackNoteAccess(noteId: string): Promise<void> {
  try {
    const response = await fetch('/api/items/recent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ itemId: noteId })
    })

    if (!response.ok) {
      throw new Error(`Failed to track note access: ${response.status} ${response.statusText}`)
    }
  } catch (error) {
    console.error('Failed to track note access:', error)
    throw error // Re-throw so .then() doesn't execute on failure
  }
}

/**
 * Fetch recent notes from API
 * Extracted from notes-explorer-phase1.tsx for reuse across active components
 */
export async function fetchRecentNotes(limit: number = 5): Promise<any[]> {
  try {
    const response = await fetch(`/api/items/recent?limit=${limit}`)
    if (!response.ok) throw new Error('Failed to fetch recent items')

    const data = await response.json()
    return data.items || []
  } catch (error) {
    console.error('Error fetching recent notes:', error)
    return []
  }
}

/**
 * Creates a new note using the Phase 1 API
 * Matches the behavior of notes-explorer-phase1.tsx createNewNote function
 */
export async function createNote(options: CreateNoteOptions = {}): Promise<CreateNoteResult> {
  try {
    const { name, parentId = null, metadata = {}, initialPosition = null, workspaceId = null } = options

    const applyWorkspaceHeaders = (headers: Record<string, string>) => {
      if (workspaceId) {
        headers['X-Overlay-Workspace-ID'] = workspaceId
      }
      return headers
    }

    // Generate default name if not provided
    const timestamp = new Date().toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    })
    const noteName = name?.trim() || `New Note - ${timestamp}`

    // Determine parent folder
    let finalParentId = parentId

    // If no parent specified, try to find "Uncategorized" folder
    if (finalParentId === null || finalParentId === undefined) {
      try {
        // Fetch all folders and search for Uncategorized (it's nested under Knowledge Base)
        const folderParams = new URLSearchParams({ type: 'folder' })
        if (workspaceId) {
          folderParams.set('workspaceId', workspaceId)
        }
        const foldersResponse = await fetch(`/api/items?${folderParams.toString()}`, {
          headers: applyWorkspaceHeaders({ Accept: 'application/json' })
        })
        if (foldersResponse.ok) {
          const data = await foldersResponse.json()
          // Search by path since Uncategorized is at /knowledge-base/uncategorized
          const uncategorized = data.items?.find((item: any) =>
            item.type === 'folder' &&
            (item.path === '/knowledge-base/uncategorized' || item.name === 'Uncategorized')
          )
          finalParentId = uncategorized?.id || null
          console.log('[createNote] Found Uncategorized folder:', uncategorized?.id, uncategorized?.path)
        }
      } catch (err) {
        console.warn('[createNote] Could not find Uncategorized folder, creating in root')
      }
    }

    // Create the note
    const response = await fetch('/api/items', {
      method: 'POST',
      headers: applyWorkspaceHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        type: 'note',
        name: noteName,
        parentId: finalParentId,
        metadata,
        initialPosition,
        workspaceId: workspaceId ?? undefined
      })
    })

    if (!response.ok) {
      let errorDetails = `HTTP ${response.status} ${response.statusText}`
      try {
        const text = await response.text()
        if (text) {
          try {
            const errorData = JSON.parse(text)
            errorDetails = errorData.error || text
          } catch {
            errorDetails = text
          }
        }
      } catch (e) {
        console.error('[createNote] Failed to read error response:', e)
      }
      throw new Error(`Failed to create note: ${errorDetails}`)
    }

    const data = await response.json()
    const noteId = data.item.id

    // Track the new note as recently accessed
    await trackNoteAccess(noteId)

    return {
      success: true,
      noteId
    }
  } catch (error) {
    console.error('[createNote] Error:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}

/**
 * Helper to get available folders for note creation
 */
export async function getAvailableFolders(): Promise<any[]> {
  try {
    const response = await fetch('/api/items?parentId=null')
    if (!response.ok) return []

    const data = await response.json()
    return data.items?.filter((item: any) => item.type === 'folder') || []
  } catch (error) {
    console.error('[getAvailableFolders] Error:', error)
    return []
  }
}
