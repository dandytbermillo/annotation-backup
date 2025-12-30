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
import type { WorkspaceMatch, NoteMatch } from './resolution-types'
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

export interface SelectionOption {
  type: 'workspace' | 'note' | 'confirm_delete' | 'quick_links_panel'
  id: string
  label: string
  sublabel?: string
  data: WorkspaceMatch | NoteMatch | QuickLinksPanelData
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
}

// Re-export SessionState for convenience
export type { SessionState }

// Last action type for tracking
export interface LastAction {
  type: 'open_workspace' | 'rename_workspace' | 'delete_workspace' | 'create_workspace' | 'go_to_dashboard'
  workspaceId?: string
  workspaceName?: string
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
  incrementOpenCount: (workspaceId: string, workspaceName: string) => void
  // Persistence
  conversationId: string | null
  isLoadingHistory: boolean
  hasMoreMessages: boolean
  loadOlderMessages: () => Promise<void>
  conversationSummary: string | null
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

async function getOrCreateConversation(): Promise<{ id: string; summary: string | null } | null> {
  try {
    const response = await fetch('/api/chat/conversations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scope: 'global' }),
    })
    if (!response.ok) return null
    const data = await response.json()
    return { id: data.conversation.id, summary: data.conversation.summary }
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

  // Session state for informational intents (session-only, not persisted)
  const [sessionState, setSessionState] = useState<SessionState>({})

  // Initialize: get or create conversation and load recent messages
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

        const result = await fetchMessages(conv.id)
        if (result) {
          const chatMessages = result.messages
            .filter((m) => m.role !== 'system')
            .map(dbMessageToChatMessage)
          setMessages(chatMessages)
          setNextCursor(result.nextCursor)
          setHasMoreMessages(!!result.nextCursor)
        }
      } catch (err) {
        console.error('[ChatNavigation] Init error:', err)
      } finally {
        setIsLoadingHistory(false)
      }
    }

    init()
  }, [])

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
  const setLastAction = useCallback((action: LastAction) => {
    setSessionState((prev) => ({
      ...prev,
      lastAction: action,
    }))
  }, [])

  // Increment open count for a workspace
  const incrementOpenCount = useCallback((workspaceId: string, workspaceName: string) => {
    setSessionState((prev) => {
      const prevCounts = prev.openCounts || {}
      const prevData = prevCounts[workspaceId] || { count: 0, name: workspaceName }
      return {
        ...prev,
        openCounts: {
          ...prevCounts,
          [workspaceId]: {
            count: prevData.count + 1,
            name: workspaceName,
          },
        },
      }
    })
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
        conversationId,
        isLoadingHistory,
        hasMoreMessages,
        loadOlderMessages,
        conversationSummary,
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
