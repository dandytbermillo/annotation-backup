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
                  letter={getInitial(workspace.name)}
                >
                  {workspace.name}
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
