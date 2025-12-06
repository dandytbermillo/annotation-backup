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

interface AncestorEntry {
  entryId: string
  entryName: string
  entryIcon?: string | null
  isSystemEntry: boolean
  dashboardWorkspaceId?: string | null
}

interface BreadcrumbInfo {
  ancestors: AncestorEntry[]
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

  // Get ancestors excluding the current entry (which we'll show separately with workspace)
  // Also skip the root folder (Knowledge Base / Home) since we show Home icon separately
  // NOTE: This hook MUST be called before any conditional returns to maintain hook order
  const ancestorsToShow = useMemo(() => {
    if (!breadcrumbInfo?.ancestors) return []
    // All ancestors except the last one (which is the current entry)
    const withoutCurrent = breadcrumbInfo.ancestors.slice(0, -1)
    // Skip the first entry if it's the root folder (we show Home icon instead)
    // Root folder is either a system entry OR named "Knowledge Base"
    if (withoutCurrent.length > 0 && showHomeIcon) {
      const firstAncestor = withoutCurrent[0]
      if (firstAncestor.isSystemEntry || firstAncestor.entryName === 'Knowledge Base') {
        return withoutCurrent.slice(1)
      }
    }
    return withoutCurrent
  }, [breadcrumbInfo?.ancestors, showHomeIcon])

  // Get the current entry (last in ancestors array)
  // NOTE: This hook MUST be called before any conditional returns to maintain hook order
  const currentEntry = useMemo(() => {
    if (!breadcrumbInfo?.ancestors || breadcrumbInfo.ancestors.length === 0) {
      // Fallback to direct entry info for backward compatibility
      return {
        entryId: breadcrumbInfo?.entryId || '',
        entryName: breadcrumbInfo?.entryName || 'Unknown',
        entryIcon: breadcrumbInfo?.entryIcon,
        isSystemEntry: breadcrumbInfo?.isSystemEntry || false,
        dashboardWorkspaceId: null,
      }
    }
    return breadcrumbInfo.ancestors[breadcrumbInfo.ancestors.length - 1]
  }, [breadcrumbInfo])

  // Conditional returns AFTER all hooks
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

  // Handler for ancestor click - navigate to that entry's dashboard
  const handleAncestorClick = (ancestor: AncestorEntry) => {
    if (ancestor.dashboardWorkspaceId && onWorkspaceClick) {
      onWorkspaceClick(ancestor.dashboardWorkspaceId)
    } else if (onEntryClick) {
      onEntryClick(ancestor.entryId)
    }
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

      {/* Ancestor entries (parents of current entry) */}
      {ancestorsToShow.map((ancestor) => (
        <React.Fragment key={ancestor.entryId}>
          <button
            onClick={() => handleAncestorClick(ancestor)}
            className={cn(
              'flex items-center gap-1 px-1.5 py-0.5 rounded transition-colors',
              'text-muted-foreground hover:text-foreground hover:bg-muted',
              'cursor-pointer'
            )}
          >
            {ancestor.entryIcon ? (
              <span className="text-sm">{ancestor.entryIcon}</span>
            ) : ancestor.isSystemEntry ? (
              <Home size={12} className="text-muted-foreground" />
            ) : null}
            <span className="font-medium">{ancestor.entryName}</span>
          </button>
          <ChevronRight size={14} className="text-muted-foreground/50" />
        </React.Fragment>
      ))}

      {/* Current entry segment */}
      <button
        onClick={() => onEntryClick?.(currentEntry.entryId)}
        className={cn(
          'flex items-center gap-1 px-1.5 py-0.5 rounded transition-colors',
          'text-muted-foreground hover:text-foreground hover:bg-muted',
          onEntryClick ? 'cursor-pointer' : 'cursor-default'
        )}
        disabled={!onEntryClick}
      >
        {currentEntry.entryIcon ? (
          <span className="text-sm">{currentEntry.entryIcon}</span>
        ) : currentEntry.isSystemEntry ? (
          <Home size={12} className="text-muted-foreground" />
        ) : null}
        <span className="font-medium">{currentEntry.entryName}</span>
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
