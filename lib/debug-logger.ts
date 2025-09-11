// Debug logger for tracking content persistence issues
let sessionId = typeof window !== 'undefined' 
  ? `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
  : 'server'

export async function debugLog(
  component: string,
  action: string,
  data: {
    noteId?: string
    panelId?: string
    contentPreview?: string
    metadata?: any
  }
) {
  try {
    // Log to console
    console.log(`[DEBUG ${component}] ${action}:`, data)
    
    // Log to database
    await fetch('/api/debug-log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        component,
        action,
        noteId: data.noteId,
        panelId: data.panelId,
        contentPreview: data.contentPreview?.substring(0, 500), // Limit preview size
        metadata: data.metadata,
        sessionId
      })
    })
  } catch (error) {
    console.error('[Debug Logger] Failed to log:', error)
  }
}

export function getSessionId() {
  return sessionId
}

// Helper to create a content preview
export function createContentPreview(content: any): string {
  if (!content) return 'null'
  if (typeof content === 'string') return content.substring(0, 100)
  try {
    const str = JSON.stringify(content)
    return str.substring(0, 200)
  } catch {
    return 'invalid content'
  }
}