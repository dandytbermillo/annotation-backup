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

import { useEffect, useMemo } from 'react'
import { useChatNavigationContext } from '@/lib/chat/chat-navigation-context'
import type { PanelChatManifest } from '@/lib/panels/panel-manifest'
import { registerPanelManifests } from '@/lib/panels/register-panel'
import { debugLog } from '@/lib/utils/debug-logger'

export interface PanelChatVisibilityOptions {
  /**
   * Optional manifest(s) to register for chat intent discovery.
   * Allows third-party widgets to self-register without touching core code.
   */
  manifest?: PanelChatManifest | PanelChatManifest[]
}

/**
 * Hook to register a panel/widget with the chat visibility system.
 *
 * @param panelId - The chat panel ID (e.g., 'recent', 'quick-links-d')
 * @param isActive - Whether the panel is currently active/focused
 */
export function usePanelChatVisibility(
  panelId: string | null | undefined,
  isActive: boolean = false,
  options?: PanelChatVisibilityOptions
): void {
  const {
    registerVisiblePanel,
    unregisterVisiblePanel,
    setFocusedPanelId,
  } = useChatNavigationContext()

  const manifests = useMemo(() => {
    if (!options?.manifest) return null
    return Array.isArray(options.manifest) ? options.manifest : [options.manifest]
  }, [options?.manifest])

  // Register manifests once when provided
  useEffect(() => {
    if (!manifests || manifests.length === 0) return
    debugLog({
      component: 'usePanelChatVisibility',
      action: 'register_manifests',
      content_preview: `Registering ${manifests.length} manifests`,
      metadata: { panelIds: manifests.map(m => m.panelId) }
    })
    registerPanelManifests(manifests)
  }, [manifests])

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
