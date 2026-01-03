'use client'

/**
 * usePanelChatVisibility Hook
 *
 * Standardizes widget/panel visibility and focus tracking for chat integration.
 * Reduces boilerplate from ~15 lines to 1 line per widget.
 *
 * Usage:
 * ```ts
 * usePanelChatVisibility(chatPanelId, isActive)
 * ```
 *
 * Behavior:
 * - On mount: registers panel as visible
 * - On unmount: unregisters panel
 * - When isActive becomes true: sets panel as focused
 */

import { useEffect } from 'react'
import { useChatNavigationContext } from '@/lib/chat/chat-navigation-context'

/**
 * Hook to register a panel/widget with the chat visibility system.
 *
 * @param panelId - The chat panel ID (e.g., 'recent', 'quick-links-d')
 * @param isActive - Whether the panel is currently active/focused
 */
export function usePanelChatVisibility(
  panelId: string | null | undefined,
  isActive: boolean = false
): void {
  const {
    registerVisiblePanel,
    unregisterVisiblePanel,
    setFocusedPanelId,
  } = useChatNavigationContext()

  // Register/unregister visibility on mount/unmount
  useEffect(() => {
    if (!panelId) return
    registerVisiblePanel(panelId)
    return () => unregisterVisiblePanel(panelId)
  }, [panelId, registerVisiblePanel, unregisterVisiblePanel])

  // Update focused panel when isActive changes
  useEffect(() => {
    if (isActive && panelId) {
      setFocusedPanelId(panelId)
    }
  }, [isActive, panelId, setFocusedPanelId])
}
