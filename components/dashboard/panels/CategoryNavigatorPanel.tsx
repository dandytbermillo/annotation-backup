"use client"

/**
 * Category Navigator Panel Component
 *
 * Shows all workspace links (highlighted text) from all Quick Links panels
 * in the current dashboard. Provides a unified view of all linked entries.
 */

import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { ChevronRight, Link2, RefreshCw, Search } from 'lucide-react'
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
}

export function CategoryNavigatorPanel({ panel, onClose, onConfigChange, onTitleChange, onNavigate, isActive }: BasePanelProps) {
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

      // Fetch all panels for this workspace
      debugLog({
        component: 'CategoryNavigatorPanel',
        action: 'fetching_panels',
        metadata: { workspaceId, callCount },
      })

      const response = await fetch(`/api/dashboard/panels?workspaceId=${workspaceId}`)
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

  // Render a Quick Links panel section
  const renderPanel = (quickLinksPanel: QuickLinksPanel) => {
    const isExpanded = expandedIds.has(quickLinksPanel.id)

    return (
      <div key={quickLinksPanel.id}>
        {/* Panel header */}
        <button
          onClick={() => toggleExpand(quickLinksPanel.id)}
          className="w-full flex items-center gap-2"
          style={{
            padding: '6px 8px',
            background: 'transparent',
            border: 'none',
            borderRadius: 6,
            cursor: 'pointer',
            transition: 'background 0.15s ease',
          }}
          onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255, 255, 255, 0.04)'}
          onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
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
          <Link2 size={14} style={{ color: '#818cf8' }} />
          <span
            className="flex-1 text-left truncate"
            style={{ fontSize: 13, fontWeight: 500, color: '#f0f0f0' }}
          >
            {quickLinksPanel.title}
          </span>
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
        </button>

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
        ) : filteredPanels.length === 0 ? (
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
            {/* Summary */}
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

            {/* Render Quick Links panels */}
            {filteredPanels.map(panel => renderPanel(panel))}
          </div>
        )}
      </div>
    </BaseDashboardPanel>
  )
}
