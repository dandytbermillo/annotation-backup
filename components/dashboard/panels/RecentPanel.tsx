"use client"

/**
 * Recent Panel Component
 * Part of Dashboard Implementation - Phase 2.2c
 *
 * Shows a list of recently visited workspaces for quick access.
 */

import React, { useEffect, useState } from 'react'
import { Clock, Loader2, RefreshCw } from 'lucide-react'
import { BaseDashboardPanel } from './BaseDashboardPanel'
import { panelTypeRegistry } from '@/lib/dashboard/panel-registry'
import type { BasePanelProps, PanelConfig } from '@/lib/dashboard/panel-registry'
import { cn } from '@/lib/utils'
import { setActiveWorkspaceContext } from '@/lib/note-workspaces/state'

interface RecentConfig extends PanelConfig {
  limit?: number
}

interface RecentWorkspace {
  id: string
  name: string
  entryId: string | null
  entryName: string | null
  lastAccessedAt: string
}

export function RecentPanel({ panel, onClose, onNavigate, isActive }: BasePanelProps) {
  const panelDef = panelTypeRegistry.recent
  const config = panel.config as RecentConfig
  const limit = config.limit || 10

  const [workspaces, setWorkspaces] = useState<RecentWorkspace[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchRecentWorkspaces = async () => {
    try {
      setIsLoading(true)
      setError(null)

      const response = await fetch(`/api/dashboard/recent?limit=${limit}`)
      if (!response.ok) {
        // If API doesn't exist yet, show empty state
        if (response.status === 404) {
          setWorkspaces([])
          return
        }
        throw new Error('Failed to fetch recent workspaces')
      }

      const data = await response.json()
      setWorkspaces(data.workspaces || [])
    } catch (err) {
      console.error('[RecentPanel] Failed to load recent workspaces:', err)
      setError('Unable to load recent workspaces')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    fetchRecentWorkspaces()
  }, [limit])

  const handleWorkspaceClick = (workspace: RecentWorkspace) => {
    setActiveWorkspaceContext(workspace.id)
    if (onNavigate && workspace.entryId) {
      onNavigate(workspace.entryId, workspace.id)
    }
  }

  const formatRelativeTime = (dateString: string): string => {
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

  const headerActions = (
    <button
      onClick={() => fetchRecentWorkspaces()}
      disabled={isLoading}
      className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
      aria-label="Refresh recent workspaces"
    >
      <RefreshCw size={14} className={cn(isLoading && 'animate-spin')} />
    </button>
  )

  return (
    <BaseDashboardPanel
      panel={panel}
      panelDef={panelDef}
      onClose={onClose}
      isActive={isActive}
      headerActions={headerActions}
      contentClassName="p-2"
    >
      {isLoading ? (
        <div className="flex items-center justify-center h-full min-h-[80px]">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      ) : error ? (
        <div className="flex flex-col items-center justify-center h-full min-h-[80px] text-center p-4">
          <p className="text-sm text-muted-foreground">{error}</p>
        </div>
      ) : workspaces.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-full min-h-[80px] text-center p-4">
          <Clock size={24} className="text-muted-foreground/50 mb-2" />
          <p className="text-sm text-muted-foreground">No recent workspaces</p>
          <p className="text-xs text-muted-foreground/70 mt-1">
            Workspaces you visit will appear here
          </p>
        </div>
      ) : (
        <div className="space-y-0.5">
          {workspaces.map(workspace => (
            <button
              key={workspace.id}
              onClick={() => handleWorkspaceClick(workspace)}
              className="w-full flex items-start gap-2 px-2 py-2 text-left rounded hover:bg-muted/50 transition-colors group"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-foreground truncate group-hover:text-primary transition-colors">
                    {workspace.name}
                  </span>
                </div>
                <div className="flex items-center gap-2 mt-0.5">
                  {workspace.entryName && (
                    <span className="text-xs text-muted-foreground truncate">
                      in {workspace.entryName}
                    </span>
                  )}
                </div>
              </div>
              <span className="text-xs text-muted-foreground whitespace-nowrap shrink-0">
                {formatRelativeTime(workspace.lastAccessedAt)}
              </span>
            </button>
          ))}
        </div>
      )}
    </BaseDashboardPanel>
  )
}
