"use client"

/**
 * Continue Panel Component
 * Part of Dashboard Implementation - Phase 2.2a
 *
 * Shows the last visited non-dashboard workspace and provides
 * a button to resume working in that workspace.
 */

import React, { useEffect, useState } from 'react'
import { Play, Clock } from 'lucide-react'
import { BaseDashboardPanel } from './BaseDashboardPanel'
import { panelTypeRegistry } from '@/lib/dashboard/panel-registry'
import type { BasePanelProps } from '@/lib/dashboard/panel-registry'
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

export function ContinuePanel({ panel, onClose, onTitleChange, onNavigate, isActive }: BasePanelProps) {
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
      onTitleChange={onTitleChange}
      isActive={isActive}
      contentClassName="p-4"
    >
      {isLoading ? (
        <div className="flex items-center justify-center h-full min-h-[60px]">
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
          className="flex flex-col items-center justify-center text-center min-h-[60px]"
          style={{ color: '#8b8fa3' }}
        >
          <p style={{ fontSize: 12 }}>{error}</p>
        </div>
      ) : preferences?.lastWorkspace ? (
        <div
          onClick={handleContinue}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => e.key === 'Enter' && handleContinue()}
          className="flex items-center gap-4 cursor-pointer"
          style={{
            padding: 16,
            borderRadius: 10,
            background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.15) 0%, rgba(139, 92, 246, 0.1) 100%)',
            border: '1px solid rgba(99, 102, 241, 0.2)',
            transition: 'all 0.2s ease',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'linear-gradient(135deg, rgba(99, 102, 241, 0.2) 0%, rgba(139, 92, 246, 0.15) 100%)'
            e.currentTarget.style.borderColor = 'rgba(99, 102, 241, 0.3)'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'linear-gradient(135deg, rgba(99, 102, 241, 0.15) 0%, rgba(139, 92, 246, 0.1) 100%)'
            e.currentTarget.style.borderColor = 'rgba(99, 102, 241, 0.2)'
          }}
        >
          <div
            className="shrink-0 flex items-center justify-center"
            style={{
              width: 40,
              height: 40,
              borderRadius: 10,
              background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
              color: '#fff',
            }}
          >
            <Play size={20} />
          </div>
          <div className="flex-1 min-w-0">
            <div style={{ fontSize: 11, color: '#8b8fa3', marginBottom: 4 }}>
              Continue where you left off
            </div>
            <div className="truncate" style={{ fontSize: 14, fontWeight: 600, color: '#f0f0f0' }}>
              {preferences.lastWorkspace.name}
            </div>
            <div className="flex items-center gap-2" style={{ fontSize: 11, color: '#5c6070', marginTop: 4 }}>
              {preferences.lastWorkspace.entryName && (
                <span className="truncate">in {preferences.lastWorkspace.entryName}</span>
              )}
              {preferences.lastWorkspace.updatedAt && (
                <span className="flex items-center gap-1">
                  <Clock size={10} />
                  {formatRelativeTime(preferences.lastWorkspace.updatedAt)}
                </span>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div
          className="flex flex-col items-center justify-center text-center min-h-[60px]"
          style={{ color: '#8b8fa3' }}
        >
          <Play size={24} style={{ opacity: 0.5, marginBottom: 8 }} />
          <p style={{ fontSize: 12 }}>No recent workspace</p>
          <p style={{ fontSize: 11, color: '#5c6070', marginTop: 4 }}>Visit a workspace to see it here</p>
        </div>
      )}
    </BaseDashboardPanel>
  )
}
