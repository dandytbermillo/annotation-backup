"use client"

/**
 * Links Note Panel Component
 * Part of Dashboard Implementation - Phase 2.2e
 *
 * A contenteditable note panel with highlight-to-link feature:
 * - Select text to show "Link to Workspace" toolbar
 * - Click to open workspace picker
 * - Creates clickable workspace links
 */

import React, { useState, useCallback, useRef, useEffect } from 'react'
import { Link2, Search, X, Plus, Loader2 } from 'lucide-react'
import { BaseDashboardPanel } from './BaseDashboardPanel'
import { getPanelType, type BasePanelProps } from '@/lib/dashboard/panel-registry'
import { requestWorkspaceListRefresh } from '@/lib/note-workspaces/state'

interface WorkspaceOption {
  id: string
  name: string
  entryId: string
  entryName: string
}

export function LinksNotePanel({
  panel,
  onClose,
  onConfigChange,
  onNavigate,
  isActive,
}: BasePanelProps) {
  const panelDef = getPanelType('links_note')
  const containerRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const [showLinkToolbar, setShowLinkToolbar] = useState(false)
  const [toolbarTop, setToolbarTop] = useState(0)
  const [selectedRange, setSelectedRange] = useState<Range | null>(null)
  const [showPicker, setShowPicker] = useState(false)
  const [workspaces, setWorkspaces] = useState<WorkspaceOption[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [isSearching, setIsSearching] = useState(false)
  const [isCreatingWorkspace, setIsCreatingWorkspace] = useState(false)
  const [selectedText, setSelectedText] = useState('') // Store text as string to preserve it
  const searchInputRef = useRef<HTMLInputElement>(null)

  // Load initial content
  useEffect(() => {
    if (contentRef.current && panel.config.content) {
      contentRef.current.innerHTML = panel.config.content
    }
  }, [])

  // Search workspaces
  const searchWorkspaces = useCallback(async (query: string) => {
    setIsSearching(true)
    try {
      const response = await fetch(`/api/dashboard/workspaces/search?q=${encodeURIComponent(query)}&limit=20`)
      if (response.ok) {
        const data = await response.json()
        setWorkspaces(data.workspaces || [])
      }
    } catch (err) {
      console.error('[LinksNotePanel] Search error:', err)
    } finally {
      setIsSearching(false)
    }
  }, [])

  // Load workspaces when picker opens
  useEffect(() => {
    if (showPicker) {
      searchWorkspaces('')
      setTimeout(() => searchInputRef.current?.focus(), 100)
    }
  }, [showPicker, searchWorkspaces])

  // Handle search input
  useEffect(() => {
    const timer = setTimeout(() => {
      if (showPicker) {
        searchWorkspaces(searchQuery)
      }
    }, 200)
    return () => clearTimeout(timer)
  }, [searchQuery, showPicker, searchWorkspaces])

  // Handle text selection
  const handleMouseUp = useCallback(() => {
    const selection = window.getSelection()
    if (!selection || selection.isCollapsed || !contentRef.current || !containerRef.current) {
      setShowLinkToolbar(false)
      return
    }

    const text = selection.toString().trim()
    if (!text) {
      setShowLinkToolbar(false)
      return
    }

    // Check if selection is within our content
    const range = selection.getRangeAt(0)
    if (!contentRef.current.contains(range.commonAncestorContainer)) {
      setShowLinkToolbar(false)
      return
    }

    // Get position relative to container
    const rangeRect = range.getBoundingClientRect()
    const containerRect = containerRef.current.getBoundingClientRect()
    const relativeTop = rangeRect.top - containerRect.top

    setToolbarTop(relativeTop - 40) // 40px above selection
    setSelectedRange(range.cloneRange())
    setSelectedText(text) // Store the text as string to preserve it when picker opens
    setShowLinkToolbar(true)
  }, [])

  // Handle workspace link click - navigate
  const handleLinkClick = useCallback(async (e: React.MouseEvent) => {
    const target = e.target as HTMLElement
    if (target.classList.contains('workspace-link')) {
      e.preventDefault()
      const workspaceName = target.getAttribute('data-workspace') || target.textContent
      if (!workspaceName) return

      try {
        const response = await fetch(`/api/dashboard/workspaces/search?q=${encodeURIComponent(workspaceName)}`)
        if (response.ok) {
          const data = await response.json()
          const workspace = data.workspaces?.find(
            (ws: WorkspaceOption) => ws.name.toLowerCase() === workspaceName.toLowerCase()
          ) || data.workspaces?.[0]

          if (workspace && onNavigate) {
            onNavigate(workspace.entryId || '', workspace.id)
          }
        }
      } catch (err) {
        console.error('[LinksNotePanel] Navigation error:', err)
      }
    }
  }, [onNavigate])

  // Create workspace link from selection
  const createLink = useCallback((workspace: WorkspaceOption) => {
    if (!selectedRange || !contentRef.current) return

    // Create the link element
    const link = document.createElement('span')
    link.className = 'workspace-link'
    link.setAttribute('data-workspace', workspace.name)
    link.setAttribute('data-workspace-id', workspace.id)
    link.textContent = selectedRange.toString()

    // Replace selection with link
    selectedRange.deleteContents()
    selectedRange.insertNode(link)

    // Clear selection state
    window.getSelection()?.removeAllRanges()
    setShowLinkToolbar(false)
    setShowPicker(false)
    setSelectedRange(null)
    setSelectedText('')
    setSearchQuery('')

    // Save content
    if (contentRef.current) {
      onConfigChange?.({ content: contentRef.current.innerHTML })
    }
  }, [selectedRange, onConfigChange])

  // Create a new workspace and link to it
  const createNewWorkspace = useCallback(async () => {
    console.log('[LinksNotePanel] createNewWorkspace called', { selectedRange, selectedText, contentRef: !!contentRef.current })

    if (!contentRef.current) {
      console.error('[LinksNotePanel] No contentRef')
      return
    }

    const workspaceName = selectedText.trim() || 'New Workspace'
    console.log('[LinksNotePanel] Creating workspace:', workspaceName)

    setIsCreatingWorkspace(true)
    try {
      // Create the workspace via API
      const response = await fetch('/api/note-workspaces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: workspaceName }),
      })

      console.log('[LinksNotePanel] API response status:', response.status)

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }))
        console.error('[LinksNotePanel] API error:', errorData)
        throw new Error(errorData.details || errorData.error || 'Failed to create workspace')
      }

      const data = await response.json()
      console.log('[LinksNotePanel] Created workspace:', data)
      const newWorkspace = data.workspace

      if (newWorkspace) {
        // Create the link element
        const link = document.createElement('span')
        link.className = 'workspace-link'
        link.setAttribute('data-workspace', newWorkspace.name)
        link.setAttribute('data-workspace-id', newWorkspace.id)
        link.textContent = selectedText.trim() || newWorkspace.name

        // Try to replace selection with link if range is still valid
        if (selectedRange) {
          try {
            selectedRange.deleteContents()
            selectedRange.insertNode(link)
          } catch (rangeErr) {
            console.warn('[LinksNotePanel] Range invalid, appending link instead:', rangeErr)
            // Fallback: append link at end of content
            contentRef.current.appendChild(document.createTextNode(' '))
            contentRef.current.appendChild(link)
          }
        } else {
          // No range, append at end
          contentRef.current.appendChild(document.createTextNode(' '))
          contentRef.current.appendChild(link)
        }

        // Clear selection state
        window.getSelection()?.removeAllRanges()
        setShowLinkToolbar(false)
        setShowPicker(false)
        setSelectedRange(null)
        setSelectedText('')
        setSearchQuery('')

        // Save content
        onConfigChange?.({ content: contentRef.current.innerHTML })

        // Request workspace list refresh so the hook picks up the new workspace
        console.log('[LinksNotePanel] Requesting workspace list refresh...')
        requestWorkspaceListRefresh()

        // Wait a moment for the refresh to complete, then navigate
        setTimeout(() => {
          if (onNavigate) {
            console.log('[LinksNotePanel] Navigating to new workspace:', newWorkspace.id)
            onNavigate(newWorkspace.itemId || '', newWorkspace.id)
          }
        }, 300)
      }
    } catch (err) {
      console.error('[LinksNotePanel] Failed to create workspace:', err)
    } finally {
      setIsCreatingWorkspace(false)
    }
  }, [selectedRange, selectedText, onConfigChange, onNavigate])

  // Save content on blur
  const handleBlur = useCallback((e: React.FocusEvent) => {
    // Don't save if focus moved to picker
    if (e.relatedTarget && (e.relatedTarget as HTMLElement).closest('.workspace-picker')) {
      return
    }
    if (contentRef.current) {
      const newContent = contentRef.current.innerHTML
      if (newContent !== panel.config.content) {
        onConfigChange?.({ content: newContent })
      }
    }
  }, [panel.config.content, onConfigChange])

  // Close picker
  const closePicker = useCallback(() => {
    setShowPicker(false)
    setShowLinkToolbar(false)
    setSearchQuery('')
    setSelectedText('')
    setSelectedRange(null)
  }, [])

  // Keyboard shortcut: Cmd+K
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        const selection = window.getSelection()
        if (selection && !selection.isCollapsed && contentRef.current?.contains(selection.anchorNode)) {
          e.preventDefault()
          setShowPicker(true)
        }
      }
      if (e.key === 'Escape') {
        closePicker()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [closePicker])

  if (!panelDef) return null

  return (
    <BaseDashboardPanel
      panel={panel}
      panelDef={panelDef}
      onClose={onClose}
      isActive={isActive}
    >
      <style>{`
        .links-note-container {
          position: relative;
          height: 100%;
        }
        .links-note-editor {
          min-height: 80px;
          outline: none;
          font-size: 14px;
          line-height: 1.7;
          color: #e0e0e0;
          padding-right: 4px;
        }
        .links-note-editor:empty:before {
          content: "Type here... Select text and press ⌘K to link to a workspace";
          color: #5c6070;
          pointer-events: none;
        }
        .links-note-editor .workspace-link {
          display: inline;
          padding: 2px 8px;
          background: rgba(99, 102, 241, 0.15);
          color: #818cf8;
          border-radius: 4px;
          font-size: 13px;
          font-weight: 500;
          cursor: pointer;
          text-decoration: none;
          transition: all 0.15s;
        }
        .links-note-editor .workspace-link:hover {
          background: #6366f1;
          color: white;
        }
        .link-toolbar {
          position: absolute;
          left: 50%;
          transform: translateX(-50%);
          background: #252830;
          border: 1px solid rgba(255, 255, 255, 0.12);
          border-radius: 8px;
          padding: 4px;
          box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
          z-index: 10;
        }
        .link-toolbar button {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 6px 12px;
          background: transparent;
          border: none;
          border-radius: 6px;
          color: #c0c4d0;
          font-size: 12px;
          cursor: pointer;
          white-space: nowrap;
        }
        .link-toolbar button:hover {
          background: rgba(99, 102, 241, 0.15);
          color: #818cf8;
        }
        .workspace-picker-overlay {
          position: absolute;
          inset: 0;
          background: rgba(0, 0, 0, 0.5);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 20;
          border-radius: 8px;
        }
        .workspace-picker {
          background: #1e222a;
          border: 1px solid rgba(255, 255, 255, 0.12);
          border-radius: 10px;
          width: 90%;
          max-width: 280px;
          max-height: 280px;
          overflow: hidden;
          box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
        }
        .workspace-picker-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 10px 12px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.08);
        }
        .workspace-picker-header span {
          font-size: 12px;
          font-weight: 600;
          color: #818cf8;
        }
        .workspace-picker-close {
          width: 20px;
          height: 20px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: transparent;
          border: none;
          border-radius: 4px;
          color: #5c6070;
          cursor: pointer;
        }
        .workspace-picker-close:hover {
          background: rgba(255, 255, 255, 0.05);
          color: #c0c4d0;
        }
        .workspace-picker-search {
          padding: 8px 10px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.08);
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .workspace-picker-search input {
          flex: 1;
          background: transparent;
          border: none;
          font-size: 13px;
          color: #f0f0f0;
          outline: none;
        }
        .workspace-picker-search input::placeholder {
          color: #5c6070;
        }
        .workspace-picker-list {
          max-height: 180px;
          overflow-y: auto;
          padding: 6px;
        }
        .workspace-picker-item {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 8px 10px;
          border-radius: 6px;
          cursor: pointer;
          transition: background 0.15s;
        }
        .workspace-picker-item:hover {
          background: rgba(255, 255, 255, 0.05);
        }
        .workspace-picker-item-icon {
          width: 26px;
          height: 26px;
          background: rgba(99, 102, 241, 0.15);
          border-radius: 6px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 11px;
          font-weight: 600;
          color: #818cf8;
          flex-shrink: 0;
        }
        .workspace-picker-item-name {
          font-size: 13px;
          font-weight: 500;
          color: #f0f0f0;
        }
        .workspace-picker-item-entry {
          font-size: 11px;
          color: #5c6070;
        }
        .workspace-picker-empty {
          padding: 20px;
          text-align: center;
          color: #5c6070;
          font-size: 13px;
        }
        .workspace-picker-create {
          display: flex;
          align-items: center;
          gap: 10px;
          width: 100%;
          padding: 10px;
          background: rgba(99, 102, 241, 0.1);
          border: 1px dashed rgba(99, 102, 241, 0.3);
          border-radius: 8px;
          color: #818cf8;
          font-size: 13px;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.15s;
          margin-bottom: 8px;
        }
        .workspace-picker-create:hover:not(:disabled) {
          background: rgba(99, 102, 241, 0.2);
          border-color: rgba(99, 102, 241, 0.5);
        }
        .workspace-picker-create:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }
        .workspace-picker-create span {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .workspace-picker-divider {
          font-size: 10px;
          font-weight: 600;
          color: #5c6070;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          padding: 8px 10px 6px;
        }
      `}</style>

      <div ref={containerRef} className="links-note-container">
        {/* Editable content */}
        <div
          ref={contentRef}
          className="links-note-editor"
          contentEditable
          suppressContentEditableWarning
          onMouseUp={handleMouseUp}
          onClick={handleLinkClick}
          onBlur={handleBlur}
        />

        {/* Link toolbar - appears on text selection */}
        {showLinkToolbar && !showPicker && (
          <div className="link-toolbar" style={{ top: Math.max(0, toolbarTop) }}>
            <button onClick={() => setShowPicker(true)}>
              <Link2 size={14} />
              Link to Workspace
            </button>
          </div>
        )}

        {/* Workspace picker - centered overlay */}
        {showPicker && (
          <div className="workspace-picker-overlay" onClick={closePicker}>
            <div className="workspace-picker" onClick={(e) => e.stopPropagation()}>
              <div className="workspace-picker-header">
                <span>Link to Workspace</span>
                <button className="workspace-picker-close" onClick={closePicker}>
                  <X size={14} />
                </button>
              </div>
              <div className="workspace-picker-search">
                <Search size={14} style={{ color: '#5c6070', flexShrink: 0 }} />
                <input
                  ref={searchInputRef}
                  type="text"
                  placeholder="Search workspaces..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
              <div className="workspace-picker-list">
                {/* Create new workspace button */}
                <button
                  className="workspace-picker-create"
                  onClick={createNewWorkspace}
                  disabled={isCreatingWorkspace}
                >
                  {isCreatingWorkspace ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <Plus size={14} />
                  )}
                  <span>
                    {isCreatingWorkspace
                      ? 'Creating...'
                      : selectedText
                        ? `Create "${selectedText.slice(0, 20)}${selectedText.length > 20 ? '...' : ''}" workspace`
                        : 'Create new workspace'}
                  </span>
                </button>

                {isSearching ? (
                  <div className="workspace-picker-empty">Searching...</div>
                ) : workspaces.length === 0 ? (
                  <div className="workspace-picker-empty">No existing workspaces</div>
                ) : (
                  <>
                    <div className="workspace-picker-divider">Or link to existing:</div>
                    {workspaces.map((ws) => (
                      <div
                        key={ws.id}
                        className="workspace-picker-item"
                        onClick={() => createLink(ws)}
                      >
                        <div className="workspace-picker-item-icon">
                          {ws.name.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <div className="workspace-picker-item-name">{ws.name}</div>
                          <div className="workspace-picker-item-entry">{ws.entryName}</div>
                        </div>
                      </div>
                    ))}
                  </>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </BaseDashboardPanel>
  )
}
