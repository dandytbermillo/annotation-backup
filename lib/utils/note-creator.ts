import { debugLog } from "@/lib/utils/debug-logger"

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
      console.warn(`Failed to track note access: ${response.status} ${response.statusText}`)
      return
    }
  } catch (error) {
    console.error('Failed to track note access:', error)
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

let cachedWorkspaceId: string | null = null

async function resolveDefaultWorkspaceId(): Promise<string | null> {
  if (cachedWorkspaceId) {
    debugLog({
      component: "createNote",
      action: "workspace_cached",
      metadata: { workspaceId: cachedWorkspaceId },
    })
    return cachedWorkspaceId
  }
  debugLog({
    component: "createNote",
    action: "workspace_resolve_start",
  })
  try {
    const response = await fetch('/api/items?parentId=null', { cache: 'no-store' })
    if (!response.ok) return null
    const data = await response.json().catch(() => null)
    const items: any[] = Array.isArray(data?.items) ? data!.items : []
    const knowledgeBase = items.find((item: any) => typeof item?.name === 'string' && item.name.toLowerCase() === 'knowledge base')
    const workspaceFromRoot = typeof data?.workspaceId === 'string' ? data.workspaceId : null
    cachedWorkspaceId = knowledgeBase?.workspaceId ?? workspaceFromRoot ?? null
    debugLog({
      component: "createNote",
      action: cachedWorkspaceId ? "workspace_resolve_success" : "workspace_resolve_empty",
      metadata: { workspaceId: cachedWorkspaceId ?? undefined },
    })
    return cachedWorkspaceId
  } catch (error) {
    console.warn('[createNote] Failed to auto-resolve workspace id:', error)
    debugLog({
      component: "createNote",
      action: "workspace_resolve_error",
      metadata: { error: error instanceof Error ? error.message : String(error) },
    })
    return null
  }
}

/**
 * Creates a new note using the Phase 1 API
 * Matches the behavior of notes-explorer-phase1.tsx createNewNote function
 */
export async function createNote(options: CreateNoteOptions = {}): Promise<CreateNoteResult> {
  try {
    const { name, parentId = null, metadata = {}, initialPosition = null } = options
    debugLog({
      component: "createNote",
      action: "start",
      metadata: {
        providedWorkspaceId: options.workspaceId ?? null,
        hasParentId: parentId != null,
      },
    })

    let targetWorkspaceId = options.workspaceId ?? cachedWorkspaceId
    if (!targetWorkspaceId) {
      targetWorkspaceId = await resolveDefaultWorkspaceId()
    }
    if (targetWorkspaceId) {
      cachedWorkspaceId = targetWorkspaceId
    } else {
      debugLog({
        component: "createNote",
        action: "workspace_unresolved",
      })
    }

    const applyWorkspaceHeaders = (headers: Record<string, string>) => {
      if (targetWorkspaceId) {
        headers['X-Overlay-Workspace-ID'] = targetWorkspaceId
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

    // Determine parent folder (must live under /knowledge-base)
    let finalParentId = parentId

    const loadWorkspaceFolders = async () => {
      try {
        const folderParams = new URLSearchParams({ type: 'folder' })
        if (targetWorkspaceId) {
          folderParams.set('workspaceId', targetWorkspaceId)
        }
        const response = await fetch(`/api/items?${folderParams.toString()}`, {
          headers: applyWorkspaceHeaders({ Accept: 'application/json' })
        })
        if (!response.ok) return []
        const data = await response.json()
        return Array.isArray(data.items) ? data.items : []
      } catch (error) {
        console.warn('[createNote] Failed to load workspace folders:', error)
        return []
      }
    }

    const loadKnowledgeBaseRoot = async () => {
      try {
        const response = await fetch('/api/items?parentId=null', {
          headers: applyWorkspaceHeaders({ Accept: 'application/json' })
        })
        if (!response.ok) return null
        const data = await response.json()
        const items: any[] = Array.isArray(data.items) ? data.items : []
        return items.find(
          (item: any) => typeof item?.name === 'string' && item.name.toLowerCase() === 'knowledge base'
        ) ?? null
      } catch (error) {
        console.warn('[createNote] Failed to load Knowledge Base root:', error)
        return null
      }
    }

    const findUncategorizedFolder = async () => {
      const folders = await loadWorkspaceFolders()
      return folders.find(
        (item: any) =>
          item.type === 'folder' &&
          (item.path === '/knowledge-base/uncategorized' || item.name === 'Uncategorized')
      ) ?? null
    }

    if (finalParentId === null || finalParentId === undefined) {
      const uncategorized = await findUncategorizedFolder()
      if (uncategorized?.id) {
        finalParentId = uncategorized.id
        console.log('[createNote] Using Uncategorized folder:', uncategorized.id)
        debugLog({
          component: "createNote",
          action: "parent_uncategorized",
          metadata: { parentId: finalParentId },
        })
      }
    }

    if (finalParentId === null || finalParentId === undefined) {
      const knowledgeBase = await loadKnowledgeBaseRoot()
      if (knowledgeBase?.id) {
        finalParentId = knowledgeBase.id
        console.log('[createNote] Using Knowledge Base root:', knowledgeBase.id)
        debugLog({
          component: "createNote",
          action: "parent_knowledge_base",
          metadata: { parentId: finalParentId },
        })
      }
    }

    if (finalParentId === null || finalParentId === undefined) {
      throw new Error('Unable to locate Knowledge Base root. Please ensure the Knowledge Base folder exists.')
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
        workspaceId: targetWorkspaceId ?? undefined
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

    debugLog({
      component: "createNote",
      action: "success",
      metadata: { noteId, workspaceId: targetWorkspaceId ?? null, parentId: finalParentId },
    })

    return {
      success: true,
      noteId
    }
  } catch (error) {
    console.error('[createNote] Error:', error)
    debugLog({
      component: "createNote",
      action: "error",
      metadata: { error: error instanceof Error ? error.message : String(error) },
    })
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
