/**
 * Chat Navigation Context
 *
 * Provides shared state for chat navigation messages across different
 * component instances (DashboardDock, canvas-control-center).
 *
 * This ensures messages persist when switching between dashboard and workspace modes.
 * Also tracks session state for informational intents (location_info, last_action, session_stats).
 *
 * Phase 2: Persistence - Messages are stored in the database and restored on reload.
 */

'use client'

import { createContext, useContext, useState, useCallback, useEffect, useRef, type ReactNode } from 'react'
import type { WorkspaceMatch, NoteMatch, EntryMatch } from './resolution-types'
import type { SessionState } from './intent-prompt'
import type { ViewPanelContent, ViewListItem } from './view-panel-types'

// =============================================================================
// Types
// =============================================================================

export interface QuickLinksPanelData {
  panelId: string
  badge: string
  panelType: 'quick_links'
}

export interface PanelIntentData {
  panelId: string
  intentName: string
  params: Record<string, unknown>
}

export interface SelectionOption {
  type: 'workspace' | 'note' | 'entry' | 'confirm_delete' | 'quick_links_panel' | 'confirm_panel_write'
  id: string
  label: string
  sublabel?: string
  data: WorkspaceMatch | NoteMatch | EntryMatch | QuickLinksPanelData | PanelIntentData
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: Date
  options?: SelectionOption[]
  isError?: boolean
  // View panel content (for "Show all" preview)
  viewPanelContent?: ViewPanelContent
  previewItems?: ViewListItem[]
  totalCount?: number
  // Drawer target for "Show all" when panel preview maps to a panel
  drawerPanelId?: string
  drawerPanelTitle?: string
}

// Re-export SessionState for convenience
export type { SessionState }

// Last action type for tracking
export interface LastAction {
  type: 'open_workspace' | 'open_entry' | 'rename_workspace' | 'delete_workspace' | 'create_workspace' | 'go_to_dashboard' | 'go_home'
  workspaceId?: string
  workspaceName?: string
  entryId?: string
  entryName?: string
  fromName?: string
  toName?: string
  timestamp: number
}

interface ChatNavigationContextValue {
  messages: ChatMessage[]
  addMessage: (message: ChatMessage) => void
  clearMessages: () => void
  input: string
  setInput: (input: string) => void
  isOpen: boolean
  setOpen: (open: boolean) => void
  openChat: () => void
  closeChat: () => void
  // Session state for informational intents
  sessionState: SessionState
  setCurrentLocation: (viewMode: 'dashboard' | 'workspace', entryId?: string, entryName?: string, workspaceId?: string, workspaceName?: string) => void
  setLastAction: (action: LastAction) => void
  incrementOpenCount: (id: string, name: string, type: 'workspace' | 'entry') => void
  setLastQuickLinksBadge: (badge: string) => void
  // Persistence
  conversationId: string | null
  isLoadingHistory: boolean
  hasMoreMessages: boolean
  loadOlderMessages: () => Promise<void>
  conversationSummary: string | null
  // Session divider: count of messages loaded from history (for rendering divider)
  initialMessageCount: number
  // Panel visibility for intent prioritization (Gap 2)
  visiblePanels: string[]
  focusedPanelId: string | null
  setVisiblePanels: (panelIds: string[]) => void
  setFocusedPanelId: (panelId: string | null) => void
  registerVisiblePanel: (panelId: string) => void
  unregisterVisiblePanel: (panelId: string) => void
}

// =============================================================================
// API Helpers
// =============================================================================

interface DbMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  metadata: {
    options?: SelectionOption[]
    isError?: boolean
    intent?: string
    entryContext?: { id: string; name: string }
    workspaceContext?: { id: string; name: string }
  } | null
  createdAt: string
}

async function getOrCreateConversation(): Promise<{
  id: string
  summary: string | null
  lastAction: LastAction | null
} | null> {
  try {
    const response = await fetch('/api/chat/conversations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scope: 'global' }),
    })
    if (!response.ok) return null
    const data = await response.json()
    return {
      id: data.conversation.id,
      summary: data.conversation.summary,
      lastAction: data.conversation.lastAction || null,
    }
  } catch {
    return null
  }
}

async function fetchMessages(
  conversationId: string,
  cursor?: string
): Promise<{ messages: DbMessage[]; nextCursor: string | null } | null> {
  try {
    const url = new URL(`/api/chat/conversations/${conversationId}/messages`, window.location.origin)
    if (cursor) url.searchParams.set('cursor', cursor)
    url.searchParams.set('limit', '30')

    const response = await fetch(url.toString())
    if (!response.ok) return null
    return await response.json()
  } catch {
    return null
  }
}

async function persistMessage(
  conversationId: string,
  role: 'user' | 'assistant',
  content: string,
  metadata?: Record<string, unknown>
): Promise<DbMessage | null> {
  try {
    const response = await fetch(`/api/chat/conversations/${conversationId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role, content, metadata }),
    })
    if (!response.ok) return null
    const data = await response.json()
    return data.message
  } catch {
    return null
  }
}

async function triggerSummarization(conversationId: string): Promise<string | null> {
  try {
    const response = await fetch(`/api/chat/conversations/${conversationId}/summary`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    if (!response.ok) return null
    const data = await response.json()
    if (data.updated && data.summary) {
      return data.summary
    }
    return null
  } catch {
    return null
  }
}

async function clearConversation(conversationId: string): Promise<boolean> {
  try {
    // Delete all messages and reset summary
    const response = await fetch(`/api/chat/conversations/${conversationId}/messages`, {
      method: 'DELETE',
    })
    return response.ok
  } catch {
    return false
  }
}

// =============================================================================
// Session State API Helpers (dedicated table)
// =============================================================================

async function fetchSessionState(
  conversationId: string
): Promise<{
  openCounts?: SessionState['openCounts']
  lastAction?: LastAction
  lastQuickLinksBadge?: SessionState['lastQuickLinksBadge']
} | null> {
  try {
    const response = await fetch(`/api/chat/session-state?conversationId=${conversationId}`)
    if (!response.ok) return null
    const data = await response.json()
    return data.sessionState || null
  } catch {
    return null
  }
}

async function persistSessionState(
  conversationId: string,
  sessionState: {
    openCounts?: SessionState['openCounts']
    lastAction?: LastAction
    lastQuickLinksBadge?: SessionState['lastQuickLinksBadge']
  }
): Promise<boolean> {
  try {
    const response = await fetch(`/api/chat/session-state/${conversationId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionState }),
    })
    return response.ok
  } catch {
    return false
  }
}

function dbMessageToChatMessage(dbMsg: DbMessage): ChatMessage {
  return {
    id: dbMsg.id,
    role: dbMsg.role as 'user' | 'assistant',
    content: dbMsg.content,
    timestamp: new Date(dbMsg.createdAt),
    options: dbMsg.metadata?.options,
    isError: dbMsg.metadata?.isError,
  }
}

// =============================================================================
// Context
// =============================================================================

const ChatNavigationContext = createContext<ChatNavigationContextValue | null>(null)

// =============================================================================
// Provider
// =============================================================================

export function ChatNavigationProvider({ children }: { children: ReactNode }) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [isOpen, setOpen] = useState(false)

  // Persistence state
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [conversationSummary, setConversationSummary] = useState<string | null>(null)
  const [isLoadingHistory, setIsLoadingHistory] = useState(false)
  const [hasMoreMessages, setHasMoreMessages] = useState(false)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const initRef = useRef(false)

  // Session divider: track how many messages were loaded from history
  const [initialMessageCount, setInitialMessageCount] = useState(0)

  // Session state for informational intents
  // Note: lastAction and openCounts are persisted to dedicated table and hydrated on init
  const [sessionState, setSessionState] = useState<SessionState>({})

  // Panel visibility state for intent prioritization (Gap 2)
  const [visiblePanels, setVisiblePanelsState] = useState<string[]>([])
  const [focusedPanelId, setFocusedPanelIdState] = useState<string | null>(null)

  // Debounce refs for session state persistence
  const DEBOUNCE_MS = 1000
  const persistDebounceRef = useRef<NodeJS.Timeout | null>(null)
  const pendingSessionStateRef = useRef<{
    openCounts?: SessionState['openCounts']
    lastAction?: LastAction
    lastQuickLinksBadge?: SessionState['lastQuickLinksBadge']
  } | null>(null)

  // Flush pending session state (called on debounce timeout or unload)
  const flushSessionState = useCallback(async (convId: string) => {
    if (pendingSessionStateRef.current) {
      const pending = pendingSessionStateRef.current
      pendingSessionStateRef.current = null
      await persistSessionState(convId, pending)
    }
  }, [])

  // Debounced persist: batches rapid updates into single write
  const debouncedPersistSessionState = useCallback((
    convId: string,
    newState: {
      openCounts?: SessionState['openCounts']
      lastAction?: LastAction
      lastQuickLinksBadge?: SessionState['lastQuickLinksBadge']
    }
  ) => {
    // Merge with any pending state
    pendingSessionStateRef.current = {
      ...pendingSessionStateRef.current,
      ...newState,
    }

    // Clear existing timeout
    if (persistDebounceRef.current) {
      clearTimeout(persistDebounceRef.current)
    }

    // Set new timeout
    persistDebounceRef.current = setTimeout(() => {
      flushSessionState(convId)
    }, DEBOUNCE_MS)
  }, [flushSessionState])

  // Initialize: get or create conversation and load recent messages + session state
  useEffect(() => {
    if (initRef.current) return
    initRef.current = true

    async function init() {
      setIsLoadingHistory(true)
      try {
        const conv = await getOrCreateConversation()
        if (!conv) {
          console.warn('[ChatNavigation] Failed to get/create conversation')
          return
        }

        setConversationId(conv.id)
        setConversationSummary(conv.summary)

        // Fetch session state from dedicated table
        const ssData = await fetchSessionState(conv.id)
        if (ssData) {
          setSessionState((prev) => ({
            ...prev,
            lastAction: ssData.lastAction ?? undefined,
            openCounts: ssData.openCounts ?? undefined,
            lastQuickLinksBadge: ssData.lastQuickLinksBadge ?? undefined,
          }))
        }

        const result = await fetchMessages(conv.id)
        if (result) {
          const chatMessages = result.messages
            .filter((m) => m.role !== 'system')
            .map(dbMessageToChatMessage)
          setMessages(chatMessages)
          setNextCursor(result.nextCursor)
          setHasMoreMessages(!!result.nextCursor)
          // Track initial message count for session divider
          setInitialMessageCount(chatMessages.length)
        }
      } catch (err) {
        console.error('[ChatNavigation] Init error:', err)
      } finally {
        setIsLoadingHistory(false)
      }
    }

    init()
  }, [])

  // Flush pending writes on unload (beforeunload + visibilitychange)
  useEffect(() => {
    const handleUnload = () => {
      if (conversationId && pendingSessionStateRef.current) {
        // Use sendBeacon for reliable delivery on page unload
        const payload = JSON.stringify({ sessionState: pendingSessionStateRef.current })
        navigator.sendBeacon(`/api/chat/session-state/${conversationId}`, payload)
        pendingSessionStateRef.current = null
      }
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden' && conversationId) {
        flushSessionState(conversationId)
      }
    }

    window.addEventListener('beforeunload', handleUnload)
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      window.removeEventListener('beforeunload', handleUnload)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      // Flush on unmount
      if (conversationId && pendingSessionStateRef.current) {
        flushSessionState(conversationId)
      }
    }
  }, [conversationId, flushSessionState])

  // Add message with persistence
  const addMessage = useCallback(
    async (message: ChatMessage) => {
      // Add to local state immediately for responsiveness
      setMessages((prev) => [...prev, message])

      // Persist to database
      if (conversationId) {
        const metadata: Record<string, unknown> = {}
        if (message.options) metadata.options = message.options
        if (message.isError) metadata.isError = message.isError

        const persisted = await persistMessage(
          conversationId,
          message.role,
          message.content,
          Object.keys(metadata).length > 0 ? metadata : undefined
        )

        // If persisted, update the message ID to match database
        if (persisted) {
          setMessages((prev) =>
            prev.map((m) => (m.id === message.id ? { ...m, id: persisted.id } : m))
          )

          // Trigger async summarization after assistant responses (non-blocking)
          if (message.role === 'assistant') {
            triggerSummarization(conversationId).then((newSummary) => {
              if (newSummary) {
                setConversationSummary(newSummary)
              }
            })
          }
        }
      }
    },
    [conversationId]
  )

  // Clear messages with persistence
  const clearMessages = useCallback(async () => {
    setMessages([])
    setInput('')
    setNextCursor(null)
    setHasMoreMessages(false)
    setConversationSummary(null)
    setInitialMessageCount(0) // Reset session divider

    // Clear from database (create fresh conversation)
    if (conversationId) {
      await clearConversation(conversationId)
    }
  }, [conversationId])

  // Load older messages (pagination)
  const loadOlderMessages = useCallback(async () => {
    if (!conversationId || !nextCursor || isLoadingHistory) return

    setIsLoadingHistory(true)
    try {
      const result = await fetchMessages(conversationId, nextCursor)
      if (result) {
        const olderMessages = result.messages
          .filter((m) => m.role !== 'system')
          .map(dbMessageToChatMessage)

        // Prepend older messages
        setMessages((prev) => [...olderMessages, ...prev])
        setNextCursor(result.nextCursor)
        setHasMoreMessages(!!result.nextCursor)
      }
    } catch (err) {
      console.error('[ChatNavigation] Load older messages error:', err)
    } finally {
      setIsLoadingHistory(false)
    }
  }, [conversationId, nextCursor, isLoadingHistory])

  const openChat = useCallback(() => {
    setOpen(true)
    // Reset focused panel when chat opens (Gap 2: prevents stale focus priority)
    setFocusedPanelIdState(null)
  }, [])

  const closeChat = useCallback(() => {
    setOpen(false)
  }, [])

  // Update current location (called when user navigates)
  const setCurrentLocation = useCallback((
    viewMode: 'dashboard' | 'workspace',
    entryId?: string,
    entryName?: string,
    workspaceId?: string,
    workspaceName?: string
  ) => {
    setSessionState((prev) => ({
      ...prev,
      currentViewMode: viewMode,
      currentEntryId: entryId,
      currentEntryName: entryName,
      currentWorkspaceId: workspaceId,
      currentWorkspaceName: workspaceName,
    }))
  }, [])

  // Record last action (called after navigation/operation completes)
  // Uses debounced persistence for efficiency
  const setLastAction = useCallback((action: LastAction) => {
    setSessionState((prev) => ({
      ...prev,
      lastAction: action,
    }))

    // Debounced persist to dedicated session-state table
    if (conversationId) {
      debouncedPersistSessionState(conversationId, { lastAction: action })
    }
  }, [conversationId, debouncedPersistSessionState])

  // Increment open count for a workspace or entry
  // Uses debounced persistence for efficiency
  const incrementOpenCount = useCallback((id: string, name: string, type: 'workspace' | 'entry') => {
    setSessionState((prev) => {
      const prevCounts = prev.openCounts || {}
      const prevData = prevCounts[id] || { type, count: 0, name }
      const newCounts = {
        ...prevCounts,
        [id]: {
          type,
          count: prevData.count + 1,
          name,
        },
      }

      // Debounced persist to dedicated session-state table
      if (conversationId) {
        debouncedPersistSessionState(conversationId, { openCounts: newCounts })
      }

      return {
        ...prev,
        openCounts: newCounts,
      }
    })
  }, [conversationId, debouncedPersistSessionState])

  const setLastQuickLinksBadge = useCallback((badge: string) => {
    if (!badge) return
    const normalizedBadge = badge.toLowerCase()
    setSessionState((prev) => ({
      ...prev,
      lastQuickLinksBadge: normalizedBadge,
    }))
    if (conversationId) {
      debouncedPersistSessionState(conversationId, { lastQuickLinksBadge: normalizedBadge })
    }
  }, [conversationId, debouncedPersistSessionState])

  // Panel visibility setters (Gap 2)
  const setVisiblePanels = useCallback((panelIds: string[]) => {
    setVisiblePanelsState(panelIds)
  }, [])

  const setFocusedPanelId = useCallback((panelId: string | null) => {
    setFocusedPanelIdState(panelId)
  }, [])

  // Register/unregister individual panels (for use in panel mount/unmount effects)
  const registerVisiblePanel = useCallback((panelId: string) => {
    setVisiblePanelsState((prev) => {
      if (prev.includes(panelId)) return prev
      return [...prev, panelId]
    })
  }, [])

  const unregisterVisiblePanel = useCallback((panelId: string) => {
    setVisiblePanelsState((prev) => prev.filter((id) => id !== panelId))
    // Also clear focus if this panel was focused
    setFocusedPanelIdState((prev) => (prev === panelId ? null : prev))
  }, [])

  return (
    <ChatNavigationContext.Provider
      value={{
        messages,
        addMessage,
        clearMessages,
        input,
        setInput,
        isOpen,
        setOpen,
        openChat,
        closeChat,
        sessionState,
        setCurrentLocation,
        setLastAction,
        incrementOpenCount,
        setLastQuickLinksBadge,
        conversationId,
        isLoadingHistory,
        hasMoreMessages,
        loadOlderMessages,
        conversationSummary,
        initialMessageCount,
        // Panel visibility (Gap 2)
        visiblePanels,
        focusedPanelId,
        setVisiblePanels,
        setFocusedPanelId,
        registerVisiblePanel,
        unregisterVisiblePanel,
      }}
    >
      {children}
    </ChatNavigationContext.Provider>
  )
}

// =============================================================================
// Hook
// =============================================================================

export function useChatNavigationContext() {
  const context = useContext(ChatNavigationContext)
  if (!context) {
    throw new Error('useChatNavigationContext must be used within ChatNavigationProvider')
  }
  return context
}
