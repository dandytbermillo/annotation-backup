/**
 * Chat Navigation Module
 *
 * Provides LLM-powered natural language navigation for workspaces and notes.
 *
 * Architecture:
 * - Phase 1: LLM Intent Interface (intent-prompt.ts, intent-schema.ts)
 * - Phase 2: Data Resolution Layer (intent-resolver.ts, workspace-resolver.ts, note-resolver.ts)
 * - Phase 3: Action Execution (use-chat-navigation.ts, use-chat-navigation-listener.ts)
 * - Phase 4: Chat UI Integration (components/chat/chat-navigation-panel.tsx)
 *
 * Usage:
 * ```tsx
 * // In chat component
 * import { useChatNavigation } from '@/lib/chat'
 *
 * const { executeAction, selectOption } = useChatNavigation()
 *
 * // Call API and execute action
 * const response = await fetch('/api/chat/navigate', { ... })
 * const { resolution } = await response.json()
 * await executeAction(resolution)
 *
 * // In canvas component (to listen for note navigation)
 * import { useChatNavigationListener } from '@/lib/chat'
 *
 * useChatNavigationListener({ enabled: true })
 * ```
 */

// Types
export type { IntentResponse } from './intent-schema'
export type { IntentResolutionResult } from './intent-resolver'
export type {
  WorkspaceMatch,
  NoteMatch,
  WorkspaceResolutionResult,
  NoteResolutionResult,
  ResolutionContext,
} from './resolution-types'

// Hooks
export { useChatNavigation } from './use-chat-navigation'
export type { ChatNavigationResult, UseChatNavigationOptions } from './use-chat-navigation'

export { useChatNavigationListener } from './use-chat-navigation-listener'
export type { UseChatNavigationListenerOptions } from './use-chat-navigation-listener'

// Context (for shared state across mode switches)
export { ChatNavigationProvider, useChatNavigationContext } from './chat-navigation-context'
export type {
  ChatMessage,
  SelectionOption,
  SessionState,
  LastAction,
  SuggestionCandidate,
  ChatSuggestions,
} from './chat-navigation-context'

// Schema utilities (for reference)
export { SUPPORTED_ACTIONS_TEXT, parseIntentResponse } from './intent-schema'

// View Panel (Universal View Panel for chat results)
export { ViewPanelProvider, useViewPanel } from './view-panel-context'
export { ViewContentType } from './view-panel-types'
export type {
  ViewPanelContent,
  ViewListItem,
  ViewPanelState,
  ViewPanelContextValue,
  QuickLinkItem,
  QuickLinkAttributes,
  FileContent,
  PDFPage,
} from './view-panel-types'

// Quick Links parsing
export { parseQuickLinksContent, buildQuickLinksViewItems } from './parse-quick-links'
