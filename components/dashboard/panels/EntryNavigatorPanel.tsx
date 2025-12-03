"use client"

/**
 * Entry Navigator Panel Component
 * Part of Dashboard Implementation - Phase 2.2b
 *
 * Provides a tree view of entries (items) with expandable folders
 * and clickable workspaces for navigation.
 */

import React, { useEffect, useState, useCallback } from 'react'
import { ChevronRight, ChevronDown, Folder, FolderOpen, FileText, Loader2 } from 'lucide-react'
import { BaseDashboardPanel } from './BaseDashboardPanel'
import { panelTypeRegistry } from '@/lib/dashboard/panel-registry'
import type { BasePanelProps, PanelConfig } from '@/lib/dashboard/panel-registry'
import { cn } from '@/lib/utils'
import { setActiveWorkspaceContext } from '@/lib/note-workspaces/state'

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

  // Fetch root entries on mount
  useEffect(() => {
    const fetchEntries = async () => {
      try {
        setIsLoading(true)
        setError(null)

        const response = await fetch('/api/items?parentId=null')
        if (!response.ok) {
          throw new Error('Failed to fetch entries')
        }

        const data = await response.json()
        setEntries(data.items || [])
      } catch (err) {
        console.error('[EntryNavigatorPanel] Failed to load entries:', err)
        setError('Unable to load entries')
      } finally {
        setIsLoading(false)
      }
    }

    fetchEntries()
  }, [])

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

  const renderEntry = (entry: EntryItem, depth: number = 0) => {
    const isExpanded = expandedIds.has(entry.id)
    const isLoadingEntry = loadingChildren.has(entry.id)
    const hasChildren = entry.type === 'folder' || (entry.workspaces && entry.workspaces.length > 0)

    return (
      <div key={entry.id}>
        <button
          onClick={() => toggleExpand(entry)}
          className={cn(
            'w-full flex items-center gap-1.5 px-2 py-1.5 text-left text-sm rounded hover:bg-muted/50 transition-colors',
            depth > 0 && 'ml-4'
          )}
          style={{ paddingLeft: `${8 + depth * 12}px` }}
        >
          {/* Expand/Collapse indicator */}
          {hasChildren ? (
            isLoadingEntry ? (
              <Loader2 size={14} className="shrink-0 animate-spin text-muted-foreground" />
            ) : isExpanded ? (
              <ChevronDown size={14} className="shrink-0 text-muted-foreground" />
            ) : (
              <ChevronRight size={14} className="shrink-0 text-muted-foreground" />
            )
          ) : (
            <span className="w-3.5 shrink-0" />
          )}

          {/* Icon */}
          {entry.icon ? (
            <span className="text-sm">{entry.icon}</span>
          ) : entry.type === 'folder' ? (
            isExpanded ? (
              <FolderOpen size={14} className="shrink-0 text-amber-500" />
            ) : (
              <Folder size={14} className="shrink-0 text-amber-500" />
            )
          ) : (
            <FileText size={14} className="shrink-0 text-blue-500" />
          )}

          {/* Name */}
          <span className="truncate text-foreground">{entry.name}</span>
        </button>

        {/* Children and workspaces */}
        {isExpanded && !isLoadingEntry && (
          <div>
            {/* Workspaces */}
            {entry.workspaces?.map(workspace => (
              <button
                key={workspace.id}
                onClick={() => handleWorkspaceClick(workspace.id, entry.id)}
                className={cn(
                  'w-full flex items-center gap-1.5 px-2 py-1 text-left text-xs rounded hover:bg-primary/10 text-primary transition-colors'
                )}
                style={{ paddingLeft: `${20 + (depth + 1) * 12}px` }}
              >
                <span className="w-2 h-2 rounded-full bg-primary/60 shrink-0" />
                <span className="truncate">
                  {workspace.name}
                  {workspace.isDefault && (
                    <span className="ml-1 text-muted-foreground">(default)</span>
                  )}
                </span>
              </button>
            ))}

            {/* Child entries */}
            {entry.children?.map(child => renderEntry(child, depth + 1))}
          </div>
        )}
      </div>
    )
  }

  return (
    <BaseDashboardPanel
      panel={panel}
      panelDef={panelDef}
      onClose={onClose}
      isActive={isActive}
      contentClassName="p-2"
    >
      {isLoading ? (
        <div className="flex items-center justify-center h-full min-h-[100px]">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      ) : error ? (
        <div className="flex flex-col items-center justify-center h-full min-h-[100px] text-center p-4">
          <p className="text-sm text-muted-foreground">{error}</p>
        </div>
      ) : entries.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-full min-h-[100px] text-center p-4">
          <p className="text-sm text-muted-foreground">No entries yet</p>
          <p className="text-xs text-muted-foreground/70 mt-1">
            Create folders and notes to see them here
          </p>
        </div>
      ) : (
        <div className="space-y-0.5">
          {entries.map(entry => renderEntry(entry))}
        </div>
      )}
    </BaseDashboardPanel>
  )
}
