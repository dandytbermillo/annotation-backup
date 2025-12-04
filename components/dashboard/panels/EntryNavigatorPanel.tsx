"use client"

/**
 * Entry Navigator Panel Component
 * Part of Dashboard Implementation - Phase 2.2b (Updated in Phase 4.4)
 *
 * Provides a tree view of entries (items) with expandable folders
 * and clickable workspaces for navigation.
 *
 * Features:
 * - Virtual scrolling for large trees
 * - Tree caching to avoid refetches
 * - Skeleton loading states
 */

import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { ChevronRight, Folder, FolderOpen, FileText, Loader2, RefreshCw } from 'lucide-react'
import { BaseDashboardPanel } from './BaseDashboardPanel'
import { panelTypeRegistry } from '@/lib/dashboard/panel-registry'
import type { BasePanelProps, PanelConfig } from '@/lib/dashboard/panel-registry'
import { cn } from '@/lib/utils'
import { setActiveWorkspaceContext } from '@/lib/note-workspaces/state'
import { VirtualList } from '@/components/canvas/VirtualList'
import { NavigatorPanelSkeleton } from './PanelSkeletons'

// Constants
const ITEM_HEIGHT = 28
const VIRTUAL_SCROLL_THRESHOLD = 50 // Use virtual scroll when more than 50 visible items

interface EntryItem {
  id: string
  type: 'folder' | 'note'
  name: string
  parentId: string | null
  path: string
  icon?: string | null
  color?: string | null
  depth?: number
  children?: EntryItem[]
  workspaces?: WorkspaceInfo[]
}

interface WorkspaceInfo {
  id: string
  name: string
  isDefault: boolean
}

interface NavigatorConfig extends PanelConfig {
  expandedEntries?: string[]
}

// Flattened tree item for virtual list rendering
interface FlatTreeItem {
  type: 'entry' | 'workspace'
  id: string
  depth: number
  entry?: EntryItem
  workspace?: WorkspaceInfo
  parentEntryId?: string
}

// Simple in-memory cache for entry tree
const entryTreeCache = new Map<string, { entries: EntryItem[]; timestamp: number }>()
const CACHE_TTL = 60000 // 1 minute cache TTL

export function EntryNavigatorPanel({ panel, onClose, onConfigChange, onNavigate, isActive }: BasePanelProps) {
  const panelDef = panelTypeRegistry.navigator
  const config = panel.config as NavigatorConfig

  const [entries, setEntries] = useState<EntryItem[]>([])
  const [expandedIds, setExpandedIds] = useState<Set<string>>(
    new Set(config.expandedEntries || [])
  )
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [loadingChildren, setLoadingChildren] = useState<Set<string>>(new Set())
  const containerRef = useRef<HTMLDivElement>(null)
  const [containerHeight, setContainerHeight] = useState(0)

  // Measure container height for virtual list
  useEffect(() => {
    if (!containerRef.current) return

    const measureHeight = () => {
      if (containerRef.current) {
        setContainerHeight(containerRef.current.clientHeight)
      }
    }

    measureHeight()
    const observer = new ResizeObserver(measureHeight)
    observer.observe(containerRef.current)

    return () => observer.disconnect()
  }, [])

  // Fetch root entries with caching
  const fetchEntries = useCallback(async (forceRefresh = false) => {
    try {
      setIsLoading(true)
      setError(null)

      const cacheKey = 'root'
      const cached = entryTreeCache.get(cacheKey)

      if (!forceRefresh && cached && Date.now() - cached.timestamp < CACHE_TTL) {
        setEntries(cached.entries)
        setIsLoading(false)
        return
      }

      const response = await fetch('/api/items?parentId=null')
      if (!response.ok) {
        throw new Error('Failed to fetch entries')
      }

      const data = await response.json()
      const items = data.items || []

      // Update cache
      entryTreeCache.set(cacheKey, { entries: items, timestamp: Date.now() })
      setEntries(items)
    } catch (err) {
      console.error('[EntryNavigatorPanel] Failed to load entries:', err)
      setError('Unable to load entries')
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchEntries()
  }, [fetchEntries])

  // Refresh handler to invalidate cache
  const handleRefresh = useCallback(() => {
    entryTreeCache.clear()
    fetchEntries(true)
  }, [fetchEntries])

  // Flatten tree for virtual rendering
  const flattenTree = useCallback((
    entries: EntryItem[],
    depth: number = 0,
    result: FlatTreeItem[] = []
  ): FlatTreeItem[] => {
    for (const entry of entries) {
      result.push({
        type: 'entry',
        id: entry.id,
        depth,
        entry,
      })

      if (expandedIds.has(entry.id)) {
        // Add workspaces
        if (entry.workspaces) {
          for (const workspace of entry.workspaces) {
            result.push({
              type: 'workspace',
              id: workspace.id,
              depth: depth + 1,
              workspace,
              parentEntryId: entry.id,
            })
          }
        }

        // Add children
        if (entry.children) {
          flattenTree(entry.children, depth + 1, result)
        }
      }
    }

    return result
  }, [expandedIds])

  // Memoize flattened items
  const flatItems = useMemo(() => flattenTree(entries), [flattenTree, entries])

  // Fetch children when expanding a folder
  const fetchChildren = useCallback(async (parentId: string): Promise<EntryItem[]> => {
    try {
      const response = await fetch(`/api/items/${parentId}/children`)
      if (!response.ok) {
        throw new Error('Failed to fetch children')
      }

      const data = await response.json()
      return data.items || []
    } catch (err) {
      console.error('[EntryNavigatorPanel] Failed to load children:', err)
      return []
    }
  }, [])

  // Fetch workspaces for an entry
  const fetchWorkspaces = useCallback(async (entryId: string): Promise<WorkspaceInfo[]> => {
    try {
      const response = await fetch(`/api/note-workspaces?itemId=${entryId}`)
      if (!response.ok) {
        return []
      }

      const data = await response.json()
      return (data.workspaces || []).map((w: any) => ({
        id: w.id,
        name: w.name,
        isDefault: w.isDefault,
      }))
    } catch (err) {
      console.error('[EntryNavigatorPanel] Failed to load workspaces:', err)
      return []
    }
  }, [])

  const toggleExpand = useCallback(async (entry: EntryItem) => {
    const newExpanded = new Set(expandedIds)

    if (expandedIds.has(entry.id)) {
      // Collapse
      newExpanded.delete(entry.id)
    } else {
      // Expand - load children if needed
      newExpanded.add(entry.id)

      if (!entry.children) {
        setLoadingChildren(prev => new Set(prev).add(entry.id))

        const [children, workspaces] = await Promise.all([
          entry.type === 'folder' ? fetchChildren(entry.id) : Promise.resolve([]),
          fetchWorkspaces(entry.id),
        ])

        // Update entry with children and workspaces
        setEntries(prev => updateEntryInTree(prev, entry.id, {
          ...entry,
          children,
          workspaces,
        }))

        setLoadingChildren(prev => {
          const next = new Set(prev)
          next.delete(entry.id)
          return next
        })
      }
    }

    setExpandedIds(newExpanded)

    // Persist expanded state to config
    onConfigChange?.({
      ...config,
      expandedEntries: Array.from(newExpanded),
    })
  }, [expandedIds, config, onConfigChange, fetchChildren, fetchWorkspaces])

  const handleWorkspaceClick = useCallback((workspaceId: string, entryId: string) => {
    setActiveWorkspaceContext(workspaceId)
    onNavigate?.(entryId, workspaceId)
  }, [onNavigate])

  // Helper to update an entry in the tree
  const updateEntryInTree = (
    entries: EntryItem[],
    targetId: string,
    updated: EntryItem
  ): EntryItem[] => {
    return entries.map(entry => {
      if (entry.id === targetId) {
        return updated
      }
      if (entry.children) {
        return {
          ...entry,
          children: updateEntryInTree(entry.children, targetId, updated),
        }
      }
      return entry
    })
  }

  // Render a single flat item (for virtual list)
  const renderFlatItem = useCallback((item: FlatTreeItem) => {
    if (item.type === 'workspace' && item.workspace) {
      return (
        <button
          onClick={() => handleWorkspaceClick(item.workspace!.id, item.parentEntryId!)}
          className="w-full flex items-center gap-2 text-left h-full"
          style={{
            paddingLeft: `${20 + item.depth * 12}px`,
            paddingRight: 8,
            paddingTop: 4,
            paddingBottom: 4,
            color: '#6366f1',
            fontSize: 12,
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
            className="shrink-0"
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: '#6366f1',
            }}
          />
          <span className="truncate">
            {item.workspace.name}
            {item.workspace.isDefault && (
              <span className="ml-1" style={{ color: '#5c6070' }}>(default)</span>
            )}
          </span>
        </button>
      )
    }

    if (item.type === 'entry' && item.entry) {
      const entry = item.entry
      const isExpanded = expandedIds.has(entry.id)
      const isLoadingEntry = loadingChildren.has(entry.id)
      const hasChildren = entry.type === 'folder' || (entry.workspaces && entry.workspaces.length > 0)

      return (
        <button
          onClick={() => toggleExpand(entry)}
          className="w-full h-full flex items-center gap-2"
          style={{
            paddingLeft: `${8 + item.depth * 12}px`,
            paddingRight: 8,
            paddingTop: 4,
            paddingBottom: 4,
            background: 'transparent',
            border: 'none',
            borderRadius: 6,
            cursor: 'pointer',
            transition: 'background 0.15s ease',
          }}
          onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255, 255, 255, 0.04)'}
          onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
        >
          {hasChildren ? (
            isLoadingEntry ? (
              <Loader2 size={14} className="shrink-0 animate-spin" style={{ color: '#5c6070' }} />
            ) : (
              <ChevronRight size={14} className={cn('shrink-0 transition-transform', isExpanded && 'rotate-90')} style={{ color: '#5c6070' }} />
            )
          ) : (
            <span className="w-3.5 shrink-0" />
          )}

          <div className="shrink-0">
            {entry.icon ? (
              <span style={{ fontSize: 14 }}>{entry.icon}</span>
            ) : entry.type === 'folder' ? (
              isExpanded ? (
                <FolderOpen size={14} style={{ color: '#f59e0b' }} />
              ) : (
                <Folder size={14} style={{ color: '#f59e0b' }} />
              )
            ) : (
              <FileText size={14} style={{ color: '#818cf8' }} />
            )}
          </div>

          <span className="truncate" style={{ fontSize: 13, color: '#f0f0f0' }}>{entry.name}</span>
        </button>
      )
    }

    return null
  }, [expandedIds, loadingChildren, toggleExpand, handleWorkspaceClick])

  // Render entry recursively (for non-virtual rendering of small trees)
  const renderEntry = (entry: EntryItem, depth: number = 0) => {
    const isExpanded = expandedIds.has(entry.id)
    const isLoadingEntry = loadingChildren.has(entry.id)
    const hasChildren = entry.type === 'folder' || (entry.workspaces && entry.workspaces.length > 0)

    return (
      <div key={entry.id}>
        <button
          onClick={() => toggleExpand(entry)}
          className="w-full flex items-center gap-2"
          style={{
            paddingLeft: `${8 + depth * 12}px`,
            paddingRight: 8,
            paddingTop: 6,
            paddingBottom: 6,
            background: 'transparent',
            border: 'none',
            borderRadius: 6,
            cursor: 'pointer',
            transition: 'background 0.15s ease',
          }}
          onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255, 255, 255, 0.04)'}
          onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
        >
          {hasChildren ? (
            isLoadingEntry ? (
              <Loader2 size={14} className="shrink-0 animate-spin" style={{ color: '#5c6070' }} />
            ) : (
              <ChevronRight size={14} className={cn('shrink-0 transition-transform', isExpanded && 'rotate-90')} style={{ color: '#5c6070' }} />
            )
          ) : (
            <span className="w-3.5 shrink-0" />
          )}

          <div className="shrink-0">
            {entry.icon ? (
              <span style={{ fontSize: 14 }}>{entry.icon}</span>
            ) : entry.type === 'folder' ? (
              isExpanded ? (
                <FolderOpen size={14} style={{ color: '#f59e0b' }} />
              ) : (
                <Folder size={14} style={{ color: '#f59e0b' }} />
              )
            ) : (
              <FileText size={14} style={{ color: '#818cf8' }} />
            )}
          </div>

          <span className="truncate" style={{ fontSize: 13, color: '#f0f0f0' }}>{entry.name}</span>
        </button>

        {isExpanded && !isLoadingEntry && (
          <div style={{ marginLeft: 12 }}>
            {entry.workspaces?.map(workspace => (
              <button
                key={workspace.id}
                onClick={() => handleWorkspaceClick(workspace.id, entry.id)}
                className="w-full flex items-center gap-2 text-left"
                style={{
                  paddingLeft: 12,
                  paddingRight: 8,
                  paddingTop: 4,
                  paddingBottom: 4,
                  color: '#6366f1',
                  fontSize: 12,
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
                  className="shrink-0"
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    background: '#6366f1',
                  }}
                />
                <span className="truncate">
                  {workspace.name}
                  {workspace.isDefault && (
                    <span className="ml-1" style={{ color: '#5c6070' }}>(default)</span>
                  )}
                </span>
              </button>
            ))}
            {entry.children?.map(child => renderEntry(child, depth + 1))}
          </div>
        )}
      </div>
    )
  }

  // Determine if we should use virtual scrolling
  const useVirtualScroll = flatItems.length > VIRTUAL_SCROLL_THRESHOLD

  // Refresh button for header
  const headerActions = (
    <button
      onClick={handleRefresh}
      title="Refresh entries"
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
      <RefreshCw size={12} />
    </button>
  )

  return (
    <BaseDashboardPanel
      panel={panel}
      panelDef={panelDef}
      onClose={onClose}
      isActive={isActive}
      contentClassName="p-2"
      headerActions={headerActions}
    >
      {isLoading ? (
        <NavigatorPanelSkeleton />
      ) : error ? (
        <div
          className="flex flex-col items-center justify-center text-center min-h-[100px]"
          style={{ color: '#8b8fa3' }}
        >
          <p style={{ fontSize: 12 }}>{error}</p>
          <button
            onClick={handleRefresh}
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
      ) : entries.length === 0 ? (
        <div
          className="flex flex-col items-center justify-center text-center min-h-[100px]"
          style={{ color: '#8b8fa3' }}
        >
          <Folder size={24} style={{ opacity: 0.5, marginBottom: 8 }} />
          <p style={{ fontSize: 12 }}>No entries yet</p>
          <p style={{ fontSize: 11, color: '#5c6070', marginTop: 4 }}>
            Create folders and notes to see them here
          </p>
        </div>
      ) : useVirtualScroll ? (
        <div ref={containerRef} className="h-full min-h-[100px]">
          <VirtualList
            items={flatItems}
            itemHeight={ITEM_HEIGHT}
            height={containerHeight || 200}
            renderItem={(item) => renderFlatItem(item)}
            className="h-full"
          />
        </div>
      ) : (
        <div className="space-y-0.5">
          {entries.map(entry => renderEntry(entry))}
        </div>
      )}
    </BaseDashboardPanel>
  )
}
