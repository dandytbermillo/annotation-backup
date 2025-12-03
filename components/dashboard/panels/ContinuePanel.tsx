"use client"

/**
 * Continue Panel Component
 * Part of Dashboard Implementation - Phase 2.2a
 *
 * Shows the last visited non-dashboard workspace and provides
 * a button to resume working in that workspace.
 */

import React, { useEffect, useState } from 'react'
import { Play, Clock, Loader2 } from 'lucide-react'
import { BaseDashboardPanel } from './BaseDashboardPanel'
import { panelTypeRegistry } from '@/lib/dashboard/panel-registry'
import type { BasePanelProps } from '@/lib/dashboard/panel-registry'
import { Button } from '@/components/ui/button'
import { setActiveWorkspaceContext } from '@/lib/note-workspaces/state'

interface LastWorkspaceInfo {
  id: string
  name: string
  entryName: string | null
  updatedAt: string | null
}

interface UserPreferences {
  lastWorkspaceId: string | null
  lastWorkspace: LastWorkspaceInfo | null
}

export function ContinuePanel({ panel, onClose, onNavigate, isActive }: BasePanelProps) {
  const panelDef = panelTypeRegistry.continue
  const [preferences, setPreferences] = useState<UserPreferences | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const fetchPreferences = async () => {
      try {
        setIsLoading(true)
        setError(null)

        // Fetch user preferences with last workspace info
        const response = await fetch('/api/dashboard/preferences')
        if (!response.ok) {
          // If API doesn't exist yet, show empty state
          if (response.status === 404) {
            setPreferences({ lastWorkspaceId: null, lastWorkspace: null })
            return
          }
          throw new Error('Failed to fetch preferences')
        }

        const data = await response.json()
        setPreferences(data)
      } catch (err) {
        console.error('[ContinuePanel] Failed to load preferences:', err)
        setError('Unable to load recent workspace')
        setPreferences({ lastWorkspaceId: null, lastWorkspace: null })
      } finally {
        setIsLoading(false)
      }
    }

    fetchPreferences()
  }, [])

  const handleContinue = () => {
    if (!preferences?.lastWorkspace) return

    const { id: workspaceId, entryName } = preferences.lastWorkspace

    // Set the active workspace context
    setActiveWorkspaceContext(workspaceId)

    // Call the navigate callback if provided
    if (onNavigate && entryName) {
      onNavigate(entryName, workspaceId)
    }
  }

  const formatRelativeTime = (dateString: string | null): string => {
    if (!dateString) return ''

    try {
      const date = new Date(dateString)
      const now = new Date()
      const diffMs = now.getTime() - date.getTime()
      const diffMins = Math.floor(diffMs / 60000)
      const diffHours = Math.floor(diffMins / 60)
      const diffDays = Math.floor(diffHours / 24)

      if (diffMins < 1) return 'Just now'
      if (diffMins < 60) return `${diffMins}m ago`
      if (diffHours < 24) return `${diffHours}h ago`
      if (diffDays < 7) return `${diffDays}d ago`

      return date.toLocaleDateString()
    } catch {
      return ''
    }
  }

  return (
    <BaseDashboardPanel
      panel={panel}
      panelDef={panelDef}
      onClose={onClose}
      isActive={isActive}
      contentClassName="p-4"
    >
      {isLoading ? (
        <div className="flex items-center justify-center h-full min-h-[60px]">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      ) : error ? (
        <div className="flex flex-col items-center justify-center h-full min-h-[60px] text-center">
          <p className="text-sm text-muted-foreground">{error}</p>
        </div>
      ) : preferences?.lastWorkspace ? (
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <span className="text-sm font-medium text-foreground truncate">
              {preferences.lastWorkspace.name}
            </span>
            {preferences.lastWorkspace.entryName && (
              <span className="text-xs text-muted-foreground truncate">
                in {preferences.lastWorkspace.entryName}
              </span>
            )}
            {preferences.lastWorkspace.updatedAt && (
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <Clock size={12} />
                <span>{formatRelativeTime(preferences.lastWorkspace.updatedAt)}</span>
              </div>
            )}
          </div>

          <Button
            onClick={handleContinue}
            className="w-full"
            size="sm"
          >
            <Play size={14} className="mr-1" />
            Continue
          </Button>
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center h-full min-h-[60px] text-center gap-2">
          <p className="text-sm text-muted-foreground">
            No recent workspace
          </p>
          <p className="text-xs text-muted-foreground/70">
            Visit a workspace to see it here
          </p>
        </div>
      )}
    </BaseDashboardPanel>
  )
}
