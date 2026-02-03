"use client"

/**
 * Recent Widget Component
 * Part of Widget Architecture - Compact summary of recent workspaces
 *
 * Shows:
 * - Total count as prominent stat
 * - Top 3 recent items with workspace icons
 * - macOS widget style (no header/footer)
 */

import React, { useEffect, useState } from 'react'
import type { WorkspacePanel } from '@/lib/dashboard/panel-registry'
import { usePanelChatVisibility } from '@/lib/hooks/use-panel-chat-visibility'
import { upsertWidgetState, removeWidgetState } from '@/lib/widgets/widget-state-store'
import { registerWidgetSnapshot, unregisterWidgetSnapshot } from '@/lib/widgets/ui-snapshot-registry'
import {
  BaseWidget,
  WidgetLabel,
  WidgetValue,
  WidgetContent,
  WidgetList,
  WidgetListItemGradient,
  WidgetEmpty,
} from './BaseWidget'

/** Number of items to show in widget summary */
const WIDGET_ITEM_LIMIT = 3
const CHAT_PANEL_ID = 'recent'

interface RecentWorkspace {
  id: string
  name: string
  entryId: string | null
  entryName: string | null
  lastAccessedAt: string
}

export interface RecentWidgetProps {
  /** The panel data */
  panel: WorkspacePanel
  /** Double-click handler to open full panel drawer */
  onDoubleClick: () => void
  /** Whether this widget is currently active/selected */
  isActive?: boolean
  /** Mouse down handler for drag initiation */
  onMouseDown?: (e: React.MouseEvent) => void
}

export function RecentWidget({
  panel,
  onDoubleClick,
  isActive = false,
  onMouseDown,
}: RecentWidgetProps) {
  const [workspaces, setWorkspaces] = useState<RecentWorkspace[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Chat visibility integration (single hook replaces ~15 lines of boilerplate)
  usePanelChatVisibility(CHAT_PANEL_ID, isActive)

  // Fetch recent workspaces (summary - just need top items)
  useEffect(() => {
    const fetchRecent = async () => {
      try {
        setIsLoading(true)
        setError(null)

        // Fetch a few more than we display to show accurate count
        const response = await fetch(`/api/dashboard/recent?limit=10`)
        if (!response.ok) {
          if (response.status === 404) {
            setWorkspaces([])
            return
          }
          throw new Error('Failed to fetch recent workspaces')
        }

        const data = await response.json()
        setWorkspaces(data.workspaces || [])
      } catch (err) {
        console.error('[RecentWidget] Failed to load:', err)
        setError('Unable to load')
      } finally {
        setIsLoading(false)
      }
    }

    fetchRecent()
  }, [])

  // Get first letter for workspace icon
  const getInitial = (name: string): string => {
    return name.charAt(0).toUpperCase()
  }

  /**
   * Get display name for a workspace.
   * If the workspace is "Dashboard", use the entry name instead (more descriptive).
   */
  const getDisplayName = (workspace: RecentWorkspace): string => {
    if (workspace.name === 'Dashboard' && workspace.entryName) {
      return workspace.entryName
    }
    return workspace.name
  }

  // Widget Chat State: Report internal state for LLM context
  useEffect(() => {
    // Only report once loaded (avoid reporting loading state)
    if (isLoading) return

    const summary = error
      ? 'Error loading recent items'
      : workspaces.length === 0
        ? 'No recent items'
        : `Showing ${Math.min(workspaces.length, WIDGET_ITEM_LIMIT)} of ${workspaces.length} recent items`

    upsertWidgetState({
      _version: 1,
      widgetId: 'recent',
      instanceId: panel.id,
      title: 'Recent',
      view: 'list',
      selection: null,
      summary,
      updatedAt: Date.now(),
      counts: { total: workspaces.length, visible: Math.min(workspaces.length, WIDGET_ITEM_LIMIT) },
    })

    // Widget UI Snapshot: Register structured snapshot for routing (Layer 1)
    registerWidgetSnapshot({
      _version: 1,
      widgetId: 'w_recent_widget',
      title: 'Recent',
      isVisible: true,
      segments: [
        {
          segmentId: 'w_recent_widget:list',
          segmentType: 'list',
          listLabel: 'Recent Workspaces',
          badgesEnabled: false,
          visibleItemRange: { start: 0, end: Math.min(workspaces.length, WIDGET_ITEM_LIMIT) },
          items: workspaces.slice(0, WIDGET_ITEM_LIMIT).map(ws => ({
            itemId: ws.id,
            label: getDisplayName(ws),
            actions: ['open'],
          })),
        },
        {
          segmentId: 'w_recent_widget:context',
          segmentType: 'context',
          summary,
          currentView: 'list',
        },
      ],
      registeredAt: Date.now(),
    })

    return () => {
      removeWidgetState(panel.id)
      unregisterWidgetSnapshot('w_recent_widget')
    }
  }, [panel.id, isLoading, error, workspaces.length])

  return (
    <BaseWidget
      panel={panel}
      onDoubleClick={onDoubleClick}
      isActive={isActive}
      onMouseDown={onMouseDown}
    >
      <WidgetLabel>Recent</WidgetLabel>

      {isLoading ? (
        <WidgetEmpty>Loading...</WidgetEmpty>
      ) : error ? (
        <WidgetEmpty>{error}</WidgetEmpty>
      ) : workspaces.length === 0 ? (
        <WidgetEmpty>No recent items</WidgetEmpty>
      ) : (
        <>
          <WidgetValue unit="items">{workspaces.length}</WidgetValue>

          <WidgetContent>
            <WidgetList>
              {workspaces.slice(0, WIDGET_ITEM_LIMIT).map((workspace) => (
                <WidgetListItemGradient
                  key={workspace.id}
                  letter={getInitial(getDisplayName(workspace))}
                >
                  {getDisplayName(workspace)}
                </WidgetListItemGradient>
              ))}
            </WidgetList>
          </WidgetContent>
        </>
      )}
    </BaseWidget>
  )
}

export default RecentWidget
