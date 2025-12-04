"use client"

/**
 * Links Note Panel Component
 * Part of Dashboard Implementation - Phase 2.2e
 *
 * A note panel with workspace linking support:
 * - [[workspace:Name]] syntax for workspace links
 * - Cmd/Ctrl+K highlight-to-link UI
 * - Clickable workspace links that navigate to the workspace
 */

import React, { useState, useCallback, useRef, useEffect } from 'react'
import { Link, ExternalLink } from 'lucide-react'
import { BaseDashboardPanel } from './BaseDashboardPanel'
import { WorkspaceLinkPicker, useWorkspaceLinkPicker, type WorkspaceOption } from '../WorkspaceLinkPicker'
import { getPanelType, type BasePanelProps } from '@/lib/dashboard/panel-registry'
import { cn } from '@/lib/utils'

// Regex to match [[workspace:WorkspaceName]] or [[WorkspaceName]] links
const WORKSPACE_LINK_REGEX = /\[\[(?:workspace:)?([^\]]+)\]\]/g

interface ParsedContent {
  type: 'text' | 'link'
  content: string
  workspaceName?: string
}

/**
 * Parse content and extract workspace links
 */
function parseContent(content: string): ParsedContent[] {
  const parts: ParsedContent[] = []
  let lastIndex = 0

  content.replace(WORKSPACE_LINK_REGEX, (match, workspaceName, offset) => {
    // Add text before the link
    if (offset > lastIndex) {
      parts.push({
        type: 'text',
        content: content.slice(lastIndex, offset),
      })
    }

    // Add the link
    parts.push({
      type: 'link',
      content: match,
      workspaceName: workspaceName.trim(),
    })

    lastIndex = offset + match.length
    return match
  })

  // Add remaining text
  if (lastIndex < content.length) {
    parts.push({
      type: 'text',
      content: content.slice(lastIndex),
    })
  }

  return parts
}

/**
 * Render content with clickable workspace links
 */
function RichContent({
  content,
  onLinkClick,
}: {
  content: string
  onLinkClick: (workspaceName: string) => void
}) {
  const parts = parseContent(content)

  // Handle HTML content (from seeded panels)
  if (content.includes('<') && content.includes('>')) {
    return (
      <div
        className="prose prose-sm prose-invert max-w-none"
        style={{ color: '#f0f0f0' }}
        dangerouslySetInnerHTML={{ __html: content }}
      />
    )
  }

  return (
    <div className="whitespace-pre-wrap" style={{ color: '#f0f0f0', fontSize: 13, lineHeight: 1.6 }}>
      {parts.map((part, index) => {
        if (part.type === 'link' && part.workspaceName) {
          return (
            <button
              key={index}
              onClick={() => onLinkClick(part.workspaceName!)}
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded transition-colors"
              style={{
                background: 'rgba(99, 102, 241, 0.2)',
                color: '#818cf8',
                border: 'none',
                cursor: 'pointer',
              }}
              title={`Go to ${part.workspaceName}`}
            >
              <Link size={12} />
              <span>{part.workspaceName}</span>
            </button>
          )
        }
        return <span key={index}>{part.content}</span>
      })}
    </div>
  )
}

export function LinksNotePanel({
  panel,
  onClose,
  onConfigChange,
  onNavigate,
  isActive,
}: BasePanelProps) {
  const panelDef = getPanelType('links_note')
  const [isEditing, setIsEditing] = useState(false)
  const [content, setContent] = useState(panel.config.content || '')
  const [selection, setSelection] = useState<{ start: number; end: number; text: string } | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const linkPicker = useWorkspaceLinkPicker()

  // Sync content from panel config
  useEffect(() => {
    setContent(panel.config.content || '')
  }, [panel.config.content])

  // Handle workspace link click - navigate to workspace
  const handleLinkClick = useCallback(async (workspaceName: string) => {
    try {
      // Search for workspace by name
      const response = await fetch(`/api/dashboard/workspaces/search?q=${encodeURIComponent(workspaceName)}`)
      if (response.ok) {
        const data = await response.json()
        const workspaces = data.workspaces || []

        // Find exact match or first result
        const workspace = workspaces.find(
          (ws: WorkspaceOption) => ws.name.toLowerCase() === workspaceName.toLowerCase()
        ) || workspaces[0]

        if (workspace && onNavigate) {
          onNavigate(workspace.entryId || '', workspace.id)
        }
      }
    } catch (err) {
      console.error('[LinksNotePanel] Failed to navigate to workspace:', err)
    }
  }, [onNavigate])

  // Handle Cmd/Ctrl+K for highlight-to-link
  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault()

      const textarea = textareaRef.current
      if (!textarea) return

      const start = textarea.selectionStart
      const end = textarea.selectionEnd
      const selectedText = content.slice(start, end)

      if (selectedText.trim()) {
        // Get position for picker
        const rect = textarea.getBoundingClientRect()

        setSelection({ start, end, text: selectedText })
        linkPicker.open({
          position: { x: rect.left, y: rect.bottom },
          selectedText,
          onSelect: (workspace) => {
            // Insert workspace link
            const linkSyntax = `[[workspace:${workspace.name}]]`
            const newContent = content.slice(0, start) + linkSyntax + content.slice(end)
            setContent(newContent)
            onConfigChange?.({ content: newContent })
            setSelection(null)
          },
        })
      }
    }
  }, [content, linkPicker, onConfigChange])

  // Save content on blur
  const handleBlur = useCallback(() => {
    if (content !== panel.config.content) {
      onConfigChange?.({ content })
    }
    setIsEditing(false)
  }, [content, panel.config.content, onConfigChange])

  // Header actions
  const headerActions = (
    <button
      onClick={() => setIsEditing(!isEditing)}
      title={isEditing ? 'View mode' : 'Edit mode'}
      style={{
        width: 24,
        height: 24,
        background: isEditing ? 'rgba(99, 102, 241, 0.2)' : 'transparent',
        border: 'none',
        borderRadius: 4,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        color: isEditing ? '#6366f1' : '#5c6070',
      }}
    >
      {isEditing ? <ExternalLink size={14} /> : <Link size={14} />}
    </button>
  )

  if (!panelDef) {
    return (
      <div
        className="flex items-center justify-center h-full"
        style={{ background: '#1e222a', color: '#ef4444' }}
      >
        <p style={{ fontSize: 12 }}>Unknown panel type</p>
      </div>
    )
  }

  return (
    <>
      <BaseDashboardPanel
        panel={panel}
        panelDef={panelDef}
        onClose={onClose}
        isActive={isActive}
        headerActions={headerActions}
      >
        {isEditing ? (
          <div className="h-full flex flex-col">
            <textarea
              ref={textareaRef}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              onKeyDown={handleKeyDown}
              onBlur={handleBlur}
              placeholder="Add links to workspaces...&#10;&#10;Use [[workspace:Name]] syntax or select text and press Cmd+K"
              className="flex-1 resize-none"
              style={{
                width: '100%',
                background: 'transparent',
                border: 'none',
                color: '#f0f0f0',
                fontSize: 13,
                lineHeight: 1.6,
                outline: 'none',
              }}
              autoFocus
            />
            <div
              className="flex items-center gap-2 pt-2 mt-2"
              style={{
                borderTop: '1px solid rgba(255, 255, 255, 0.08)',
                fontSize: 11,
                color: '#5c6070',
              }}
            >
              <kbd
                style={{
                  padding: '2px 6px',
                  borderRadius: 4,
                  background: 'rgba(255, 255, 255, 0.05)',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                }}
              >
                ⌘K
              </kbd>
              <span>Link selected text</span>
            </div>
          </div>
        ) : content ? (
          <RichContent content={content} onLinkClick={handleLinkClick} />
        ) : (
          <div
            className="h-full flex flex-col items-center justify-center text-center cursor-pointer"
            style={{ color: '#5c6070' }}
            onClick={() => setIsEditing(true)}
          >
            <Link size={24} style={{ opacity: 0.5, marginBottom: 8 }} />
            <p style={{ fontSize: 12 }}>Click to add workspace links</p>
            <p style={{ fontSize: 11, marginTop: 4 }}>
              Use [[workspace:Name]] syntax
            </p>
          </div>
        )}
      </BaseDashboardPanel>

      {/* Workspace link picker modal */}
      <WorkspaceLinkPicker
        isOpen={linkPicker.isOpen}
        onClose={linkPicker.close}
        onSelect={linkPicker.onSelect}
        position={linkPicker.position}
        selectedText={linkPicker.selectedText}
      />
    </>
  )
}
