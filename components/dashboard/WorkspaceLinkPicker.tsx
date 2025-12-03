"use client"

/**
 * Workspace Link Picker Component
 * Part of Dashboard Implementation - Phase 3.3b
 *
 * A searchable dropdown/modal for selecting a workspace to link to.
 * Used with the highlight-to-link feature (Cmd+K on selected text).
 */

import React, { useState, useEffect, useCallback, useRef } from 'react'
import { Search, Link, Loader2, X, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface WorkspaceOption {
  id: string
  name: string
  entryId: string | null
  entryName: string | null
}

interface WorkspaceLinkPickerProps {
  /** Whether the picker is open */
  isOpen: boolean
  /** Callback when picker is closed */
  onClose: () => void
  /** Callback when a workspace is selected */
  onSelect: (workspace: WorkspaceOption) => void
  /** Position for the picker (for positioning near selection) */
  position?: { x: number; y: number }
  /** The text that will be linked (shown as preview) */
  selectedText?: string
  /** Additional className */
  className?: string
}

export function WorkspaceLinkPicker({
  isOpen,
  onClose,
  onSelect,
  position,
  selectedText,
  className,
}: WorkspaceLinkPickerProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const [workspaces, setWorkspaces] = useState<WorkspaceOption[]>([])
  const [filteredWorkspaces, setFilteredWorkspaces] = useState<WorkspaceOption[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // Fetch workspaces on open
  useEffect(() => {
    if (!isOpen) return

    const fetchWorkspaces = async () => {
      try {
        setIsLoading(true)
        const response = await fetch('/api/dashboard/workspaces/search')
        if (response.ok) {
          const data = await response.json()
          setWorkspaces(data.workspaces || [])
          setFilteredWorkspaces(data.workspaces || [])
        }
      } catch (err) {
        console.error('[WorkspaceLinkPicker] Failed to fetch workspaces:', err)
      } finally {
        setIsLoading(false)
      }
    }

    fetchWorkspaces()
    setSearchQuery('')
    setSelectedIndex(0)

    // Focus input after render
    setTimeout(() => inputRef.current?.focus(), 50)
  }, [isOpen])

  // Filter workspaces based on search query
  useEffect(() => {
    if (!searchQuery.trim()) {
      setFilteredWorkspaces(workspaces)
      setSelectedIndex(0)
      return
    }

    const query = searchQuery.toLowerCase()
    const filtered = workspaces.filter(
      (ws) =>
        ws.name.toLowerCase().includes(query) ||
        (ws.entryName && ws.entryName.toLowerCase().includes(query))
    )
    setFilteredWorkspaces(filtered)
    setSelectedIndex(0)
  }, [searchQuery, workspaces])

  // Handle keyboard navigation
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault()
          setSelectedIndex((prev) =>
            prev < filteredWorkspaces.length - 1 ? prev + 1 : prev
          )
          break
        case 'ArrowUp':
          e.preventDefault()
          setSelectedIndex((prev) => (prev > 0 ? prev - 1 : 0))
          break
        case 'Enter':
          e.preventDefault()
          if (filteredWorkspaces[selectedIndex]) {
            onSelect(filteredWorkspaces[selectedIndex])
            onClose()
          }
          break
        case 'Escape':
          e.preventDefault()
          onClose()
          break
      }
    },
    [filteredWorkspaces, selectedIndex, onSelect, onClose]
  )

  // Click outside to close
  useEffect(() => {
    if (!isOpen) return

    const handleClickOutside = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        onClose()
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isOpen, onClose])

  if (!isOpen) return null

  const style: React.CSSProperties = position
    ? {
        position: 'fixed',
        left: `${position.x}px`,
        top: `${position.y}px`,
        transform: 'translateY(4px)',
      }
    : {}

  return (
    <div
      ref={containerRef}
      className={cn(
        'bg-popover border border-border rounded-lg shadow-lg w-80 max-h-96 overflow-hidden z-50',
        className
      )}
      style={style}
      onKeyDown={handleKeyDown}
    >
      {/* Header with search */}
      <div className="p-3 border-b border-border">
        <div className="flex items-center gap-2 mb-2">
          <Link size={14} className="text-muted-foreground" />
          <span className="text-sm font-medium text-foreground">
            Link to Workspace
          </span>
          <button
            onClick={onClose}
            className="ml-auto p-1 rounded hover:bg-muted text-muted-foreground"
          >
            <X size={14} />
          </button>
        </div>

        {selectedText && (
          <div className="text-xs text-muted-foreground mb-2 truncate">
            Link text: <span className="text-foreground">"{selectedText}"</span>
          </div>
        )}

        <div className="relative">
          <Search
            size={14}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <input
            ref={inputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search workspaces..."
            className={cn(
              'w-full pl-8 pr-3 py-1.5 text-sm rounded-md border border-input bg-background',
              'placeholder:text-muted-foreground',
              'focus:outline-none focus:ring-2 focus:ring-ring'
            )}
          />
        </div>
      </div>

      {/* Workspace list */}
      <div className="max-h-64 overflow-y-auto">
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 size={20} className="animate-spin text-muted-foreground" />
          </div>
        ) : filteredWorkspaces.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            {searchQuery ? 'No workspaces found' : 'No workspaces available'}
          </div>
        ) : (
          <div className="p-1">
            {filteredWorkspaces.map((workspace, index) => (
              <button
                key={workspace.id}
                onClick={() => {
                  onSelect(workspace)
                  onClose()
                }}
                className={cn(
                  'w-full flex items-center gap-2 px-3 py-2 text-left rounded-md transition-colors',
                  index === selectedIndex
                    ? 'bg-primary/10 text-primary'
                    : 'hover:bg-muted'
                )}
              >
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">
                    {workspace.name}
                  </div>
                  {workspace.entryName && (
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <span className="truncate">{workspace.entryName}</span>
                      <ChevronRight size={10} />
                      <span className="truncate">{workspace.name}</span>
                    </div>
                  )}
                </div>
                {index === selectedIndex && (
                  <kbd className="px-1.5 py-0.5 text-[10px] bg-muted rounded">
                    Enter
                  </kbd>
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Footer hint */}
      <div className="px-3 py-2 border-t border-border text-xs text-muted-foreground">
        <kbd className="px-1 py-0.5 bg-muted rounded">↑↓</kbd> Navigate{' '}
        <kbd className="px-1 py-0.5 bg-muted rounded ml-1">Enter</kbd> Select{' '}
        <kbd className="px-1 py-0.5 bg-muted rounded ml-1">Esc</kbd> Close
      </div>
    </div>
  )
}

/**
 * Hook to manage workspace link picker state
 */
export function useWorkspaceLinkPicker() {
  const [isOpen, setIsOpen] = useState(false)
  const [position, setPosition] = useState<{ x: number; y: number } | undefined>()
  const [selectedText, setSelectedText] = useState<string | undefined>()
  const [onSelectCallback, setOnSelectCallback] = useState<
    ((workspace: WorkspaceOption) => void) | undefined
  >()

  const open = useCallback(
    (options: {
      position?: { x: number; y: number }
      selectedText?: string
      onSelect: (workspace: WorkspaceOption) => void
    }) => {
      setPosition(options.position)
      setSelectedText(options.selectedText)
      setOnSelectCallback(() => options.onSelect)
      setIsOpen(true)
    },
    []
  )

  const close = useCallback(() => {
    setIsOpen(false)
    setPosition(undefined)
    setSelectedText(undefined)
    setOnSelectCallback(undefined)
  }, [])

  return {
    isOpen,
    position,
    selectedText,
    open,
    close,
    onSelect: onSelectCallback || (() => {}),
  }
}
