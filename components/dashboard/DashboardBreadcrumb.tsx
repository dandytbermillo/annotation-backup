"use client"

/**
 * Dashboard Breadcrumb Component
 * Part of Dashboard Implementation - Phase 3.2
 *
 * Shows the current location in the Entry → Workspace hierarchy.
 * Format: Entry Name / Workspace Name
 * Example: "Home / Dashboard" or "Project Alpha / Research Notes"
 */

import React, { useEffect, useState, useMemo } from 'react'
import { ChevronRight, Home, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  getActiveWorkspaceContext,
  subscribeToActiveWorkspaceContext,
} from '@/lib/note-workspaces/state'

interface BreadcrumbInfo {
  entryId: string
  entryName: string
  entryIcon?: string | null
  isSystemEntry: boolean
  workspaceId: string
  workspaceName: string
}

interface DashboardBreadcrumbProps {
  /** Optional workspace ID override (otherwise uses active context) */
  workspaceId?: string | null
  /** Callback when entry segment is clicked */
  onEntryClick?: (entryId: string) => void
  /** Callback when workspace segment is clicked */
  onWorkspaceClick?: (workspaceId: string) => void
  /** Callback when Home icon is clicked */
  onHomeClick?: () => void
  /** Additional className */
  className?: string
  /** Whether to show the Home icon shortcut */
  showHomeIcon?: boolean
  /** Whether to show loading state */
  showLoading?: boolean
}

export function DashboardBreadcrumb({
  workspaceId: propWorkspaceId,
  onEntryClick,
  onWorkspaceClick,
  onHomeClick,
  className,
  showHomeIcon = true,
  showLoading = true,
}: DashboardBreadcrumbProps) {
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(
    propWorkspaceId ?? getActiveWorkspaceContext()
  )
  const [breadcrumbInfo, setBreadcrumbInfo] = useState<BreadcrumbInfo | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Subscribe to workspace context changes if not using prop
  useEffect(() => {
    if (propWorkspaceId !== undefined) {
      setActiveWorkspaceId(propWorkspaceId)
      return
    }

    const unsubscribe = subscribeToActiveWorkspaceContext((wsId) => {
      setActiveWorkspaceId(wsId)
    })

    return unsubscribe
  }, [propWorkspaceId])

  // Fetch breadcrumb info when workspace changes
  useEffect(() => {
    if (!activeWorkspaceId) {
      setBreadcrumbInfo(null)
      return
    }

    const fetchBreadcrumb = async () => {
      try {
        setIsLoading(true)
        setError(null)

        const response = await fetch(
          `/api/dashboard/breadcrumb?workspaceId=${activeWorkspaceId}`
        )

        if (!response.ok) {
          if (response.status === 404) {
            setBreadcrumbInfo(null)
            return
          }
          throw new Error('Failed to fetch breadcrumb')
        }

        const data = await response.json()
        setBreadcrumbInfo(data)
      } catch (err) {
        console.error('[DashboardBreadcrumb] Failed to fetch:', err)
        setError(err instanceof Error ? err.message : 'Failed to load')
        setBreadcrumbInfo(null)
      } finally {
        setIsLoading(false)
      }
    }

    fetchBreadcrumb()
  }, [activeWorkspaceId])

  // Memoize whether this is the Home/Dashboard
  const isHomeDashboard = useMemo(() => {
    return breadcrumbInfo?.isSystemEntry && breadcrumbInfo?.workspaceName === 'Dashboard'
  }, [breadcrumbInfo])

  if (!activeWorkspaceId) {
    return null
  }

  if (isLoading && showLoading) {
    return (
      <div className={cn('flex items-center gap-2 text-sm text-muted-foreground', className)}>
        <Loader2 size={14} className="animate-spin" />
        <span>Loading...</span>
      </div>
    )
  }

  if (error || !breadcrumbInfo) {
    return null
  }

  return (
    <nav
      aria-label="Breadcrumb"
      className={cn('flex items-center gap-1 text-sm', className)}
    >
      {/* Home icon shortcut */}
      {showHomeIcon && onHomeClick && (
        <>
          <button
            onClick={onHomeClick}
            className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Go to Home"
            title="Go to Home (Cmd+Shift+H)"
          >
            <Home size={14} />
          </button>
          <ChevronRight size={14} className="text-muted-foreground/50" />
        </>
      )}

      {/* Entry segment */}
      <button
        onClick={() => onEntryClick?.(breadcrumbInfo.entryId)}
        className={cn(
          'flex items-center gap-1 px-1.5 py-0.5 rounded transition-colors',
          'text-muted-foreground hover:text-foreground hover:bg-muted',
          onEntryClick ? 'cursor-pointer' : 'cursor-default'
        )}
        disabled={!onEntryClick}
      >
        {breadcrumbInfo.entryIcon ? (
          <span className="text-sm">{breadcrumbInfo.entryIcon}</span>
        ) : breadcrumbInfo.isSystemEntry ? (
          <Home size={12} className="text-muted-foreground" />
        ) : null}
        <span className="font-medium">{breadcrumbInfo.entryName}</span>
      </button>

      {/* Separator */}
      <ChevronRight size={14} className="text-muted-foreground/50" />

      {/* Workspace segment */}
      <button
        onClick={() => onWorkspaceClick?.(breadcrumbInfo.workspaceId)}
        className={cn(
          'flex items-center gap-1 px-1.5 py-0.5 rounded transition-colors',
          'text-foreground font-medium',
          onWorkspaceClick ? 'hover:bg-muted cursor-pointer' : 'cursor-default'
        )}
        disabled={!onWorkspaceClick}
        aria-current="page"
      >
        <span>{breadcrumbInfo.workspaceName}</span>
      </button>

      {/* Keyboard shortcut hint for Home */}
      {isHomeDashboard && (
        <span className="ml-2 text-xs text-muted-foreground/50 hidden sm:inline">
          <kbd className="px-1 py-0.5 bg-muted rounded text-[10px]">⌘⇧H</kbd>
        </span>
      )}
    </nav>
  )
}

/**
 * Compact version for use in toolbars
 */
export function CompactBreadcrumb({
  className,
  ...props
}: Omit<DashboardBreadcrumbProps, 'showHomeIcon' | 'showLoading'>) {
  return (
    <DashboardBreadcrumb
      {...props}
      className={cn('text-xs', className)}
      showHomeIcon={false}
      showLoading={false}
    />
  )
}
