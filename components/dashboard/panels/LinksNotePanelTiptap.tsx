"use client"

/**
 * Links Note Panel Component (TipTap Version)
 * Part of Dashboard Implementation
 *
 * A TipTap-based note panel with highlight-to-link feature:
 * - Uses TipTap editor with BubbleMenu for link creation
 * - Select text to show "Link to Workspace" toolbar
 * - Creates clickable workspace links with entry context
 * - Supports internal vs external link distinction
 *
 * This is the TipTap version of LinksNotePanel, using proper
 * TipTap extensions instead of contenteditable.
 */

import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import { Link2, Search, X, Plus, Loader2, Trash2, RotateCcw } from 'lucide-react'
import { BaseDashboardPanel, type CustomMenuItem } from './BaseDashboardPanel'
import { getPanelType, type BasePanelProps, type DeletedLink, type PanelConfig } from '@/lib/dashboard/panel-registry'
import { requestWorkspaceListRefresh } from '@/lib/note-workspaces/state'
import { useChatNavigationContext } from '@/lib/chat/chat-navigation-context'
import {
  setActiveEntryContext,
  getActiveEntryContext,
  subscribeToActiveEntryContext,
  createEntryForWorkspace,
} from '@/lib/entry'
import { debugLog } from '@/lib/utils/debug-logger'
import {
  QuickLinksMark,
  insertQuickLink,
  getSelectedText,
  hasTextSelection,
  getAllQuickLinks,
  attachQuickLinkHoverIcon,
  type QuickLinkAttributes,
  type QuickLinkHoverData,
} from '@/lib/extensions/quick-links'

interface WorkspaceOption {
  id: string
  name: string
  entryId: string
  entryName: string
  isDefault?: boolean
}

// Auto-purge links older than 30 days
const PURGE_DAYS = 30

/**
 * Derive the chat panel ID from the panel title.
 * Maps "Quick Links A" → "quick-links-a", etc.
 * Returns null if badge cannot be determined.
 */
function deriveChatPanelId(panelTitle: string | null | undefined): string | null {
  if (!panelTitle) return null
  // Match "Quick Links X" where X is A/B/C/D (case insensitive)
  const match = panelTitle.match(/quick\s*links?\s*([a-d])/i)
  if (match) {
    const badge = match[1].toLowerCase()
    return `quick-links-${badge}`
  }
  return null
}

function purgeOldDeletedLinks(deletedLinks: DeletedLink[]): DeletedLink[] {
  const cutoffDate = new Date()
  cutoffDate.setDate(cutoffDate.getDate() - PURGE_DAYS)

  return deletedLinks.filter(link => {
    const deletedAt = new Date(link.deletedAt)
    return deletedAt > cutoffDate
  })
}

export function LinksNotePanelTiptap({
  panel,
  onClose,
  onConfigChange,
  onTitleChange,
  onNavigate,
  onOpenWorkspace,
  onDelete,
  isActive,
}: BasePanelProps) {
  const panelDef = getPanelType('links_note')
  const containerRef = useRef<HTMLDivElement>(null)
  const [showPicker, setShowPicker] = useState(false)
  // Custom toolbar state (replacing BubbleMenu for better control)
  const [showLinkToolbar, setShowLinkToolbar] = useState(false)
  const [toolbarTop, setToolbarTop] = useState(0)
  const [workspaces, setWorkspaces] = useState<WorkspaceOption[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [isSearching, setIsSearching] = useState(false)
  const [isCreatingWorkspace, setIsCreatingWorkspace] = useState(false)
  const [selectedText, setSelectedText] = useState('')
  const [filterByEntry, setFilterByEntry] = useState(true)
  const searchInputRef = useRef<HTMLInputElement>(null)

  // Trash section state
  const [showTrashPopover, setShowTrashPopover] = useState(false)
  const previousLinksRef = useRef<QuickLinkAttributes[]>([])

  // Get deleted links from config (with auto-purge)
  const config = panel.config as PanelConfig & { deletedLinks?: DeletedLink[] }
  const deletedLinks = config.deletedLinks || []

  // Chat visibility tracking (Gap 2)
  const { registerVisiblePanel, unregisterVisiblePanel, setFocusedPanelId } = useChatNavigationContext()
  const chatPanelId = deriveChatPanelId(panel.title)

  // Register panel visibility on mount
  useEffect(() => {
    if (chatPanelId) {
      registerVisiblePanel(chatPanelId)
      return () => unregisterVisiblePanel(chatPanelId)
    }
  }, [chatPanelId, registerVisiblePanel, unregisterVisiblePanel])

  // Update focused panel when isActive changes
  useEffect(() => {
    if (isActive && chatPanelId) {
      setFocusedPanelId(chatPanelId)
    }
  }, [isActive, chatPanelId, setFocusedPanelId])

  // Current entry ID ref for the extension
  const currentEntryIdRef = useRef<string | null>(null)
  // Track last saved content to avoid unnecessary updates
  const lastSavedContentRef = useRef<string>('')
  // Ref to hold editor instance to avoid stale closure
  const editorRef = useRef<ReturnType<typeof useEditor>>(null)

  // Refs for callback props to avoid recreating editor on prop changes
  const onNavigateRef = useRef(onNavigate)
  const onOpenWorkspaceRef = useRef(onOpenWorkspace)
  const onConfigChangeRef = useRef(onConfigChange)

  // Keep refs updated
  useEffect(() => {
    onNavigateRef.current = onNavigate
    onOpenWorkspaceRef.current = onOpenWorkspace
    onConfigChangeRef.current = onConfigChange
  })

  // Update current entry ID
  useEffect(() => {
    currentEntryIdRef.current = getActiveEntryContext()
    void debugLog({
      component: 'LinksNotePanelTiptap',
      action: 'initial_entry_context',
      metadata: { entryId: currentEntryIdRef.current },
    })

    const unsubscribe = subscribeToActiveEntryContext((entryId) => {
      void debugLog({
        component: 'LinksNotePanelTiptap',
        action: 'entry_context_changed',
        metadata: { entryId },
      })
      currentEntryIdRef.current = entryId
      // DISABLED: DOM manipulation was causing issues with TipTap updates
      // External link styling now handled purely via data attributes and CSS
    })

    return unsubscribe
  }, [])

  // Handle internal link click (same entry) - stable reference using refs
  const handleInternalLinkClick = useCallback((workspaceId: string, workspaceName: string) => {
    debugLog({
      component: 'LinksNotePanelTiptap',
      action: 'internal_link_clicked',
      metadata: { workspaceId, workspaceName },
    })

    if (onOpenWorkspaceRef.current) {
      onOpenWorkspaceRef.current(workspaceId)
    } else if (onNavigateRef.current) {
      const currentEntryId = getActiveEntryContext()
      if (currentEntryId) {
        onNavigateRef.current(currentEntryId, workspaceId)
      }
    }
  }, []) // Empty deps - uses refs

  // Handle external link click (different entry) - stable reference using refs
  const handleExternalLinkClick = useCallback(async (
    entryId: string,
    workspaceId: string,
    dashboardId: string | null
  ) => {
    debugLog({
      component: 'LinksNotePanelTiptap',
      action: 'external_link_clicked',
      metadata: { entryId, workspaceId, dashboardId },
    })

    // If no dashboard ID, look it up
    let targetId = dashboardId || workspaceId
    if (!dashboardId) {
      try {
        const response = await fetch(`/api/entries/${entryId}/workspaces`)
        if (response.ok) {
          const data = await response.json()
          const dashboardWorkspace = data.workspaces?.find(
            (ws: { name: string; id: string }) => ws.name === 'Dashboard'
          )
          if (dashboardWorkspace) {
            targetId = dashboardWorkspace.id
          }
        }
      } catch (err) {
        console.error('[LinksNotePanelTiptap] Failed to lookup dashboard:', err)
      }
    }

    // Note: Entry context is set by handleDashboardNavigate (the navigation handler)
    // after it determines the correct workspace. Setting it here would cause a race
    // condition where stale workspace context is used before navigation completes.
    if (onNavigateRef.current) {
      onNavigateRef.current(entryId, targetId)
    }
  }, []) // Empty deps - uses refs

  // Ref for deletedLinks to avoid stale closure in onUpdate
  const deletedLinksRef = useRef(deletedLinks)
  useEffect(() => {
    deletedLinksRef.current = deletedLinks
  }, [deletedLinks])

  // Memoize extensions to prevent TipTap from recreating editor
  const extensions = useMemo(() => [
    StarterKit.configure({
      // Use default history settings
    }),
    Placeholder.configure({
      placeholder: "Type here... Select text and press ⌘K to link to a workspace",
    }),
    QuickLinksMark.configure({
      getCurrentEntryId: () => currentEntryIdRef.current,
      onInternalLinkClick: handleInternalLinkClick,
      onExternalLinkClick: handleExternalLinkClick,
      clickable: false, // Disabled - navigation handled by hover icon instead
    }),
  ], [handleInternalLinkClick, handleExternalLinkClick])

  // Ref for hover navigate handler to avoid stale closures in onCreate
  const handleHoverNavigateRef = useRef<((data: QuickLinkHoverData) => void) | null>(null)

  // Initialize TipTap editor with stable configuration
  const editor = useEditor({
    extensions,
    content: panel.config.content || '',
    editable: true,
    autofocus: false,
    editorProps: {
      attributes: {
        class: 'links-note-tiptap-editor',
      },
    },
    onCreate: ({ editor }) => {
      // Attach hover icon when editor is created (like annotation hover pattern)
      const hoverIcon = attachQuickLinkHoverIcon({
        view: editor.view,
        onNavigate: (data) => {
          // Use ref to get current handler
          handleHoverNavigateRef.current?.(data)
        },
        linkSelector: '.quick-link',
        offset: 8,
      })

      // Clean up on editor destroy
      editor.on('destroy', () => {
        hoverIcon.destroy()
      })
    },
    onUpdate: ({ editor }) => {
      // Get current content in both formats
      const html = editor.getHTML()
      const json = editor.getJSON()

      // Skip if content hasn't changed (prevents infinite loop)
      if (html === lastSavedContentRef.current) {
        void debugLog({
          component: 'LinksNotePanelTiptap',
          action: 'onUpdate_skipped',
          metadata: { reason: 'content_unchanged' },
        })
        return
      }

      void debugLog({
        component: 'LinksNotePanelTiptap',
        action: 'onUpdate_processing',
        metadata: { htmlLength: html.length, hasJson: !!json },
      })

      // Track deleted links
      const currentLinks = getAllQuickLinks(editor)
      const previousLinks = previousLinksRef.current

      void debugLog({
        component: 'LinksNotePanelTiptap',
        action: 'onUpdate_links_check',
        metadata: { currentLinksCount: currentLinks.length, previousLinksCount: previousLinks.length },
      })

      // Find deleted links - use ref to get current value
      const currentDeletedLinks = deletedLinksRef.current
      const deletedInThisEdit: DeletedLink[] = []
      for (const prevLink of previousLinks) {
        const stillExists = currentLinks.some(
          (curr: QuickLinkAttributes) => curr.workspaceId && curr.workspaceId === prevLink.workspaceId
        )
        if (!stillExists && prevLink.workspaceId) {
          deletedInThisEdit.push({
            text: prevLink.workspaceName,
            workspaceId: prevLink.workspaceId,
            workspaceName: prevLink.workspaceName,
            entryId: prevLink.entryId,
            entryName: prevLink.entryName,
            dashboardId: prevLink.dashboardId,
            deletedAt: new Date().toISOString(),
          })
        }
      }

      previousLinksRef.current = currentLinks
      lastSavedContentRef.current = html

      void debugLog({
        component: 'LinksNotePanelTiptap',
        action: 'onUpdate_saving',
        metadata: { deletedCount: deletedInThisEdit.length },
      })

      // Save content - use ref to call current callback
      // Save both HTML (for display) and JSON (for server-side parsing without DOM)
      if (deletedInThisEdit.length > 0) {
        const merged = [...currentDeletedLinks]
        for (const newDel of deletedInThisEdit) {
          if (!merged.some(d => d.workspaceId === newDel.workspaceId)) {
            merged.push(newDel)
          }
        }
        onConfigChangeRef.current?.({ content: html, contentJson: json, deletedLinks: merged })
      } else {
        onConfigChangeRef.current?.({ content: html, contentJson: json })
      }

      void debugLog({
        component: 'LinksNotePanelTiptap',
        action: 'onUpdate_complete',
        metadata: {},
      })
    },
    onSelectionUpdate: ({ editor }) => {
      // Update selected text and toolbar visibility
      if (hasTextSelection(editor) && !editor.isActive('quickLinksLink')) {
        setSelectedText(getSelectedText(editor))

        // Calculate toolbar position relative to container
        const { view } = editor
        const { from } = view.state.selection
        const coords = view.coordsAtPos(from)

        if (containerRef.current) {
          const containerRect = containerRef.current.getBoundingClientRect()
          const relativeTop = coords.top - containerRect.top
          setToolbarTop(relativeTop - 40) // 40px above selection
        }

        setShowLinkToolbar(true)
      } else {
        setSelectedText('')
        setShowLinkToolbar(false)
      }
    },
  })

  // Keep editorRef updated for subscription callbacks (avoids stale closure)
  useEffect(() => {
    editorRef.current = editor
  }, [editor])

  // Handle hover icon navigate callback - update ref for onCreate usage
  const handleHoverNavigate = useCallback((data: QuickLinkHoverData) => {
    void debugLog({
      component: 'LinksNotePanelTiptap',
      action: 'hover_navigate_clicked',
      metadata: { workspaceId: data.workspaceId, entryId: data.entryId },
    })

    const currentEntryId = getActiveEntryContext()
    const isInternal = data.entryId === currentEntryId

    if (isInternal) {
      // Internal link - open workspace in same entry
      if (onOpenWorkspaceRef.current) {
        onOpenWorkspaceRef.current(data.workspaceId)
      } else if (onNavigateRef.current && currentEntryId) {
        onNavigateRef.current(currentEntryId, data.workspaceId)
      }
    } else {
      // External link - navigate to different entry
      handleExternalLinkClick(data.entryId, data.workspaceId, data.dashboardId)
    }
  }, [handleExternalLinkClick])

  // Keep the hover navigate ref updated
  useEffect(() => {
    handleHoverNavigateRef.current = handleHoverNavigate
  }, [handleHoverNavigate])

  // Initialize refs from content
  useEffect(() => {
    if (editor && panel.config.content) {
      previousLinksRef.current = getAllQuickLinks(editor)
      lastSavedContentRef.current = editor.getHTML()
    }

    // Auto-purge old deleted links on load
    if (deletedLinks.length > 0) {
      const purged = purgeOldDeletedLinks(deletedLinks)
      if (purged.length !== deletedLinks.length) {
        onConfigChange?.({ deletedLinks: purged })
      }
    }
  }, [editor])

  // Search workspaces
  const searchWorkspaces = useCallback(async (query: string, shouldFilterByEntry: boolean = true) => {
    setIsSearching(true)
    try {
      const params = new URLSearchParams()
      if (query) params.set('q', query)
      params.set('limit', '20')

      const currentEntryId = getActiveEntryContext()
      if (shouldFilterByEntry && currentEntryId) {
        params.set('entryId', currentEntryId)
      }

      const url = `/api/dashboard/workspaces/search?${params.toString()}`
      const response = await fetch(url)
      if (response.ok) {
        const data = await response.json()
        setWorkspaces(data.workspaces || [])
      }
    } catch (err) {
      console.error('[LinksNotePanelTiptap] Search error:', err)
    } finally {
      setIsSearching(false)
    }
  }, [])

  // Load workspaces when picker opens
  useEffect(() => {
    if (showPicker) {
      searchWorkspaces('', filterByEntry)
      setTimeout(() => searchInputRef.current?.focus(), 100)
    }
  }, [showPicker, filterByEntry, searchWorkspaces])

  // Handle search input
  useEffect(() => {
    const timer = setTimeout(() => {
      if (showPicker) {
        searchWorkspaces(searchQuery, filterByEntry)
      }
    }, 200)
    return () => clearTimeout(timer)
  }, [searchQuery, showPicker, filterByEntry, searchWorkspaces])

  // Create workspace link from selection
  const createLink = useCallback((workspace: WorkspaceOption) => {
    if (!editor) return

    insertQuickLink(editor, {
      workspaceId: workspace.id,
      workspaceName: workspace.name,
      entryId: workspace.entryId,
      entryName: workspace.entryName,
    })

    setShowPicker(false)
    setSearchQuery('')
    setSelectedText('')
  }, [editor])

  // Ref to store pending navigation info (to break synchronous chain)
  const pendingNavigationRef = useRef<{
    entryId: string
    targetWorkspaceId: string
  } | null>(null)

  // Effect to handle navigation after component stabilizes
  useEffect(() => {
    if (pendingNavigationRef.current && !isCreatingWorkspace) {
      const { entryId, targetWorkspaceId } = pendingNavigationRef.current
      pendingNavigationRef.current = null

      void debugLog({
        component: 'LinksNotePanelTiptap',
        action: 'create_workspace_deferred_nav',
        metadata: { entryId, targetWorkspaceId },
      })

      // Use requestIdleCallback (or setTimeout fallback) to navigate during idle time
      const navigate = () => {
        if (entryId) {
          setActiveEntryContext(entryId)
        }
        if (onNavigateRef.current) {
          onNavigateRef.current(entryId, targetWorkspaceId)
        }
      }

      if ('requestIdleCallback' in window) {
        ;(window as any).requestIdleCallback(navigate, { timeout: 500 })
      } else {
        setTimeout(navigate, 100)
      }
    }
  }, [isCreatingWorkspace])

  // Create a new workspace and link to it
  const createNewWorkspace = useCallback(async () => {
    void debugLog({
      component: 'LinksNotePanelTiptap',
      action: 'create_workspace_start',
      metadata: { hasEditor: !!editor, selectedText },
    })

    if (!editor) {
      void debugLog({
        component: 'LinksNotePanelTiptap',
        action: 'create_workspace_no_editor',
        metadata: {},
      })
      return
    }

    const workspaceName = selectedText.trim() || 'New Workspace'
    setIsCreatingWorkspace(true)

    try {
      // Step 1: Create workspace
      void debugLog({
        component: 'LinksNotePanelTiptap',
        action: 'create_workspace_step1_start',
        metadata: { workspaceName },
      })

      const wsResponse = await fetch('/api/note-workspaces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: workspaceName }),
      })

      void debugLog({
        component: 'LinksNotePanelTiptap',
        action: 'create_workspace_step1_response',
        metadata: { status: wsResponse.status, ok: wsResponse.ok },
      })

      if (!wsResponse.ok) {
        throw new Error('Failed to create workspace')
      }

      const wsData = await wsResponse.json()
      const newWorkspace = wsData.workspace

      void debugLog({
        component: 'LinksNotePanelTiptap',
        action: 'create_workspace_step1_complete',
        metadata: { workspaceId: newWorkspace?.id, workspaceName: newWorkspace?.name },
      })

      // Step 2: Create entry for workspace
      let entryId = newWorkspace.itemId
      let entryName = workspaceName
      let dashboardWorkspaceId: string | null = null

      try {
        const currentEntryId = getActiveEntryContext()

        void debugLog({
          component: 'LinksNotePanelTiptap',
          action: 'create_workspace_step2_start',
          metadata: { workspaceId: newWorkspace.id, currentEntryId, badge: panel.badge },
        })

        const entryResult = await createEntryForWorkspace(
          newWorkspace.id,
          workspaceName,
          currentEntryId || undefined,
          panel.badge || undefined
        )

        if (entryResult) {
          entryId = entryResult.entry.id
          entryName = entryResult.entry.name
          dashboardWorkspaceId = (entryResult as any).dashboardWorkspaceId || null
        }

        void debugLog({
          component: 'LinksNotePanelTiptap',
          action: 'create_workspace_step2_complete',
          metadata: { entryId, entryName, dashboardWorkspaceId },
        })
      } catch (entryErr) {
        void debugLog({
          component: 'LinksNotePanelTiptap',
          action: 'entry_creation_failed',
          metadata: { error: String(entryErr) },
        })
      }

      // Step 3: Insert the link - but defer to break synchronous chain
      void debugLog({
        component: 'LinksNotePanelTiptap',
        action: 'create_workspace_step3_insert_link',
        metadata: { workspaceId: newWorkspace.id, entryId, entryName },
      })

      // Store the link data, then insert via requestAnimationFrame to break sync chain
      const linkData = {
        workspaceId: newWorkspace.id,
        workspaceName: newWorkspace.name,
        entryId: entryId || '',
        entryName: entryName || '',
        dashboardId: dashboardWorkspaceId || undefined,
      }

      // Insert the link
      insertQuickLink(editor, linkData)

      // Step 4: Store pending navigation for effect to handle
      const targetWorkspaceId = dashboardWorkspaceId || newWorkspace.id
      pendingNavigationRef.current = {
        entryId: entryId || '',
        targetWorkspaceId,
      }

      void debugLog({
        component: 'LinksNotePanelTiptap',
        action: 'create_workspace_step4_pending_nav',
        metadata: { entryId, targetWorkspaceId },
      })

      // Step 5: Reset UI state - use RAF to defer state updates
      requestAnimationFrame(() => {
        setShowPicker(false)
        setSearchQuery('')
        setSelectedText('')

        void debugLog({
          component: 'LinksNotePanelTiptap',
          action: 'create_workspace_step5_ui_reset',
          metadata: {},
        })

        // Defer workspace list refresh
        requestWorkspaceListRefresh()
      })

      void debugLog({
        component: 'LinksNotePanelTiptap',
        action: 'create_workspace_success',
        metadata: { workspaceId: newWorkspace.id, entryId, targetWorkspaceId },
      })
    } catch (err) {
      void debugLog({
        component: 'LinksNotePanelTiptap',
        action: 'create_workspace_failed',
        metadata: { error: String(err) },
      })
    } finally {
      // Defer the creating state reset to break sync chain
      requestAnimationFrame(() => {
        setIsCreatingWorkspace(false)
      })
    }
  }, [editor, selectedText, panel.badge])

  // Close picker
  const closePicker = useCallback(() => {
    setShowPicker(false)
    setSearchQuery('')
    setSelectedText('')
  }, [])

  // Restore a deleted link
  const handleRestoreLink = useCallback((link: DeletedLink) => {
    if (!editor) return

    // Guard: Don't restore if no text content
    const linkText = (link.text || link.workspaceName || '').trim()
    if (!linkText) return

    // Single atomic operation: insert space + link with mark
    // Using array ensures space (no marks) and link (with mark) are distinct nodes
    editor
      .chain()
      .focus('end')
      .insertContent([
        { type: 'text', text: ' ' },
        {
          type: 'text',
          text: linkText,
          marks: [
            {
              type: 'quickLinksLink',
              attrs: {
                workspaceId: link.workspaceId,
                workspaceName: link.workspaceName,
                entryId: link.entryId,
                entryName: link.entryName,
                dashboardId: link.dashboardId,
              },
            },
          ],
        },
      ])
      .run()

    // Remove from deleted links
    const updatedDeleted = deletedLinks.filter(d => d.workspaceId !== link.workspaceId)
    onConfigChange?.({ content: editor.getHTML(), deletedLinks: updatedDeleted })
  }, [editor, deletedLinks, onConfigChange])

  // Permanently delete a link from trash
  const handlePermanentDelete = useCallback((link: DeletedLink) => {
    const updatedDeleted = deletedLinks.filter(d => d.workspaceId !== link.workspaceId)
    onConfigChange?.({ deletedLinks: updatedDeleted })
  }, [deletedLinks, onConfigChange])

  // Format relative time
  const formatDeletedTime = useCallback((dateString: string) => {
    const date = new Date(dateString)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMins = Math.floor(diffMs / 60000)
    const diffHours = Math.floor(diffMins / 60)
    const diffDays = Math.floor(diffHours / 24)

    if (diffMins < 1) return 'Just now'
    if (diffMins < 60) return `${diffMins}m ago`
    if (diffHours < 24) return `${diffHours}h ago`
    if (diffDays < 30) return `${diffDays}d ago`
    return date.toLocaleDateString()
  }, [])

  // Keyboard shortcut: Cmd+K
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        if (editor && hasTextSelection(editor)) {
          e.preventDefault()
          setSelectedText(getSelectedText(editor))
          setShowPicker(true)
        }
      }
      if (e.key === 'Escape') {
        closePicker()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [editor, closePicker])

  if (!panelDef) return null

  // Build custom menu items for the dropdown
  const customMenuItems: CustomMenuItem[] = deletedLinks.length > 0 ? [
    {
      id: 'view-trash',
      label: 'View Trash',
      icon: <Trash2 size={14} />,
      onClick: () => setShowTrashPopover(true),
      color: '#ef4444',
      badge: deletedLinks.length,
    },
  ] : []

  return (
    <BaseDashboardPanel
      panel={panel}
      panelDef={panelDef}
      onClose={onClose}
      onDelete={onDelete}
      onTitleChange={onTitleChange}
      titleEditable={true}
      isActive={isActive}
      badge={panel.badge}
      customMenuItems={customMenuItems}
    >
      <style>{`
        .links-note-tiptap-container {
          position: relative;
          height: 100%;
          display: flex;
          flex-direction: column;
          overflow: hidden;
        }
        .links-note-tiptap-wrapper {
          flex: 1;
          min-height: 80px;
          overflow-y: auto;
        }
        .links-note-tiptap-wrapper .ProseMirror {
          outline: none;
          font-size: 14px;
          line-height: 1.7;
          color: #e0e0e0;
          padding: 4px;
          min-height: 100%;
          caret-color: #e0e0e0;
        }
        .links-note-tiptap-wrapper .ProseMirror p {
          margin: 0 0 0.5em 0;
        }
        .links-note-tiptap-wrapper .ProseMirror p.is-editor-empty:first-child::before {
          content: attr(data-placeholder);
          float: left;
          color: #5c6070;
          pointer-events: none;
          height: 0;
        }
        /* Quick link styles - internal links */
        .links-note-tiptap-wrapper .ProseMirror .quick-link {
          display: inline;
          padding: 2px 8px;
          background: rgba(255, 255, 255, 0.03);
          color: #a5b4fc;
          border: 1px solid rgba(165, 180, 252, 0.3);
          border-radius: 4px;
          font-size: 13px;
          font-weight: 500;
          cursor: pointer;
          text-decoration: none;
          transition: all 0.15s;
        }
        .links-note-tiptap-wrapper .ProseMirror .quick-link:hover {
          background: rgba(255, 255, 255, 0.06);
          border-color: rgba(165, 180, 252, 0.5);
        }
        /* External links - arrow icon suffix */
        /* Mark wraps decoration: <span class="quick-link"><span class="external-link">text</span></span> */
        .links-note-tiptap-wrapper .ProseMirror .quick-link .external-link::after {
          content: ' ↗';
          font-size: 11px;
          opacity: 0.7;
          margin-left: 2px;
        }
        /* Link toolbar - positioned above selection */
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
        /* Workspace picker overlay */
        .tiptap-workspace-picker-overlay {
          position: absolute;
          inset: 0;
          background: rgba(0, 0, 0, 0.5);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 20;
          border-radius: 8px;
        }
        .tiptap-workspace-picker {
          background: #1e222a;
          border: 1px solid rgba(255, 255, 255, 0.12);
          border-radius: 10px;
          width: 90%;
          max-width: 280px;
          max-height: 280px;
          overflow: hidden;
          box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
        }
        .tiptap-workspace-picker-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 10px 12px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.08);
        }
        .tiptap-workspace-picker-header span {
          font-size: 12px;
          font-weight: 600;
          color: #818cf8;
        }
        .tiptap-workspace-picker-close {
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
        .tiptap-workspace-picker-close:hover {
          background: rgba(255, 255, 255, 0.05);
          color: #c0c4d0;
        }
        .tiptap-workspace-picker-search {
          padding: 8px 10px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.08);
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .tiptap-workspace-picker-search input {
          flex: 1;
          background: transparent;
          border: none;
          font-size: 13px;
          color: #f0f0f0;
          outline: none;
        }
        .tiptap-workspace-picker-search input::placeholder {
          color: #5c6070;
        }
        .tiptap-workspace-picker-list {
          max-height: 180px;
          overflow-y: auto;
          padding: 6px;
        }
        .tiptap-workspace-picker-item {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 8px 10px;
          border-radius: 6px;
          cursor: pointer;
          transition: background 0.15s;
        }
        .tiptap-workspace-picker-item:hover {
          background: rgba(255, 255, 255, 0.05);
        }
        .tiptap-workspace-picker-item-icon {
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
        .tiptap-workspace-picker-item-name {
          font-size: 13px;
          font-weight: 500;
          color: #f0f0f0;
        }
        .tiptap-workspace-picker-item-entry {
          font-size: 11px;
          color: #5c6070;
        }
        .tiptap-workspace-picker-empty {
          padding: 20px;
          text-align: center;
          color: #5c6070;
          font-size: 13px;
        }
        .tiptap-workspace-picker-create {
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
        .tiptap-workspace-picker-create:hover:not(:disabled) {
          background: rgba(99, 102, 241, 0.2);
          border-color: rgba(99, 102, 241, 0.5);
        }
        .tiptap-workspace-picker-create:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }
        .tiptap-workspace-picker-divider {
          font-size: 10px;
          font-weight: 600;
          color: #5c6070;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          padding: 8px 10px 6px;
        }
        /* Trash FAB and popover */
        .tiptap-links-trash-fab {
          position: absolute;
          bottom: 8px;
          right: 8px;
          width: 32px;
          height: 32px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: rgba(239, 68, 68, 0.15);
          border: 1px solid rgba(239, 68, 68, 0.25);
          border-radius: 8px;
          cursor: pointer;
          color: #ef4444;
          transition: all 0.2s;
          z-index: 5;
        }
        .tiptap-links-trash-fab:hover {
          background: rgba(239, 68, 68, 0.25);
          transform: scale(1.05);
        }
        .tiptap-links-trash-fab-badge {
          position: absolute;
          top: -4px;
          right: -4px;
          min-width: 16px;
          height: 16px;
          padding: 0 4px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: #ef4444;
          border-radius: 8px;
          font-size: 10px;
          font-weight: 600;
          color: white;
        }
        .tiptap-links-trash-popover {
          position: absolute;
          bottom: 48px;
          right: 8px;
          width: 220px;
          max-height: 240px;
          background: #1e222a;
          border: 1px solid rgba(255, 255, 255, 0.12);
          border-radius: 10px;
          box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
          z-index: 15;
          overflow: hidden;
          animation: tiptapTrashPopoverIn 0.15s ease-out;
        }
        @keyframes tiptapTrashPopoverIn {
          from {
            opacity: 0;
            transform: translateY(8px) scale(0.95);
          }
          to {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }
        .tiptap-links-trash-popover-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 10px 12px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.08);
        }
        .tiptap-links-trash-popover-title {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 12px;
          font-weight: 600;
          color: #ef4444;
        }
        .tiptap-links-trash-popover-close {
          width: 20px;
          height: 20px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: transparent;
          border: none;
          border-radius: 4px;
          cursor: pointer;
          color: #5c6070;
          transition: all 0.15s;
        }
        .tiptap-links-trash-popover-close:hover {
          background: rgba(255, 255, 255, 0.08);
          color: #f0f0f0;
        }
        .tiptap-links-trash-popover-list {
          max-height: 180px;
          overflow-y: auto;
          padding: 6px;
        }
        .tiptap-links-trash-item {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 8px 10px;
          border-radius: 6px;
          transition: background 0.15s;
        }
        .tiptap-links-trash-item:hover {
          background: rgba(255, 255, 255, 0.04);
        }
        .tiptap-links-trash-item-text {
          flex: 1;
          min-width: 0;
          font-size: 12px;
          color: #c0c4d0;
        }
        .tiptap-links-trash-item-text span {
          display: block;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .tiptap-links-trash-item-time {
          font-size: 10px;
          color: #5c6070;
          white-space: nowrap;
        }
        .tiptap-links-trash-item-actions {
          display: flex;
          gap: 2px;
          opacity: 0;
          transition: opacity 0.15s;
        }
        .tiptap-links-trash-item:hover .tiptap-links-trash-item-actions {
          opacity: 1;
        }
        .tiptap-links-trash-action-btn {
          width: 22px;
          height: 22px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: transparent;
          border: none;
          border-radius: 4px;
          cursor: pointer;
          color: #5c6070;
          transition: all 0.15s;
        }
        .tiptap-links-trash-action-btn:hover {
          background: rgba(255, 255, 255, 0.08);
        }
        .tiptap-links-trash-action-btn.restore:hover {
          color: #22c55e;
          background: rgba(34, 197, 94, 0.15);
        }
        .tiptap-links-trash-action-btn.delete:hover {
          color: #ef4444;
          background: rgba(239, 68, 68, 0.15);
        }
      `}</style>

      <div ref={containerRef} className="links-note-tiptap-container">
        {/* TipTap Editor */}
        {editor && (
          <>
            <div className="links-note-tiptap-wrapper">
              <EditorContent editor={editor} />
            </div>

          </>
        )}

        {/* Link toolbar - appears on text selection (like original LinksNotePanel) */}
        {showLinkToolbar && !showPicker && (
          <div className="link-toolbar" style={{ top: Math.max(0, toolbarTop) }}>
            <button onClick={() => setShowPicker(true)}>
              <Link2 size={14} />
              Link to Workspace
            </button>
          </div>
        )}

        {/* Fixed trash icon */}
        {deletedLinks.length > 0 && (
          <button
            className="tiptap-links-trash-fab"
            onClick={() => setShowTrashPopover(!showTrashPopover)}
            title="Deleted links"
          >
            <Trash2 size={16} />
            <span className="tiptap-links-trash-fab-badge">{deletedLinks.length}</span>
          </button>
        )}

        {/* Trash popover */}
        {showTrashPopover && deletedLinks.length > 0 && (
          <div className="tiptap-links-trash-popover">
            <div className="tiptap-links-trash-popover-header">
              <div className="tiptap-links-trash-popover-title">
                <Trash2 size={14} />
                <span>Deleted Links</span>
              </div>
              <button
                className="tiptap-links-trash-popover-close"
                onClick={() => setShowTrashPopover(false)}
              >
                <X size={14} />
              </button>
            </div>
            <div className="tiptap-links-trash-popover-list">
              {deletedLinks.map((link, index) => (
                <div key={`${link.workspaceId}-${index}`} className="tiptap-links-trash-item">
                  <div className="tiptap-links-trash-item-text">
                    <span title={link.text}>{link.text}</span>
                  </div>
                  <span className="tiptap-links-trash-item-time">
                    {formatDeletedTime(link.deletedAt)}
                  </span>
                  <div className="tiptap-links-trash-item-actions">
                    <button
                      className="tiptap-links-trash-action-btn restore"
                      onClick={() => handleRestoreLink(link)}
                      title="Restore link"
                    >
                      <RotateCcw size={12} />
                    </button>
                    <button
                      className="tiptap-links-trash-action-btn delete"
                      onClick={() => handlePermanentDelete(link)}
                      title="Delete permanently"
                    >
                      <X size={12} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Workspace picker overlay */}
        {showPicker && (
          <div className="tiptap-workspace-picker-overlay" onClick={closePicker}>
            <div className="tiptap-workspace-picker" onClick={(e) => e.stopPropagation()}>
              <div className="tiptap-workspace-picker-header">
                <span>Link to Workspace</span>
                <button className="tiptap-workspace-picker-close" onClick={closePicker}>
                  <X size={14} />
                </button>
              </div>
              <div className="tiptap-workspace-picker-search">
                <Search size={14} style={{ color: '#5c6070', flexShrink: 0 }} />
                <input
                  ref={searchInputRef}
                  type="text"
                  placeholder="Search workspaces..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
              {/* Entry filter toggle */}
              <div style={{ display: 'flex', gap: '8px', padding: '8px 12px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                <button
                  onClick={() => setFilterByEntry(true)}
                  style={{
                    padding: '4px 8px',
                    fontSize: '11px',
                    borderRadius: '4px',
                    border: filterByEntry ? '1px solid rgba(99, 102, 241, 0.3)' : '1px solid transparent',
                    background: filterByEntry ? 'rgba(99, 102, 241, 0.2)' : 'transparent',
                    color: filterByEntry ? '#818cf8' : '#8b8fa3',
                    cursor: 'pointer',
                  }}
                >
                  Current Entry
                </button>
                <button
                  onClick={() => setFilterByEntry(false)}
                  style={{
                    padding: '4px 8px',
                    fontSize: '11px',
                    borderRadius: '4px',
                    border: !filterByEntry ? '1px solid rgba(99, 102, 241, 0.3)' : '1px solid transparent',
                    background: !filterByEntry ? 'rgba(99, 102, 241, 0.2)' : 'transparent',
                    color: !filterByEntry ? '#818cf8' : '#8b8fa3',
                    cursor: 'pointer',
                  }}
                >
                  All Entries
                </button>
              </div>
              <div className="tiptap-workspace-picker-list">
                {/* Create new workspace button */}
                <button
                  className="tiptap-workspace-picker-create"
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
                  <div className="tiptap-workspace-picker-empty">Searching...</div>
                ) : workspaces.length === 0 ? (
                  <div className="tiptap-workspace-picker-empty">No existing workspaces</div>
                ) : (
                  <>
                    <div className="tiptap-workspace-picker-divider">Or link to existing:</div>
                    {workspaces.map((ws) => (
                      <div
                        key={ws.id}
                        className="tiptap-workspace-picker-item"
                        onClick={() => createLink(ws)}
                      >
                        <div className="tiptap-workspace-picker-item-icon">
                          {ws.name.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <div className="tiptap-workspace-picker-item-name">{ws.name}</div>
                          <div className="tiptap-workspace-picker-item-entry">{ws.entryName}</div>
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
