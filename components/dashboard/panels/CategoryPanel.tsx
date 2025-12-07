"use client"

/**
 * Category Panel Component
 * Part of Category Navigator feature - Phase 2
 *
 * Displays a list of entries organized in a user-defined category.
 * Entries can be added, removed, and reordered within the category.
 */

import React, { useEffect, useState, useCallback, useRef } from 'react'
import { Plus, RefreshCw, MoreVertical, Trash2, Eye, EyeOff, Edit3, Folder, ChevronRight } from 'lucide-react'
import { BaseDashboardPanel } from './BaseDashboardPanel'
import { panelTypeRegistry } from '@/lib/dashboard/panel-registry'
import type { BasePanelProps, PanelConfig } from '@/lib/dashboard/panel-registry'
import { cn } from '@/lib/utils'
import { setActiveWorkspaceContext } from '@/lib/note-workspaces/state'
import { setActiveEntryContext } from '@/lib/entry'
import { CategoryPanelSkeleton } from './PanelSkeletons'

interface CategoryConfig extends PanelConfig {
  categoryIcon?: string
  entryIds?: string[]
  categoryVisible?: boolean
}

interface EntryInfo {
  id: string
  name: string
  workspaces: {
    id: string
    name: string
    isDefault: boolean
  }[]
}

export function CategoryPanel({ panel, onClose, onConfigChange, onTitleChange, onNavigate, onDelete, isActive }: BasePanelProps) {
  const panelDef = panelTypeRegistry.category
  const config = panel.config as CategoryConfig

  const [entries, setEntries] = useState<EntryInfo[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showAddMenu, setShowAddMenu] = useState(false)
  const [availableEntries, setAvailableEntries] = useState<EntryInfo[]>([])
  const [showOptionsMenu, setShowOptionsMenu] = useState(false)
  const [expandedEntryId, setExpandedEntryId] = useState<string | null>(null)

  const addMenuRef = useRef<HTMLDivElement>(null)
  const optionsMenuRef = useRef<HTMLDivElement>(null)

  const entryIds = config.entryIds || []
  const categoryIcon = config.categoryIcon || '📂'

  // Fetch entry details for the IDs in this category
  const fetchEntries = useCallback(async () => {
    if (entryIds.length === 0) {
      setEntries([])
      setIsLoading(false)
      return
    }

    try {
      setIsLoading(true)
      setError(null)

      // Fetch entry details
      const response = await fetch('/api/dashboard/categories')
      if (!response.ok) {
        throw new Error('Failed to fetch entries')
      }

      const data = await response.json()
      const allEntries = data.entries || []

      // Filter to only entries in this category, maintaining order
      const categoryEntries = entryIds
        .map(id => allEntries.find((e: any) => e.entryId === id))
        .filter(Boolean)
        .map((e: any) => ({
          id: e.entryId,
          name: e.entryName,
          workspaces: e.workspaces || [],
        }))

      setEntries(categoryEntries)
    } catch (err) {
      console.error('[CategoryPanel] Failed to load entries:', err)
      setError('Unable to load entries')
    } finally {
      setIsLoading(false)
    }
  }, [entryIds])

  useEffect(() => {
    fetchEntries()
  }, [fetchEntries])

  // Close menus when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (addMenuRef.current && !addMenuRef.current.contains(e.target as Node)) {
        setShowAddMenu(false)
      }
      if (optionsMenuRef.current && !optionsMenuRef.current.contains(e.target as Node)) {
        setShowOptionsMenu(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Fetch available entries for adding
  const fetchAvailableEntries = useCallback(async () => {
    try {
      // Get all entries (items with workspaces) for this user
      const response = await fetch('/api/entries')
      if (!response.ok) return

      const data = await response.json()
      const allEntries = data.entries || []

      // Filter out entries already in this category
      const available = allEntries
        .filter((entry: any) => !entryIds.includes(entry.id))
        .map((entry: any) => ({
          id: entry.id,
          name: entry.name,
          workspaces: [],
        }))

      setAvailableEntries(available)
    } catch (err) {
      console.error('[CategoryPanel] Failed to fetch available entries:', err)
    }
  }, [entryIds])

  const handleAddEntry = async (entryId: string) => {
    try {
      const response = await fetch('/api/dashboard/categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          categoryPanelId: panel.id,
          entryId,
        }),
      })

      if (!response.ok) {
        throw new Error('Failed to add entry')
      }

      // Update local config
      const newEntryIds = [...entryIds, entryId]
      onConfigChange?.({ entryIds: newEntryIds })

      // Refresh entries
      fetchEntries()
      setShowAddMenu(false)
    } catch (err) {
      console.error('[CategoryPanel] Failed to add entry:', err)
    }
  }

  const handleRemoveEntry = async (entryId: string) => {
    try {
      const url = new URL('/api/dashboard/categories', window.location.origin)
      url.searchParams.set('categoryPanelId', panel.id)
      url.searchParams.set('entryId', entryId)

      const response = await fetch(url.toString(), { method: 'DELETE' })

      if (!response.ok) {
        throw new Error('Failed to remove entry')
      }

      // Update local config
      const newEntryIds = entryIds.filter(id => id !== entryId)
      onConfigChange?.({ entryIds: newEntryIds })

      // Refresh entries
      fetchEntries()
    } catch (err) {
      console.error('[CategoryPanel] Failed to remove entry:', err)
    }
  }

  const handleEntryClick = (entry: EntryInfo) => {
    // Toggle expand/collapse for workspace list
    if (entry.workspaces.length > 1) {
      setExpandedEntryId(expandedEntryId === entry.id ? null : entry.id)
    } else if (entry.workspaces.length === 1) {
      // Navigate directly to the only workspace
      handleWorkspaceClick(entry.id, entry.workspaces[0].id)
    } else {
      // No workspaces - navigate to entry dashboard
      setActiveEntryContext(entry.id)
      onNavigate?.(entry.id, '')
    }
  }

  const handleWorkspaceClick = (entryId: string, workspaceId: string) => {
    setActiveEntryContext(entryId)
    setActiveWorkspaceContext(workspaceId)
    onNavigate?.(entryId, workspaceId)
  }

  const headerActions = (
    <div className="flex items-center gap-1">
      {/* Add Entry button */}
      <div className="relative" ref={addMenuRef}>
        <button
          onClick={() => {
            setShowAddMenu(!showAddMenu)
            if (!showAddMenu) {
              fetchAvailableEntries()
            }
          }}
          title="Add entry to category"
          style={{
            width: 24,
            height: 24,
            background: showAddMenu ? 'rgba(99, 102, 241, 0.15)' : 'transparent',
            border: 'none',
            borderRadius: 4,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            color: showAddMenu ? '#6366f1' : '#5c6070',
          }}
        >
          <Plus size={14} />
        </button>

        {showAddMenu && (
          <div
            style={{
              position: 'absolute',
              top: '100%',
              right: 0,
              marginTop: 4,
              background: '#1e222a',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              borderRadius: 8,
              padding: 4,
              minWidth: 180,
              maxHeight: 200,
              overflowY: 'auto',
              zIndex: 50,
              boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
            }}
          >
            {availableEntries.length === 0 ? (
              <div style={{ padding: '8px 10px', fontSize: 12, color: '#5c6070' }}>
                No entries available
              </div>
            ) : (
              availableEntries.map(entry => (
                <button
                  key={entry.id}
                  onClick={() => handleAddEntry(entry.id)}
                  style={{
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '8px 10px',
                    background: 'transparent',
                    border: 'none',
                    borderRadius: 6,
                    cursor: 'pointer',
                    color: '#f0f0f0',
                    fontSize: 13,
                    textAlign: 'left',
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)'}
                  onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                >
                  <Folder size={14} style={{ color: '#f59e0b' }} />
                  <span className="truncate">{entry.name}</span>
                </button>
              ))
            )}
          </div>
        )}
      </div>

      {/* Refresh button */}
      <button
        onClick={() => fetchEntries()}
        disabled={isLoading}
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
        <RefreshCw size={12} className={cn(isLoading && 'animate-spin')} />
      </button>
    </div>
  )

  return (
    <BaseDashboardPanel
      panel={panel}
      panelDef={{
        ...panelDef,
        icon: categoryIcon,
      }}
      onClose={onClose}
      onDelete={onDelete}
      onTitleChange={onTitleChange}
      isActive={isActive}
      contentClassName="p-2"
      headerActions={headerActions}
    >
      {isLoading ? (
        <CategoryPanelSkeleton />
      ) : error ? (
        <div
          className="flex flex-col items-center justify-center text-center min-h-[80px]"
          style={{ color: '#8b8fa3' }}
        >
          <p style={{ fontSize: 12 }}>{error}</p>
          <button
            onClick={() => fetchEntries()}
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
          className="flex flex-col items-center justify-center text-center min-h-[80px]"
          style={{ color: '#8b8fa3' }}
        >
          <Folder size={24} style={{ opacity: 0.5, marginBottom: 8 }} />
          <p style={{ fontSize: 12 }}>No entries in this category</p>
          <p style={{ fontSize: 11, color: '#5c6070', marginTop: 4 }}>
            Click + to add entries
          </p>
        </div>
      ) : (
        <div className="space-y-0.5">
          {entries.map(entry => (
            <div key={entry.id}>
              {/* Entry row */}
              <div
                className="flex items-center gap-2 group"
                style={{
                  padding: '6px 8px',
                  borderRadius: 6,
                  cursor: 'pointer',
                  transition: 'background 0.15s ease',
                }}
                onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255, 255, 255, 0.04)'}
                onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
              >
                {/* Expand chevron */}
                {entry.workspaces.length > 1 && (
                  <button
                    onClick={() => handleEntryClick(entry)}
                    style={{
                      width: 16,
                      height: 16,
                      background: 'transparent',
                      border: 'none',
                      padding: 0,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      cursor: 'pointer',
                      color: '#5c6070',
                    }}
                  >
                    <ChevronRight
                      size={12}
                      className={cn('transition-transform', expandedEntryId === entry.id && 'rotate-90')}
                    />
                  </button>
                )}
                {entry.workspaces.length <= 1 && <span style={{ width: 16 }} />}

                {/* Entry name */}
                <button
                  onClick={() => handleEntryClick(entry)}
                  className="flex-1 min-w-0 text-left"
                  style={{
                    background: 'transparent',
                    border: 'none',
                    padding: 0,
                    cursor: 'pointer',
                  }}
                >
                  <span className="truncate block" style={{ fontSize: 13, color: '#f0f0f0' }}>
                    {entry.name}
                  </span>
                </button>

                {/* Workspace count badge */}
                {entry.workspaces.length > 0 && (
                  <span
                    style={{
                      fontSize: 10,
                      color: '#5c6070',
                      background: 'rgba(255, 255, 255, 0.05)',
                      padding: '2px 6px',
                      borderRadius: 4,
                    }}
                  >
                    {entry.workspaces.length}
                  </span>
                )}

                {/* Remove button (shown on hover) */}
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    handleRemoveEntry(entry.id)
                  }}
                  className="opacity-0 group-hover:opacity-100"
                  title="Remove from category"
                  style={{
                    width: 20,
                    height: 20,
                    background: 'transparent',
                    border: 'none',
                    borderRadius: 4,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                    color: '#5c6070',
                    transition: 'opacity 0.15s ease',
                  }}
                >
                  <Trash2 size={12} />
                </button>
              </div>

              {/* Expanded workspaces */}
              {expandedEntryId === entry.id && entry.workspaces.length > 1 && (
                <div style={{ marginLeft: 24, marginTop: 2 }}>
                  {entry.workspaces.map(workspace => (
                    <button
                      key={workspace.id}
                      onClick={() => handleWorkspaceClick(entry.id, workspace.id)}
                      className="w-full text-left flex items-center gap-2"
                      style={{
                        padding: '4px 8px',
                        background: 'transparent',
                        border: 'none',
                        borderRadius: 4,
                        cursor: 'pointer',
                        fontSize: 12,
                        color: '#6366f1',
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
                          background: '#6366f1',
                        }}
                      />
                      <span className="truncate">
                        {workspace.name}
                        {workspace.isDefault && (
                          <span style={{ color: '#5c6070', marginLeft: 4 }}>(default)</span>
                        )}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </BaseDashboardPanel>
  )
}
