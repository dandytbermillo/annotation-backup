"use client"

/**
 * Category Navigator Panel Component
 *
 * Shows all workspace links (highlighted text) from all Quick Links panels
 * in the current dashboard. Provides a unified view of all linked entries.
 */

import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { ChevronRight, Link2, RefreshCw, Search, Eye, ExternalLink, Trash2, RotateCcw } from 'lucide-react'
import { BaseDashboardPanel } from './BaseDashboardPanel'
import { panelTypeRegistry } from '@/lib/dashboard/panel-registry'
import type { BasePanelProps, PanelConfig } from '@/lib/dashboard/panel-registry'
import { cn } from '@/lib/utils'
import { setActiveWorkspaceContext } from '@/lib/note-workspaces/state'
import { setActiveEntryContext } from '@/lib/entry'
import { CategoryNavigatorPanelSkeleton } from './PanelSkeletons'
import { subscribeToDashboardPanelRefresh } from '@/lib/dashboard/category-store'
import { debugLog } from '@/lib/utils/debug-logger'

interface CategoryNavigatorConfig extends PanelConfig {
  expandedPanels?: string[]
}

interface ExtractedLink {
  text: string
  workspaceId: string
  workspaceName: string
  entryId: string
  entryName: string
  dashboardId?: string
}

interface QuickLinksPanel {
  id: string
  title: string
  links: ExtractedLink[]
  badge: string | null
  htmlContent: string // Raw HTML content for preview
  isVisible: boolean // Whether the panel is visible on dashboard (false = hidden/closed)
}

interface TrashedQuickLinksPanel {
  id: string
  title: string
  badge: string | null
  deletedAt: string // ISO date string
  linkCount: number
}

interface PreviewPopup {
  panelId: string
  panelTitle: string
  htmlContent: string
  position: { x: number; y: number }
}

interface LinkTooltip {
  element: HTMLElement
  rect: DOMRect
  entryId: string | null
  workspaceId: string | null
  dashboardId: string | null
  workspaceName: string | null
}

export function CategoryNavigatorPanel({ panel, onClose, onConfigChange, onTitleChange, onNavigate, onDelete, isActive }: BasePanelProps) {
  const panelDef = panelTypeRegistry.category_navigator
  const config = panel.config as CategoryNavigatorConfig

  const [quickLinksPanels, setQuickLinksPanels] = useState<QuickLinksPanel[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expandedIds, setExpandedIds] = useState<Set<string>>(
    new Set(config.expandedPanels || [])
  )
  const [searchQuery, setSearchQuery] = useState('')
  const loadDataCallCountRef = useRef(0)

  // Trash section state
  const [trashedPanels, setTrashedPanels] = useState<TrashedQuickLinksPanel[]>([])
  const [isTrashExpanded, setIsTrashExpanded] = useState(false)
  const [restoringPanelId, setRestoringPanelId] = useState<string | null>(null)

  // Preview popup state
  const [previewPopup, setPreviewPopup] = useState<PreviewPopup | null>(null)
  const previewTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  // Link tooltip state (for links inside preview popup)
  const [linkTooltip, setLinkTooltip] = useState<LinkTooltip | null>(null)
  const linkTooltipTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const previewContentRef = useRef<HTMLDivElement>(null)

  // Log component mount
  useEffect(() => {
    debugLog({
      component: 'CategoryNavigatorPanel',
      action: 'component_mounted',
      metadata: { panelId: panel.id, workspaceId: panel.workspaceId },
    })
    return () => {
      debugLog({
        component: 'CategoryNavigatorPanel',
        action: 'component_unmounted',
        metadata: { panelId: panel.id },
      })
    }
  }, [panel.id, panel.workspaceId])
  const searchInputRef = useRef<HTMLInputElement>(null)

  // Parse HTML content to extract workspace links
  const parseLinksFromContent = useCallback((html: string): ExtractedLink[] => {
    if (!html) return []

    const links: ExtractedLink[] = []

    // Create a temporary div to parse HTML
    const div = document.createElement('div')
    div.innerHTML = html

    // Find all workspace-link spans
    const linkElements = div.querySelectorAll('.workspace-link')

    linkElements.forEach((el) => {
      const text = el.textContent || ''
      const workspaceId = el.getAttribute('data-workspace-id') || ''
      const workspaceName = el.getAttribute('data-workspace') || text
      const entryId = el.getAttribute('data-entry-id') || ''
      const entryName = el.getAttribute('data-entry-name') || ''
      const dashboardId = el.getAttribute('data-dashboard-id') || undefined

      if (text || workspaceName) {
        links.push({
          text,
          workspaceId,
          workspaceName,
          entryId,
          entryName,
          dashboardId,
        })
      }
    })

    return links
  }, [])

  // Fetch all Quick Links panels from current dashboard
  const loadData = useCallback(async (forceRefresh = false) => {
    loadDataCallCountRef.current += 1
    const callCount = loadDataCallCountRef.current

    debugLog({
      component: 'CategoryNavigatorPanel',
      action: 'load_data_started',
      metadata: {
        callCount,
        forceRefresh,
        workspaceId: panel.workspaceId,
        panelId: panel.id,
      },
    })

    // Prevent infinite loops - if called more than 10 times, stop
    if (callCount > 10) {
      console.error('[CategoryNavigatorPanel] Too many loadData calls, stopping to prevent infinite loop')
      debugLog({
        component: 'CategoryNavigatorPanel',
        action: 'load_data_stopped_infinite_loop',
        metadata: { callCount },
      })
      return
    }

    try {
      setIsLoading(true)
      setError(null)

      // Get the workspace ID from the current panel's workspace
      const workspaceId = panel.workspaceId

      // Fetch all panels for this workspace (including hidden ones)
      // We need hidden panels to show them in the list and allow users to re-open them
      debugLog({
        component: 'CategoryNavigatorPanel',
        action: 'fetching_panels',
        metadata: { workspaceId, callCount },
      })

      const response = await fetch(`/api/dashboard/panels?workspaceId=${workspaceId}&includeHidden=true`)
      if (!response.ok) {
        throw new Error('Failed to fetch panels')
      }

      const data = await response.json()
      const allPanels = data.panels || []

      debugLog({
        component: 'CategoryNavigatorPanel',
        action: 'panels_fetched',
        metadata: {
          totalPanels: allPanels.length,
          panelTypes: allPanels.map((p: any) => p.panelType),
          callCount,
        },
      })

      // Filter to only links_note panels and parse their content
      const linksNotePanels: QuickLinksPanel[] = allPanels
        .filter((p: any) => p.panelType === 'links_note')
        .map((p: any) => ({
          id: p.id,
          title: p.title || 'Quick Links',
          links: parseLinksFromContent(p.config?.content || ''),
          badge: p.badge || null,
          htmlContent: p.config?.content || '', // Store raw HTML for preview
          isVisible: p.isVisible !== false, // Default to true if not specified
        }))
        .filter((p: QuickLinksPanel) => p.links.length > 0) // Only show panels with links

      debugLog({
        component: 'CategoryNavigatorPanel',
        action: 'load_data_completed',
        metadata: {
          linksNotePanelsCount: linksNotePanels.length,
          totalLinks: linksNotePanels.reduce((sum, p) => sum + p.links.length, 0),
          callCount,
        },
      })

      setQuickLinksPanels(linksNotePanels)

      // Also fetch deleted panels for the Trash section
      try {
        const deletedResponse = await fetch(`/api/dashboard/panels?workspaceId=${workspaceId}&onlyDeleted=true`)
        if (deletedResponse.ok) {
          const deletedData = await deletedResponse.json()
          const deletedPanels = deletedData.panels || []

          // Filter to only links_note panels and map to trash panel format
          const trashedLinksPanels: TrashedQuickLinksPanel[] = deletedPanels
            .filter((p: any) => p.panelType === 'links_note')
            .map((p: any) => ({
              id: p.id,
              title: p.title || 'Quick Links',
              badge: p.badge || null,
              deletedAt: p.deletedAt,
              linkCount: parseLinksFromContent(p.config?.content || '').length,
            }))

          debugLog({
            component: 'CategoryNavigatorPanel',
            action: 'trash_panels_loaded',
            metadata: { trashedCount: trashedLinksPanels.length, callCount },
          })

          setTrashedPanels(trashedLinksPanels)
        }
      } catch (trashErr) {
        console.error('[CategoryNavigatorPanel] Failed to load trashed panels:', trashErr)
        // Don't set error - just continue without trash section
      }
    } catch (err) {
      console.error('[CategoryNavigatorPanel] Failed to load data:', err)
      debugLog({
        component: 'CategoryNavigatorPanel',
        action: 'load_data_error',
        metadata: { error: String(err), callCount },
      })
      setError('Unable to load links')
    } finally {
      setIsLoading(false)
    }
  }, [panel.workspaceId, panel.id, parseLinksFromContent])

  useEffect(() => {
    debugLog({
      component: 'CategoryNavigatorPanel',
      action: 'initial_load_effect',
      metadata: { panelId: panel.id },
    })
    loadData()
  }, [loadData, panel.id])

  // Subscribe to panel refresh events (triggered when Quick Links panels are updated)
  useEffect(() => {
    debugLog({
      component: 'CategoryNavigatorPanel',
      action: 'subscribing_to_refresh',
      metadata: { panelId: panel.id },
    })
    const unsubscribe = subscribeToDashboardPanelRefresh(() => {
      debugLog({
        component: 'CategoryNavigatorPanel',
        action: 'refresh_triggered_by_subscription',
        metadata: { panelId: panel.id },
      })
      loadData(true)
    })
    return () => {
      debugLog({
        component: 'CategoryNavigatorPanel',
        action: 'unsubscribing_from_refresh',
        metadata: { panelId: panel.id },
      })
      unsubscribe()
    }
  }, [loadData, panel.id])

  // Filter links by search query
  const filteredPanels = useMemo(() => {
    if (!searchQuery.trim()) return quickLinksPanels

    const query = searchQuery.toLowerCase()
    return quickLinksPanels
      .map(panel => ({
        ...panel,
        links: panel.links.filter(link =>
          link.text.toLowerCase().includes(query) ||
          link.workspaceName.toLowerCase().includes(query) ||
          link.entryName.toLowerCase().includes(query)
        ),
      }))
      .filter(panel => panel.links.length > 0)
  }, [quickLinksPanels, searchQuery])

  // Total link count
  const totalLinks = useMemo(() => {
    return filteredPanels.reduce((sum, panel) => sum + panel.links.length, 0)
  }, [filteredPanels])

  // Toggle expand/collapse
  const toggleExpand = useCallback((id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }

      // Persist to config
      onConfigChange?.({ expandedPanels: Array.from(next) })

      return next
    })
  }, [onConfigChange])

  // Navigate to workspace/entry
  const handleLinkClick = useCallback((link: ExtractedLink) => {
    const targetWorkspaceId = link.dashboardId || link.workspaceId

    if (link.entryId) {
      setActiveEntryContext(link.entryId)
    }
    if (targetWorkspaceId) {
      setActiveWorkspaceContext(targetWorkspaceId)
    }

    onNavigate?.(link.entryId || '', targetWorkspaceId || '')
  }, [onNavigate])

  // Preview popup handlers
  const handlePreviewEyeEnter = useCallback((
    quickLinksPanel: QuickLinksPanel,
    event: React.MouseEvent<HTMLElement>
  ) => {
    // Clear any pending hide timeout
    if (previewTimeoutRef.current) {
      clearTimeout(previewTimeoutRef.current)
      previewTimeoutRef.current = null
    }

    const rect = event.currentTarget.getBoundingClientRect()
    // Position to the right of the eye icon, or below if not enough space
    const spaceRight = window.innerWidth - rect.right
    const position = spaceRight > 300
      ? { x: rect.right + 8, y: rect.top - 10 }
      : { x: rect.left - 280, y: rect.top - 10 }

    setPreviewPopup({
      panelId: quickLinksPanel.id,
      panelTitle: quickLinksPanel.title,
      htmlContent: quickLinksPanel.htmlContent,
      position,
    })
  }, [])

  const handlePreviewEyeLeave = useCallback(() => {
    // Delay hiding to allow moving to popup
    previewTimeoutRef.current = setTimeout(() => {
      setPreviewPopup(null)
    }, 150)
  }, [])

  const handlePreviewPopupEnter = useCallback(() => {
    // Cancel hide timeout when entering popup
    if (previewTimeoutRef.current) {
      clearTimeout(previewTimeoutRef.current)
      previewTimeoutRef.current = null
    }
  }, [])

  const handlePreviewPopupLeave = useCallback(() => {
    setPreviewPopup(null)
    setLinkTooltip(null) // Also clear link tooltip when leaving popup
  }, [])

  // Link tooltip handlers for links inside preview popup
  const handlePreviewLinkMouseEnter = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement
    if (!target.classList.contains('workspace-link')) return

    // Clear any pending hide timeout
    if (linkTooltipTimeoutRef.current) {
      clearTimeout(linkTooltipTimeoutRef.current)
      linkTooltipTimeoutRef.current = null
    }

    const rect = target.getBoundingClientRect()
    setLinkTooltip({
      element: target,
      rect,
      entryId: target.getAttribute('data-entry-id'),
      workspaceId: target.getAttribute('data-workspace-id'),
      dashboardId: target.getAttribute('data-dashboard-id'),
      workspaceName: target.getAttribute('data-workspace') || target.textContent,
    })
  }, [])

  const handlePreviewLinkMouseLeave = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement
    if (!target.classList.contains('workspace-link')) return

    // Check if mouse is moving to the tooltip
    const relatedTarget = e.relatedTarget as HTMLElement | null
    if (relatedTarget?.closest('.link-navigate-tooltip')) {
      return // Don't hide if moving to tooltip
    }

    // Delay hiding to allow moving to tooltip
    linkTooltipTimeoutRef.current = setTimeout(() => {
      setLinkTooltip(null)
    }, 200) // Increased delay
  }, [])

  const handleLinkTooltipEnter = useCallback(() => {
    if (linkTooltipTimeoutRef.current) {
      clearTimeout(linkTooltipTimeoutRef.current)
      linkTooltipTimeoutRef.current = null
    }
  }, [])

  const handleLinkTooltipLeave = useCallback(() => {
    setLinkTooltip(null)
  }, [])

  // Navigate from link tooltip
  const handleNavigateFromLinkTooltip = useCallback(() => {
    if (!linkTooltip) return

    const { entryId, workspaceId, dashboardId } = linkTooltip
    const targetWorkspaceId = dashboardId || workspaceId

    debugLog({
      component: 'CategoryNavigatorPanel',
      action: 'link_tooltip_navigate',
      metadata: { entryId, workspaceId, dashboardId, targetWorkspaceId },
    })

    // Close tooltips and popup
    setLinkTooltip(null)
    setPreviewPopup(null)

    if (entryId) {
      setActiveEntryContext(entryId)
    }
    if (targetWorkspaceId) {
      setActiveWorkspaceContext(targetWorkspaceId)
    }

    onNavigate?.(entryId || '', targetWorkspaceId || '')
  }, [linkTooltip, onNavigate])

  // Handle Eye icon click - show hidden panel if needed, then highlight and scroll to it
  const handleEyeClick = useCallback(async (panelId: string, isVisible: boolean) => {
    // Close the preview popup first
    setPreviewPopup(null)

    // If the panel is hidden, make it visible first
    if (!isVisible) {
      try {
        const response = await fetch(`/api/dashboard/panels/${panelId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ isVisible: true }),
        })

        if (!response.ok) {
          console.error('[CategoryNavigatorPanel] Failed to show hidden panel')
          return
        }

        debugLog({
          component: 'CategoryNavigatorPanel',
          action: 'panel_made_visible',
          metadata: { panelId },
        })

        // Update local state to reflect visibility change
        setQuickLinksPanels(prev =>
          prev.map(p => p.id === panelId ? { ...p, isVisible: true } : p)
        )

        // Dispatch event to tell DashboardView to refresh its panels
        window.dispatchEvent(new CustomEvent('refresh-dashboard-panels'))

        // Small delay to allow dashboard to refetch panels
        await new Promise(resolve => setTimeout(resolve, 100))
      } catch (error) {
        console.error('[CategoryNavigatorPanel] Failed to show hidden panel:', error)
        return
      }
    }

    // Dispatch custom event to highlight the Quick Links panel on the dashboard
    const event = new CustomEvent('highlight-dashboard-panel', {
      detail: { panelId }
    })
    window.dispatchEvent(event)
  }, [])

  // Restore a trashed panel
  const handleRestorePanel = useCallback(async (panelId: string) => {
    setRestoringPanelId(panelId)
    try {
      const response = await fetch(`/api/dashboard/panels/${panelId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ restore: true }),
      })

      if (!response.ok) {
        console.error('[CategoryNavigatorPanel] Failed to restore panel')
        return
      }

      debugLog({
        component: 'CategoryNavigatorPanel',
        action: 'panel_restored',
        metadata: { panelId },
      })

      // Remove from trash list
      setTrashedPanels(prev => prev.filter(p => p.id !== panelId))

      // Refresh the main panel list and dashboard
      loadData(true)
      window.dispatchEvent(new CustomEvent('refresh-dashboard-panels'))
    } catch (error) {
      console.error('[CategoryNavigatorPanel] Failed to restore panel:', error)
    } finally {
      setRestoringPanelId(null)
    }
  }, [loadData])

  // Format relative time for trash (e.g., "2 days ago")
  const formatDeletedTime = useCallback((dateString: string): string => {
    try {
      const date = new Date(dateString)
      const now = new Date()
      const diffMs = now.getTime() - date.getTime()
      const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

      if (diffDays === 0) return 'Today'
      if (diffDays === 1) return 'Yesterday'
      if (diffDays < 7) return `${diffDays} days ago`
      if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`

      return date.toLocaleDateString()
    } catch {
      return ''
    }
  }, [])

  // Cleanup timeouts on unmount
  useEffect(() => {
    return () => {
      if (previewTimeoutRef.current) {
        clearTimeout(previewTimeoutRef.current)
      }
      if (linkTooltipTimeoutRef.current) {
        clearTimeout(linkTooltipTimeoutRef.current)
      }
    }
  }, [])

  // Render a Quick Links panel section
  const renderPanel = (quickLinksPanel: QuickLinksPanel) => {
    const isExpanded = expandedIds.has(quickLinksPanel.id)
    const isHidden = !quickLinksPanel.isVisible

    return (
      <div key={quickLinksPanel.id} className="group">
        {/* Panel header */}
        <div
          className="w-full flex items-center gap-2"
          style={{
            padding: '6px 8px',
            background: 'transparent',
            borderRadius: 6,
            transition: 'background 0.15s ease',
            opacity: isHidden ? 0.5 : 1, // Fade hidden panels
          }}
          onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255, 255, 255, 0.04)'}
          onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
        >
          <button
            onClick={() => toggleExpand(quickLinksPanel.id)}
            className="flex items-center gap-2 flex-1 min-w-0"
            style={{
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              padding: 0,
            }}
          >
            <ChevronRight
              size={14}
              className={cn('shrink-0 transition-transform', isExpanded && 'rotate-90')}
              style={{ color: '#5c6070' }}
            />
            {/* Badge */}
            {quickLinksPanel.badge && (
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 18,
                  height: 18,
                  background: 'rgba(99, 102, 241, 0.2)',
                  color: '#818cf8',
                  fontSize: 10,
                  fontWeight: 700,
                  borderRadius: 4,
                  flexShrink: 0,
                }}
              >
                {quickLinksPanel.badge}
              </span>
            )}
            <Link2 size={14} style={{ color: '#818cf8', flexShrink: 0 }} />
            <span
              className="flex-1 text-left truncate"
              style={{ fontSize: 13, fontWeight: 500, color: isHidden ? '#8b8fa3' : '#f0f0f0' }}
            >
              {quickLinksPanel.title}
            </span>
            {/* Hidden indicator */}
            {isHidden && (
              <span
                style={{
                  fontSize: 9,
                  color: '#5c6070',
                  background: 'rgba(255, 255, 255, 0.08)',
                  padding: '1px 5px',
                  borderRadius: 3,
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                }}
              >
                Hidden
              </span>
            )}
          </button>
          <span
            style={{
              fontSize: 10,
              color: '#5c6070',
              background: 'rgba(255, 255, 255, 0.05)',
              padding: '2px 6px',
              borderRadius: 4,
            }}
          >
            {quickLinksPanel.links.length}
          </span>
          {/* Eye icon for preview - appears on hover, click to highlight panel */}
          <div
            className="opacity-0 group-hover:opacity-100 transition-opacity"
            style={{
              padding: 4,
              borderRadius: 4,
              cursor: 'pointer',
              marginLeft: 4,
            }}
            onClick={() => handleEyeClick(quickLinksPanel.id, quickLinksPanel.isVisible)}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)'
              handlePreviewEyeEnter(quickLinksPanel, e)
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent'
              handlePreviewEyeLeave()
            }}
          >
            <Eye size={14} style={{ color: '#818cf8' }} />
          </div>
        </div>

        {/* Links in this panel */}
        {isExpanded && (
          <div style={{ marginLeft: 16 }}>
            {quickLinksPanel.links.map((link, index) => (
              <button
                key={`${link.workspaceId}-${index}`}
                onClick={() => handleLinkClick(link)}
                className="w-full flex items-center gap-2 text-left"
                style={{
                  padding: '5px 8px',
                  background: 'transparent',
                  border: 'none',
                  borderRadius: 6,
                  cursor: 'pointer',
                  transition: 'background 0.15s ease',
                }}
                onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255, 255, 255, 0.04)'}
                onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
              >
                <span
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: '50%',
                    background: '#818cf8',
                    flexShrink: 0,
                  }}
                />
                <div className="flex-1 min-w-0">
                  <div
                    className="truncate"
                    style={{ fontSize: 13, color: '#818cf8', fontWeight: 500 }}
                  >
                    {link.text}
                  </div>
                  {link.entryName && (
                    <div
                      className="truncate"
                      style={{ fontSize: 11, color: '#5c6070' }}
                    >
                      {link.entryName}
                    </div>
                  )}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    )
  }

  const headerActions = (
    <button
      onClick={() => loadData(true)}
      disabled={isLoading}
      title="Refresh"
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
      <RefreshCw size={12} className={cn(isLoading && 'animate-spin')} />
    </button>
  )

  return (
    <BaseDashboardPanel
      panel={panel}
      panelDef={panelDef}
      onClose={onClose}
      onDelete={onDelete}
      onTitleChange={onTitleChange}
      isActive={isActive}
      contentClassName="p-0"
      headerActions={headerActions}
    >
      {/* Search bar */}
      <div
        style={{
          padding: '8px 12px',
          borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '6px 10px',
            background: 'rgba(255, 255, 255, 0.04)',
            borderRadius: 6,
          }}
        >
          <Search size={14} style={{ color: '#5c6070' }} />
          <input
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search links..."
            style={{
              flex: 1,
              background: 'transparent',
              border: 'none',
              outline: 'none',
              color: '#f0f0f0',
              fontSize: 12,
            }}
          />
        </div>
      </div>

      {/* Content */}
      <div style={{ padding: '8px 6px', overflowY: 'auto', flex: 1 }}>
        {isLoading ? (
          <CategoryNavigatorPanelSkeleton />
        ) : error ? (
          <div
            className="flex flex-col items-center justify-center text-center min-h-[100px]"
            style={{ color: '#8b8fa3' }}
          >
            <p style={{ fontSize: 12 }}>{error}</p>
            <button
              onClick={() => loadData(true)}
              className="mt-2"
              style={{
                color: '#6366f1',
                fontSize: 12,
                background: 'none',
                border: 'none',
                cursor: 'pointer',
              }}
            >
              Try again
            </button>
          </div>
        ) : filteredPanels.length === 0 && trashedPanels.length === 0 ? (
          <div
            className="flex flex-col items-center justify-center text-center min-h-[100px]"
            style={{ color: '#8b8fa3' }}
          >
            <Link2 size={24} style={{ opacity: 0.5, marginBottom: 8 }} />
            <p style={{ fontSize: 12 }}>
              {searchQuery ? `No links match "${searchQuery}"` : 'No links yet'}
            </p>
            <p style={{ fontSize: 11, color: '#5c6070', marginTop: 4 }}>
              {searchQuery ? '' : 'Add workspace links in Quick Links panels'}
            </p>
          </div>
        ) : (
          <div className="space-y-1">
            {/* Summary - only show when there are active panels */}
            {filteredPanels.length > 0 && (
              <div
                style={{
                  padding: '4px 8px',
                  fontSize: 11,
                  color: '#5c6070',
                  marginBottom: 4,
                }}
              >
                {totalLinks} link{totalLinks !== 1 ? 's' : ''} in {filteredPanels.length} panel{filteredPanels.length !== 1 ? 's' : ''}
              </div>
            )}

            {/* Render Quick Links panels */}
            {filteredPanels.map(panel => renderPanel(panel))}

            {/* Trash section - collapsible */}
            {trashedPanels.length > 0 && (
              <div style={{ marginTop: 16 }}>
                <button
                  onClick={() => setIsTrashExpanded(!isTrashExpanded)}
                  className="flex items-center gap-2 w-full"
                  style={{
                    background: 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    padding: '8px',
                    borderRadius: 6,
                  }}
                >
                  <ChevronRight
                    size={14}
                    className={cn('shrink-0 transition-transform', isTrashExpanded && 'rotate-90')}
                    style={{ color: '#5c6070' }}
                  />
                  <Trash2 size={14} style={{ color: '#ef4444', opacity: 0.7 }} />
                  <span style={{ fontSize: 12, fontWeight: 500, color: '#8b8fa3' }}>
                    Trash
                  </span>
                  <span
                    style={{
                      fontSize: 10,
                      color: '#5c6070',
                      background: 'rgba(255, 255, 255, 0.05)',
                      padding: '2px 6px',
                      borderRadius: 4,
                      marginLeft: 'auto',
                    }}
                  >
                    {trashedPanels.length}
                  </span>
                </button>

                {isTrashExpanded && (
                  <div style={{ marginLeft: 8 }}>
                    {trashedPanels.map((trashedPanel) => (
                      <div
                        key={trashedPanel.id}
                        className="flex items-center gap-2 group"
                        style={{
                          padding: '6px 8px',
                          borderRadius: 6,
                          marginBottom: 2,
                          background: 'rgba(239, 68, 68, 0.05)',
                        }}
                      >
                        {/* Badge */}
                        {trashedPanel.badge && (
                          <span
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              width: 16,
                              height: 16,
                              background: 'rgba(239, 68, 68, 0.2)',
                              color: '#f87171',
                              fontSize: 9,
                              fontWeight: 700,
                              borderRadius: 3,
                              flexShrink: 0,
                            }}
                          >
                            {trashedPanel.badge}
                          </span>
                        )}
                        <Link2 size={12} style={{ color: '#f87171', opacity: 0.7, flexShrink: 0 }} />
                        <div className="flex-1 min-w-0">
                          <span
                            className="truncate block"
                            style={{ fontSize: 12, color: '#8b8fa3' }}
                          >
                            {trashedPanel.title}
                          </span>
                          <span style={{ fontSize: 10, color: '#5c6070' }}>
                            {trashedPanel.linkCount} link{trashedPanel.linkCount !== 1 ? 's' : ''} • {formatDeletedTime(trashedPanel.deletedAt)}
                          </span>
                        </div>
                        {/* Restore button */}
                        <button
                          onClick={() => handleRestorePanel(trashedPanel.id)}
                          disabled={restoringPanelId === trashedPanel.id}
                          className="opacity-0 group-hover:opacity-100 transition-opacity"
                          style={{
                            background: 'rgba(34, 197, 94, 0.15)',
                            border: 'none',
                            borderRadius: 4,
                            padding: 4,
                            cursor: restoringPanelId === trashedPanel.id ? 'wait' : 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                          title="Restore panel"
                        >
                          <RotateCcw
                            size={12}
                            style={{
                              color: '#22c55e',
                              animation: restoringPanelId === trashedPanel.id ? 'spin 1s linear infinite' : 'none',
                            }}
                          />
                        </button>
                      </div>
                    ))}
                    <p
                      style={{
                        fontSize: 10,
                        color: '#5c6070',
                        padding: '8px 8px 4px',
                        fontStyle: 'italic',
                      }}
                    >
                      Items auto-delete after 30 days
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Preview popup - renders the Quick Links panel content */}
      {previewPopup && (
        <div
          className="fixed rounded-xl border shadow-2xl"
          style={{
            left: previewPopup.position.x,
            top: previewPopup.position.y,
            width: 280,
            maxHeight: 320,
            background: 'rgba(17, 24, 39, 0.98)',
            borderColor: 'rgba(255, 255, 255, 0.15)',
            zIndex: 1000,
            animation: 'fadeIn 0.15s ease-out',
          }}
          onMouseEnter={handlePreviewPopupEnter}
          onMouseLeave={handlePreviewPopupLeave}
        >
          {/* Popup header */}
          <div
            className="flex items-center gap-2 px-3 py-2 border-b"
            style={{ borderBottomColor: 'rgba(255, 255, 255, 0.1)' }}
          >
            <Link2 size={14} style={{ color: '#818cf8' }} />
            <span style={{ fontSize: 12, fontWeight: 600, color: '#f0f0f0' }}>
              {previewPopup.panelTitle}
            </span>
          </div>
          {/* Popup content - rendered HTML with link hover handlers */}
          <div
            ref={previewContentRef}
            className="p-3 overflow-y-auto preview-content"
            style={{
              maxHeight: 260,
              fontSize: 14,
              lineHeight: 1.7,
              color: '#e0e0e0',
            }}
            onMouseOver={handlePreviewLinkMouseEnter}
            onMouseOut={handlePreviewLinkMouseLeave}
            dangerouslySetInnerHTML={{ __html: previewPopup.htmlContent }}
          />

          {/* Link tooltip - appears when hovering workspace links */}
          {linkTooltip && (
            <div
              className="link-navigate-tooltip"
              style={{
                position: 'fixed',
                left: linkTooltip.rect.left + linkTooltip.rect.width / 2,
                top: linkTooltip.rect.bottom + 2, // Reduced gap from 8 to 2
                transform: 'translateX(-50%)',
                // Extra padding at top creates invisible "bridge" to link
                padding: '10px 4px 4px 4px',
                marginTop: -6, // Pull up to overlap with link area
                background: 'transparent', // Outer area transparent
                zIndex: 1001,
              }}
              onMouseEnter={handleLinkTooltipEnter}
              onMouseLeave={handleLinkTooltipLeave}
            >
              {/* Inner visible tooltip */}
              <div
                style={{
                  padding: 4,
                  background: '#252830',
                  border: '1px solid rgba(255, 255, 255, 0.15)',
                  borderRadius: 6,
                  boxShadow: '0 4px 12px rgba(0, 0, 0, 0.4)',
                  animation: 'tooltipFadeIn 0.15s ease-out',
                }}
              >
              <button
                onClick={handleNavigateFromLinkTooltip}
                title="Go to Dashboard"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 26,
                  height: 26,
                  padding: 0,
                  background: '#6366f1',
                  border: 'none',
                  borderRadius: 4,
                  color: 'white',
                  cursor: 'pointer',
                  transition: 'all 0.15s',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = '#4f46e5'
                  e.currentTarget.style.transform = 'scale(1.05)'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = '#6366f1'
                  e.currentTarget.style.transform = 'scale(1)'
                }}
              >
                <ExternalLink size={14} />
              </button>
              </div>
            </div>
          )}

          <style>{`
            @keyframes fadeIn {
              from { opacity: 0; transform: translateY(4px); }
              to { opacity: 1; transform: translateY(0); }
            }
            @keyframes tooltipFadeIn {
              from { opacity: 0; transform: translateX(-50%) translateY(4px); }
              to { opacity: 1; transform: translateX(-50%) translateY(0); }
            }
            /* Style workspace links in preview */
            .preview-content .workspace-link {
              display: inline;
              padding: 2px 8px;
              background: rgba(99, 102, 241, 0.15);
              color: #818cf8;
              border-radius: 4px;
              font-size: 13px;
              font-weight: 500;
              text-decoration: none;
              cursor: default;
              transition: background 0.15s;
            }
            .preview-content .workspace-link:hover {
              background: rgba(99, 102, 241, 0.25);
            }
          `}</style>
        </div>
      )}
    </BaseDashboardPanel>
  )
}
