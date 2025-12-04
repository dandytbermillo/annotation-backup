"use client"

/**
 * Recent Panel Component
 * Part of Dashboard Implementation - Phase 2.2c
 *
 * Shows a list of recently visited workspaces for quick access.
 */

import React, { useEffect, useState } from 'react'
import { Clock, RefreshCw } from 'lucide-react'
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
      aria-label="Refresh recent workspaces"
      style={{
        width: 24,
        height: 24,
        background: 'transparent',
        border: 'none',
        borderRadius: 4,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        color: '#5c6070',
      }}
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
      contentClassName="p-3"
    >
      {isLoading ? (
        <div className="flex items-center justify-center h-full min-h-[80px]">
          <div
            style={{
              width: 24,
              height: 24,
              borderRadius: '50%',
              border: '2px solid rgba(255,255,255,0.1)',
              borderTopColor: '#6366f1',
              animation: 'spin 1s linear infinite',
            }}
          />
        </div>
      ) : error ? (
        <div
          className="flex flex-col items-center justify-center text-center min-h-[80px]"
          style={{ color: '#8b8fa3' }}
        >
          <p style={{ fontSize: 12 }}>{error}</p>
        </div>
      ) : workspaces.length === 0 ? (
        <div
          className="flex flex-col items-center justify-center text-center min-h-[80px]"
          style={{ color: '#8b8fa3' }}
        >
          <Clock size={24} style={{ opacity: 0.5, marginBottom: 8 }} />
          <p style={{ fontSize: 12 }}>No recent workspaces</p>
          <p style={{ fontSize: 11, color: '#5c6070', marginTop: 4 }}>
            Workspaces you visit will appear here
          </p>
        </div>
      ) : (
        <div className="space-y-0.5">
          {workspaces.map(workspace => (
            <div
              key={workspace.id}
              onClick={() => handleWorkspaceClick(workspace)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => e.key === 'Enter' && handleWorkspaceClick(workspace)}
              className="flex items-center gap-3 cursor-pointer"
              style={{
                padding: '8px 10px',
                borderRadius: 8,
                transition: 'background 0.15s ease',
              }}
              onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255, 255, 255, 0.04)'}
              onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
            >
              <div className="flex items-center gap-3 flex-1 min-w-0">
                <div
                  className="shrink-0 flex items-center justify-center"
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: 8,
                    background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
                    color: '#fff',
                    fontSize: 12,
                    fontWeight: 600,
                  }}
                >
                  {workspace.entryName?.charAt(0).toUpperCase() || 'W'}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="truncate" style={{ fontSize: 13, fontWeight: 500, color: '#f0f0f0' }}>
                    {workspace.name}
                  </div>
                  {workspace.entryName && (
                    <div className="truncate" style={{ fontSize: 11, color: '#5c6070' }}>
                      {workspace.entryName}
                    </div>
                  )}
                </div>
              </div>
              <span className="whitespace-nowrap shrink-0" style={{ fontSize: 11, color: '#5c6070' }}>
                {formatRelativeTime(workspace.lastAccessedAt)}
              </span>
            </div>
          ))}
        </div>
      )}
    </BaseDashboardPanel>
  )
}
