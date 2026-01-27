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
import type { SessionState, UIContext } from './intent-prompt'
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

export interface PanelDrawerData {
  panelId: string
  panelTitle: string
  panelType: string
}

/** Data for doc disambiguation pills (definitional-query-fix-proposal.md) */
export interface DocData {
  docSlug: string
  originalQuery?: string // Preserve user's original query for HS3 steps_request trigger
}

/** TD-7: Data for high-ambiguity clarification pills */
export interface TD7ClarificationData {
  term: string
  action: 'doc' | 'llm'
}

/** Prereq 4: Data for cross-corpus disambiguation pills */
export interface CrossCorpusSelectData {
  corpus: 'docs' | 'notes'
  resourceId: string
  title: string
}

/** Exit pill data for clarification escalation (per clarification-exit-pills-plan.md) */
export interface ExitPillData {
  exitType: 'none' | 'start_over'
}

export interface SelectionOption {
  type: 'workspace' | 'note' | 'entry' | 'confirm_delete' | 'quick_links_panel' | 'confirm_panel_write' | 'panel_drawer' | 'doc' | 'td7_clarification' | 'cross_corpus_select' | 'exit'
  id: string
  label: string
  sublabel?: string
  data: WorkspaceMatch | NoteMatch | EntryMatch | QuickLinksPanelData | PanelIntentData | PanelDrawerData | DocData | TD7ClarificationData | CrossCorpusSelectData | ExitPillData
}

/** Suggestion candidate for typo fallback */
export interface SuggestionCandidate {
  label: string
  intentName: string
  panelId?: string
  primaryAction: 'open' | 'list' | 'navigate' | 'create' | 'info'
}

/** Suggestions for typo recovery */
export interface ChatSuggestions {
  type: 'confirm_single' | 'choose_multiple' | 'low_confidence'
  candidates: SuggestionCandidate[]
}

/** Last suggestion state for rejection handling */
export interface LastSuggestionState {
  candidates: SuggestionCandidate[]
  messageId: string
}

/** Clarification option for multi-choice clarifications (per options-visible-clarification-sync-plan.md) */
export interface ClarificationOption {
  id: string
  label: string
  sublabel?: string
  type: string
}

/** Last clarification state for follow-up handling (Phase 2a) */
export interface LastClarificationState {
  type: 'notes_scope' | 'option_selection' | 'doc_disambiguation' | 'td7_high_ambiguity' | 'cross_corpus' | 'panel_disambiguation' | 'workspace_list'
  originalIntent: string
  /** Generic action to execute when user affirms (Phase 2a deterministic handler) - optional for option_selection */
  nextAction?: string
  messageId: string
  timestamp: number
  /** META response count for loop limit (max 2 before escape hatch) */
  metaCount?: number
  /** Original clarification question for re-asking */
  clarificationQuestion?: string
  /** Options for multi-choice clarifications (per options-visible-clarification-sync-plan.md) */
  options?: ClarificationOption[]
  /** Off-menu attempt count for escalation (per clarification-offmenu-handling-plan.md) */
  attemptCount?: number
  /** "No" count for repeated-no escalation (per clarification-response-fit-plan.md §122-130) */
  noCount?: number
}

/**
 * Repair memory state for response-fit classifier (per clarification-response-fit-plan.md).
 * Supports "the other one" style repairs by tracking previous selections.
 */
export interface RepairMemoryState {
  /** ID of the last choice selected/rejected */
  lastChoiceId: string | null
  /** Options shown in the last clarification (for repair context) */
  lastOptionsShown: ClarificationOption[]
  /** Turn counter for expiry (expires after 2 turns) */
  turnsSinceSet: number
  /** Timestamp when set */
  timestamp: number
}

/** Default repair memory window in turns (configurable) */
export const REPAIR_MEMORY_TURN_LIMIT = 2

/**
 * Clarification snapshot for post-action repair window (per clarification-response-fit-plan.md §153-161).
 * Stores the last clarification options so "not that" after an action can restore them.
 */
export interface ClarificationSnapshot {
  /** Options from the last clarification */
  options: ClarificationOption[]
  /** Original intent/query that created the clarification */
  originalIntent: string
  /** Type of clarification */
  type: LastClarificationState['type']
  /** Turn counter for expiry (expires after 2 turns) */
  turnsSinceSet: number
  /** Timestamp when set */
  timestamp: number
}

/** Default snapshot window in turns (configurable) */
export const SNAPSHOT_TURN_LIMIT = 2

/**
 * Doc retrieval conversation state for follow-ups and corrections.
 * Per general-doc-retrieval-routing-plan.md (v4)
 * Updated for v5 Hybrid Response Selection (lastChunkIdsShown for HS2)
 * Updated for Prereq 4: Cross-corpus tracking
 */
export interface DocRetrievalState {
  /** Last doc slug from retrieval (for "tell me more" follow-ups) */
  lastDocSlug?: string
  /** Last topic tokens from query (for correction re-retrieval) */
  lastTopicTokens?: string[]
  /** Last retrieval mode: 'doc' | 'bare_noun' */
  lastMode?: 'doc' | 'bare_noun'
  /** Timestamp of last doc retrieval */
  timestamp?: number
  /** V5: Chunk IDs that have been shown (for HS2 follow-up expansion) */
  lastChunkIdsShown?: string[]
  /** Prereq 4: Last corpus used (for keeping follow-ups in same corpus) */
  lastRetrievalCorpus?: 'docs' | 'notes'
  /** Prereq 4: Last item ID for notes (parallel to lastDocSlug) */
  lastItemId?: string
  /** Prereq 4: Last resource ID (unified: docSlug or itemId) */
  lastResourceId?: string
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: Date
  options?: SelectionOption[]
  isError?: boolean
  // Typo recovery suggestions (from typo-suggestions.ts)
  suggestions?: ChatSuggestions
  // View panel content (for "Show all" preview)
  viewPanelContent?: ViewPanelContent
  previewItems?: ViewListItem[]
  totalCount?: number
  // Drawer target for "Show all" when panel preview maps to a panel
  drawerPanelId?: string
  drawerPanelTitle?: string
  // Doc retrieval metadata for "Show more" button (per show-more-button-spec.md)
  docSlug?: string
  chunkId?: string
  headerPath?: string
  // Notes retrieval metadata for "Show more" button (notes corpus)
  itemId?: string
  itemName?: string
  corpus?: 'docs' | 'notes'
}

// Re-export SessionState for convenience
export type { SessionState }

// Last action type for tracking
export interface LastAction {
  type: 'open_workspace' | 'open_entry' | 'open_panel' | 'rename_workspace' | 'delete_workspace' | 'create_workspace' | 'go_to_dashboard' | 'go_home'
  workspaceId?: string
  workspaceName?: string
  entryId?: string
  entryName?: string
  panelId?: string
  panelTitle?: string
  fromName?: string
  toName?: string
  timestamp: number
}

// Re-export ActionHistoryEntry and RequestHistoryEntry for convenience
export type { ActionHistoryEntry, RequestHistoryEntry } from './intent-prompt'

// Constants for action history
const ACTION_HISTORY_MAX_SIZE = 50

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
  // Action history for "did I [action] X?" queries
  appendActionHistory: (entry: Omit<import('./intent-prompt').ActionHistoryEntry, 'timestamp'>) => void
  // Request history for "did I ask you to [action] X?" queries
  appendRequestHistory: (entry: Omit<import('./intent-prompt').RequestHistoryEntry, 'timestamp'>) => void
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
  // UI context for current screen visibility
  uiContext: UIContext | null
  setUiContext: (context: UIContext | null) => void
  // Suggestion rejection handling (ephemeral, not persisted)
  lastSuggestion: LastSuggestionState | null
  rejectedSuggestions: Set<string>
  setLastSuggestion: (suggestion: LastSuggestionState | null) => void
  addRejectedSuggestions: (labels: string[]) => void
  clearRejectedSuggestions: () => void
  isRejectedSuggestion: (label: string) => boolean
  // Clarification follow-up handling (Phase 2a: notes-scope clarification)
  lastClarification: LastClarificationState | null
  setLastClarification: (clarification: LastClarificationState | null) => void
  // Doc retrieval conversation state (v4 plan)
  docRetrievalState: DocRetrievalState | null
  setDocRetrievalState: (state: DocRetrievalState | null) => void
  updateDocRetrievalState: (update: Partial<DocRetrievalState>) => void
  // Repair memory for response-fit (per clarification-response-fit-plan.md)
  repairMemory: RepairMemoryState | null
  setRepairMemory: (lastChoiceId: string | null, options: ClarificationOption[]) => void
  incrementRepairMemoryTurn: () => void
  clearRepairMemory: () => void
  // Clarification snapshot for post-action repair window (per plan §153-161)
  clarificationSnapshot: ClarificationSnapshot | null
  saveClarificationSnapshot: (clarification: LastClarificationState) => void
  incrementSnapshotTurn: () => void
  clearClarificationSnapshot: () => void
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
  actionHistory?: SessionState['actionHistory']
  requestHistory?: SessionState['requestHistory']
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
    actionHistory?: SessionState['actionHistory']
    requestHistory?: SessionState['requestHistory']
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
  const [uiContext, setUiContextState] = useState<UIContext | null>(null)

  // Suggestion rejection handling (ephemeral, not persisted)
  const [lastSuggestion, setLastSuggestionState] = useState<LastSuggestionState | null>(null)
  const [rejectedSuggestions, setRejectedSuggestions] = useState<Set<string>>(new Set())

  // Clarification follow-up handling (Phase 2a: notes-scope clarification)
  const [lastClarification, setLastClarificationState] = useState<LastClarificationState | null>(null)

  // Doc retrieval conversation state (v4 plan)
  const [docRetrievalState, setDocRetrievalStateInternal] = useState<DocRetrievalState | null>(null)

  // Repair memory for response-fit (per clarification-response-fit-plan.md)
  const [repairMemory, setRepairMemoryInternal] = useState<RepairMemoryState | null>(null)

  // Clarification snapshot for post-action repair window (per plan §153-161)
  const [clarificationSnapshot, setClarificationSnapshotInternal] = useState<ClarificationSnapshot | null>(null)

  // Debounce refs for session state persistence
  const DEBOUNCE_MS = 1000
  const persistDebounceRef = useRef<NodeJS.Timeout | null>(null)
  const pendingSessionStateRef = useRef<{
    openCounts?: SessionState['openCounts']
    lastAction?: LastAction
    lastQuickLinksBadge?: SessionState['lastQuickLinksBadge']
    actionHistory?: SessionState['actionHistory']
    requestHistory?: SessionState['requestHistory']
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
      actionHistory?: SessionState['actionHistory']
      requestHistory?: SessionState['requestHistory']
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
            actionHistory: ssData.actionHistory ?? undefined,
            requestHistory: ssData.requestHistory ?? undefined,
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
  // Also appends to action history for "did I [action] X?" queries
  const setLastAction = useCallback((action: LastAction) => {
    setSessionState((prev) => ({
      ...prev,
      lastAction: action,
    }))

    // Debounced persist to dedicated session-state table
    if (conversationId) {
      debouncedPersistSessionState(conversationId, { lastAction: action })
    }

    // Also append to action history (convert LastAction to ActionHistoryEntry)
    // Map action type to targetType and targetName
    let targetType: 'workspace' | 'entry' | 'panel' | 'link' = 'workspace'
    let targetName = ''
    let targetId: string | undefined

    switch (action.type) {
      case 'open_workspace':
        targetType = 'workspace'
        targetName = action.workspaceName || 'Unknown workspace'
        targetId = action.workspaceId
        break
      case 'open_entry':
        targetType = 'entry'
        targetName = action.entryName || 'Unknown entry'
        targetId = action.entryId
        break
      case 'open_panel':
        targetType = 'panel'
        targetName = action.panelTitle || 'Unknown panel'
        targetId = action.panelId
        break
      case 'rename_workspace':
        targetType = 'workspace'
        targetName = action.toName || action.workspaceName || 'Unknown workspace'
        targetId = action.workspaceId
        break
      case 'delete_workspace':
        targetType = 'workspace'
        targetName = action.workspaceName || 'Unknown workspace'
        targetId = action.workspaceId
        break
      case 'create_workspace':
        targetType = 'workspace'
        targetName = action.workspaceName || 'New workspace'
        targetId = action.workspaceId
        break
      case 'go_to_dashboard':
        targetType = 'entry'
        targetName = action.entryName || 'Dashboard'
        targetId = action.entryId
        break
      case 'go_home':
        targetType = 'entry'
        targetName = 'Home'
        targetId = action.entryId
        break
    }

    // Append to action history (bounded list)
    setSessionState((prev) => {
      const prevHistory = prev.actionHistory || []
      const newEntry: import('./intent-prompt').ActionHistoryEntry = {
        type: action.type,
        targetType,
        targetName,
        targetId,
        timestamp: action.timestamp,
      }
      const newHistory = [newEntry, ...prevHistory].slice(0, ACTION_HISTORY_MAX_SIZE)

      // Debounced persist action history
      if (conversationId) {
        debouncedPersistSessionState(conversationId, { actionHistory: newHistory })
      }

      return {
        ...prev,
        actionHistory: newHistory,
      }
    })
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

  // Append to action history (bounded, for "did I [action] X?" queries)
  const appendActionHistory = useCallback((
    entry: Omit<import('./intent-prompt').ActionHistoryEntry, 'timestamp'>
  ) => {
    const newEntry: import('./intent-prompt').ActionHistoryEntry = {
      ...entry,
      timestamp: Date.now(),
    }

    setSessionState((prev) => {
      const prevHistory = prev.actionHistory || []
      // Keep bounded to ACTION_HISTORY_MAX_SIZE (newest first)
      const newHistory = [newEntry, ...prevHistory].slice(0, ACTION_HISTORY_MAX_SIZE)

      // Debounced persist
      if (conversationId) {
        debouncedPersistSessionState(conversationId, { actionHistory: newHistory })
      }

      return {
        ...prev,
        actionHistory: newHistory,
      }
    })
  }, [conversationId, debouncedPersistSessionState])

  // Append to request history (bounded, for "did I ask you to [action] X?" queries)
  const appendRequestHistory = useCallback((
    entry: Omit<import('./intent-prompt').RequestHistoryEntry, 'timestamp'>
  ) => {
    const newEntry: import('./intent-prompt').RequestHistoryEntry = {
      ...entry,
      timestamp: Date.now(),
    }

    setSessionState((prev) => {
      const prevHistory = prev.requestHistory || []
      // Keep bounded to ACTION_HISTORY_MAX_SIZE (newest first)
      const newHistory = [newEntry, ...prevHistory].slice(0, ACTION_HISTORY_MAX_SIZE)

      // Debounced persist
      if (conversationId) {
        debouncedPersistSessionState(conversationId, { requestHistory: newHistory })
      }

      return {
        ...prev,
        requestHistory: newHistory,
      }
    })
  }, [conversationId, debouncedPersistSessionState])

  // Panel visibility setters (Gap 2)
  const setVisiblePanels = useCallback((panelIds: string[]) => {
    setVisiblePanelsState(panelIds)
  }, [])

  const setFocusedPanelId = useCallback((panelId: string | null) => {
    setFocusedPanelIdState(panelId)
  }, [])

  const setUiContext = useCallback((context: UIContext | null) => {
    setUiContextState(context)
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

  // Suggestion rejection handlers
  const setLastSuggestion = useCallback((suggestion: LastSuggestionState | null) => {
    setLastSuggestionState(suggestion)
  }, [])

  const addRejectedSuggestions = useCallback((labels: string[]) => {
    setRejectedSuggestions((prev) => {
      const next = new Set(prev)
      for (const label of labels) {
        next.add(label.toLowerCase())
      }
      return next
    })
  }, [])

  const clearRejectedSuggestions = useCallback(() => {
    setRejectedSuggestions(new Set())
  }, [])

  const isRejectedSuggestion = useCallback((label: string) => {
    return rejectedSuggestions.has(label.toLowerCase())
  }, [rejectedSuggestions])

  // Clarification follow-up handler (Phase 2a)
  const setLastClarification = useCallback((clarification: LastClarificationState | null) => {
    setLastClarificationState(clarification)
  }, [])

  // Doc retrieval state handlers (v4 plan)
  const setDocRetrievalState = useCallback((state: DocRetrievalState | null) => {
    setDocRetrievalStateInternal(state)
  }, [])

  const updateDocRetrievalState = useCallback((update: Partial<DocRetrievalState>) => {
    setDocRetrievalStateInternal((prev) => ({
      ...prev,
      ...update,
      timestamp: Date.now(),
    }))
  }, [])

  // Repair memory handlers (per clarification-response-fit-plan.md)
  const setRepairMemory = useCallback((lastChoiceId: string | null, options: ClarificationOption[]) => {
    setRepairMemoryInternal({
      lastChoiceId,
      lastOptionsShown: options,
      turnsSinceSet: 0,
      timestamp: Date.now(),
    })
  }, [])

  const incrementRepairMemoryTurn = useCallback(() => {
    setRepairMemoryInternal((prev) => {
      if (!prev) return null
      const newTurns = prev.turnsSinceSet + 1
      // Expire after REPAIR_MEMORY_TURN_LIMIT turns
      if (newTurns >= REPAIR_MEMORY_TURN_LIMIT) {
        return null
      }
      return {
        ...prev,
        turnsSinceSet: newTurns,
      }
    })
  }, [])

  const clearRepairMemory = useCallback(() => {
    setRepairMemoryInternal(null)
  }, [])

  // Clarification snapshot functions (per plan §153-161)
  const saveClarificationSnapshot = useCallback((clarification: LastClarificationState) => {
    if (clarification.options && clarification.options.length > 0) {
      setClarificationSnapshotInternal({
        options: clarification.options,
        originalIntent: clarification.originalIntent,
        type: clarification.type,
        turnsSinceSet: 0,
        timestamp: Date.now(),
      })
    }
  }, [])

  const incrementSnapshotTurn = useCallback(() => {
    setClarificationSnapshotInternal((prev) => {
      if (!prev) return null
      const newTurns = prev.turnsSinceSet + 1
      // Expire after SNAPSHOT_TURN_LIMIT turns
      if (newTurns >= SNAPSHOT_TURN_LIMIT) {
        return null
      }
      return {
        ...prev,
        turnsSinceSet: newTurns,
      }
    })
  }, [])

  const clearClarificationSnapshot = useCallback(() => {
    setClarificationSnapshotInternal(null)
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
        appendActionHistory,
        appendRequestHistory,
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
        uiContext,
        setUiContext,
        // Suggestion rejection handling
        lastSuggestion,
        rejectedSuggestions,
        setLastSuggestion,
        addRejectedSuggestions,
        clearRejectedSuggestions,
        isRejectedSuggestion,
        // Clarification follow-up handling (Phase 2a)
        lastClarification,
        setLastClarification,
        // Doc retrieval conversation state (v4 plan)
        docRetrievalState,
        setDocRetrievalState,
        updateDocRetrievalState,
        // Repair memory for response-fit (per clarification-response-fit-plan.md)
        repairMemory,
        setRepairMemory,
        incrementRepairMemoryTurn,
        clearRepairMemory,
        // Clarification snapshot for post-action repair window (per plan §153-161)
        clarificationSnapshot,
        saveClarificationSnapshot,
        incrementSnapshotTurn,
        clearClarificationSnapshot,
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
