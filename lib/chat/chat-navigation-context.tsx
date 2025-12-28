/**
 * Chat Navigation Context
 *
 * Provides shared state for chat navigation messages across different
 * component instances (DashboardDock, canvas-control-center).
 *
 * This ensures messages persist when switching between dashboard and workspace modes.
 * Also tracks session state for informational intents (location_info, last_action, session_stats).
 */

'use client'

import { createContext, useContext, useState, useCallback, type ReactNode } from 'react'
import type { WorkspaceMatch, NoteMatch } from './resolution-types'
import type { SessionState } from './intent-prompt'

// =============================================================================
// Types
// =============================================================================

export interface SelectionOption {
  type: 'workspace' | 'note' | 'confirm_delete'
  id: string
  label: string
  sublabel?: string
  data: WorkspaceMatch | NoteMatch
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: Date
  options?: SelectionOption[]
  isError?: boolean
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

  // Session state for informational intents
  const [sessionState, setSessionState] = useState<SessionState>({})

  const addMessage = useCallback((message: ChatMessage) => {
    setMessages((prev) => [...prev, message])
  }, [])

  const clearMessages = useCallback(() => {
    setMessages([])
    setInput('')
  }, [])

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
