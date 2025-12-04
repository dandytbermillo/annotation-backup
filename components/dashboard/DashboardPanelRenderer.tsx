"use client"

/**
 * Dashboard Panel Renderer
 * Part of Dashboard Implementation - Phase 2.2
 *
 * Renders the appropriate panel component based on panel type.
 * Acts as a factory for panel components.
 */

import React from 'react'
import type { WorkspacePanel, BasePanelProps, PanelConfig } from '@/lib/dashboard/panel-registry'
import { isValidPanelType } from '@/lib/dashboard/panel-registry'
import { ContinuePanel } from './panels/ContinuePanel'
import { EntryNavigatorPanel } from './panels/EntryNavigatorPanel'
import { RecentPanel } from './panels/RecentPanel'
import { QuickCapturePanel } from './panels/QuickCapturePanel'
import { LinksNotePanel } from './panels/LinksNotePanel'

interface DashboardPanelRendererProps {
  panel: WorkspacePanel
  onClose?: () => void
  onConfigChange?: (config: Partial<PanelConfig>) => void
  onNavigate?: (entryId: string, workspaceId: string) => void
  isActive?: boolean
}

export function DashboardPanelRenderer({
  panel,
  onClose,
  onConfigChange,
  onNavigate,
  isActive,
}: DashboardPanelRendererProps) {
  if (!isValidPanelType(panel.panelType)) {
    console.warn(`[DashboardPanelRenderer] Unknown panel type: ${panel.panelType}`)
    return (
      <div className="p-4 bg-destructive/10 border border-destructive/20 rounded-lg">
        <p className="text-sm text-destructive">Unknown panel type: {panel.panelType}</p>
      </div>
    )
  }

  const props: BasePanelProps = {
    panel,
    onClose,
    onConfigChange,
    onNavigate,
    isActive,
  }

  switch (panel.panelType) {
    case 'continue':
      return <ContinuePanel {...props} />
    case 'navigator':
      return <EntryNavigatorPanel {...props} />
    case 'recent':
      return <RecentPanel {...props} />
    case 'quick_capture':
      return <QuickCapturePanel {...props} />
    case 'links_note':
      return <LinksNotePanel {...props} />
    case 'note':
      // Note panels are handled separately by the existing note panel system
      // This is just a placeholder - actual note panels use the existing canvas note rendering
      return (
        <div className="p-4 bg-muted rounded-lg">
          <p className="text-sm text-muted-foreground">
            Note panel: {panel.title || 'Untitled'}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            Note panels use the existing canvas note system
          </p>
        </div>
      )
    default:
      // TypeScript should catch this, but just in case
      return null
  }
}

/**
 * Hook to manage dashboard panels
 */
export function useDashboardPanels(workspaceId: string | null) {
  const [panels, setPanels] = React.useState<WorkspacePanel[]>([])
  const [isLoading, setIsLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  const fetchPanels = React.useCallback(async () => {
    if (!workspaceId) {
      setPanels([])
      setIsLoading(false)
      return
    }

    try {
      setIsLoading(true)
      setError(null)

      const response = await fetch(`/api/dashboard/panels?workspaceId=${workspaceId}`)
      if (!response.ok) {
        throw new Error('Failed to fetch panels')
      }

      const data = await response.json()
      setPanels(data.panels || [])
    } catch (err) {
      console.error('[useDashboardPanels] Failed to fetch panels:', err)
      setError('Failed to load panels')
    } finally {
      setIsLoading(false)
    }
  }, [workspaceId])

  React.useEffect(() => {
    fetchPanels()
  }, [fetchPanels])

  const updatePanelConfig = React.useCallback(async (
    panelId: string,
    config: Partial<PanelConfig>
  ) => {
    try {
      const response = await fetch(`/api/dashboard/panels/${panelId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config }),
      })

      if (!response.ok) {
        throw new Error('Failed to update panel config')
      }

      // Update local state
      setPanels(prev => prev.map(p =>
        p.id === panelId
          ? { ...p, config: { ...p.config, ...config } }
          : p
      ))
    } catch (err) {
      console.error('[useDashboardPanels] Failed to update panel config:', err)
    }
  }, [])

  const updatePanelPosition = React.useCallback(async (
    panelId: string,
    position: { x: number; y: number }
  ) => {
    try {
      const response = await fetch(`/api/dashboard/panels/${panelId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          positionX: position.x,
          positionY: position.y,
        }),
      })

      if (!response.ok) {
        throw new Error('Failed to update panel position')
      }

      // Update local state
      setPanels(prev => prev.map(p =>
        p.id === panelId
          ? { ...p, positionX: position.x, positionY: position.y }
          : p
      ))
    } catch (err) {
      console.error('[useDashboardPanels] Failed to update panel position:', err)
    }
  }, [])

  const updatePanelSize = React.useCallback(async (
    panelId: string,
    size: { width: number; height: number }
  ) => {
    try {
      const response = await fetch(`/api/dashboard/panels/${panelId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(size),
      })

      if (!response.ok) {
        throw new Error('Failed to update panel size')
      }

      // Update local state
      setPanels(prev => prev.map(p =>
        p.id === panelId
          ? { ...p, width: size.width, height: size.height }
          : p
      ))
    } catch (err) {
      console.error('[useDashboardPanels] Failed to update panel size:', err)
    }
  }, [])

  const deletePanel = React.useCallback(async (panelId: string) => {
    try {
      const response = await fetch(`/api/dashboard/panels/${panelId}`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        throw new Error('Failed to delete panel')
      }

      // Update local state
      setPanels(prev => prev.filter(p => p.id !== panelId))
    } catch (err) {
      console.error('[useDashboardPanels] Failed to delete panel:', err)
    }
  }, [])

  return {
    panels,
    isLoading,
    error,
    fetchPanels,
    updatePanelConfig,
    updatePanelPosition,
    updatePanelSize,
    deletePanel,
  }
}
