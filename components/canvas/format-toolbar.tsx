"use client"

import { useState, useRef, useEffect } from "react"
import { createPortal } from "react-dom"
import type { TiptapEditorPlainHandle } from "./tiptap-editor-plain"
import type { TiptapEditorHandle } from "./tiptap-editor-collab"
import type { CollapsibleSelectionSnapshot } from "@/lib/extensions/collapsible-block-selection"
import { debugLog } from "@/lib/debug-logger"

type UnifiedEditorHandle = TiptapEditorHandle | TiptapEditorPlainHandle

// Keyboard shortcut mappings
const SHORTCUTS: Record<string, string> = {
  bold: 'Mod+B',
  italic: 'Mod+I',
  underline: 'Mod+U',
  heading2: 'Mod+Alt+2',
  heading3: 'Mod+Alt+3',
  bulletList: 'Mod+Shift+8',
  orderedList: 'Mod+Shift+7',
  blockquote: 'Mod+Shift+B',
  highlight: 'Mod+Shift+H',
  collapsibleBlock: 'Mod+Shift+C',
  removeFormat: 'Mod+\\',
}

// Helper to format shortcuts for display (⌘ on Mac, Ctrl on Windows/Linux)
const formatShortcut = (shortcut: string): string => {
  const isMac = typeof window !== 'undefined' && /Mac|iPhone|iPod|iPad/i.test(navigator.platform)
  return shortcut
    .replace('Mod', isMac ? '⌘' : 'Ctrl')
    .replace('Alt', isMac ? '⌥' : 'Alt')
    .replace('Shift', isMac ? '⇧' : 'Shift')
    .replace('+', isMac ? '' : '+')
}

interface FormatToolbarProps {
  editorRef: React.RefObject<UnifiedEditorHandle | null>
  panelId: string
  hoverDelayMs?: number
  collapsibleSelection?: CollapsibleSelectionSnapshot | null
}

export function FormatToolbar({ editorRef, panelId, hoverDelayMs = 300, collapsibleSelection }: FormatToolbarProps) {
  const [isVisible, setIsVisible] = useState(false) // Start hidden
  const [dropdownPosition, setDropdownPosition] = useState({ top: 0, left: 0 })
  const timeoutRef = useRef<NodeJS.Timeout | undefined>(undefined)
  const showTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const blockSelection = collapsibleSelection?.blocks ?? []
  const selectedBlockCount = blockSelection.length
  const hasBlockSelection = selectedBlockCount > 0
  const allCollapsed = hasBlockSelection && blockSelection.every(block => Boolean(block.attrs?.collapsed))
  const allExpanded = hasBlockSelection && blockSelection.every(block => !block.attrs?.collapsed)

  const executeCommand = (command: string, value?: any) => {
    if (!editorRef.current) return
    editorRef.current.executeCommand(command, value)
  }

  const updateDropdownPosition = () => {
    if (buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect()
      const newPosition = {
        top: rect.bottom + 4,
        left: Math.max(10, rect.right - 250) // Ensure it doesn't go off the left edge
      }
      debugLog('FormatToolbar', 'updateDropdownPosition', {
        panelId,
        metadata: {
          buttonRect: { top: rect.top, left: rect.left, right: rect.right, bottom: rect.bottom },
          dropdownPosition: newPosition
        }
      })
      setDropdownPosition(newPosition)
    } else {
      debugLog('FormatToolbar', 'updateDropdownPosition-failed', {
        panelId,
        metadata: {
          buttonRefNull: true
        }
      })
    }
  }

  const handleMouseEnter = () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
    }
    if (showTimeoutRef.current) {
      clearTimeout(showTimeoutRef.current)
      showTimeoutRef.current = null
    }

    if (isVisible) {
      updateDropdownPosition()
      const dropdownImmediate = document.getElementById(`format-toolbar-dropdown-${panelId}`)
      if (dropdownImmediate) {
        dropdownImmediate.style.display = "grid"
        dropdownImmediate.style.opacity = "1"
        dropdownImmediate.style.pointerEvents = "auto"
      }
      return
    }

    showTimeoutRef.current = setTimeout(() => {
      updateDropdownPosition()
      setIsVisible(true)
      const dropdown = document.getElementById(`format-toolbar-dropdown-${panelId}`)
      if (dropdown) {
        dropdown.style.display = "grid"
        dropdown.style.opacity = "1"
        dropdown.style.pointerEvents = "auto"
      }
      showTimeoutRef.current = null
    }, hoverDelayMs)
  }

  const handleMouseLeave = () => {
    if (showTimeoutRef.current) {
      clearTimeout(showTimeoutRef.current)
      showTimeoutRef.current = null
    }
    timeoutRef.current = setTimeout(() => {
      const dropdown = document.getElementById(`format-toolbar-dropdown-${panelId}`)
      // Only hide if not hovering over the dropdown
      if (dropdown && !dropdown.matches(':hover')) {
        setIsVisible(false)
        dropdown.style.display = "none"
        dropdown.style.opacity = "0"
        dropdown.style.pointerEvents = "none"
      }
    }, hoverDelayMs)
  }

  useEffect(() => {
    // Update position on mount
    updateDropdownPosition()
    
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }
      if (showTimeoutRef.current) {
        clearTimeout(showTimeoutRef.current)
      }
    }
  }, [])

  return (
    <div 
      className="format-toolbar-container" 
      style={{ position: "relative", display: "inline-block" }}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <button
        ref={buttonRef}
        className="format-toolbar-trigger"
        onClick={(e) => {
          e.stopPropagation()
          if (showTimeoutRef.current) {
            clearTimeout(showTimeoutRef.current)
            showTimeoutRef.current = null
          }
          const dropdown = document.getElementById(`format-toolbar-dropdown-${panelId}`)

          debugLog('FormatToolbar', 'buttonClick', {
            panelId,
            metadata: {
              currentVisibility: isVisible,
              dropdownFound: !!dropdown,
              dropdownId: `format-toolbar-dropdown-${panelId}`
            }
          })
          
          if (!isVisible) {
            updateDropdownPosition()
            setIsVisible(true)
            // Also manipulate via DOM for immediate effect
            if (dropdown) {
              dropdown.style.display = "grid"
              dropdown.style.opacity = "1"
              dropdown.style.pointerEvents = "auto"
              debugLog('FormatToolbar', 'showDropdown', { panelId })
            }
          } else {
            setIsVisible(false)
            if (dropdown) {
              dropdown.style.display = "none"
              dropdown.style.opacity = "0"
              dropdown.style.pointerEvents = "none"
              debugLog('FormatToolbar', 'hideDropdown', { panelId })
            }
          }
        }}
        title="Text Formatting"
        style={{
          background: "rgba(255,255,255,0.2)",
          border: "none",
          borderRadius: "4px",
          padding: "4px 8px",
          cursor: "pointer",
          fontSize: "11px",
          color: "white",
          transition: "all 0.2s ease",
          display: "flex",
          alignItems: "center",
          gap: "4px",
          height: "24px",
        }}
        onMouseOver={(e) => {
          e.currentTarget.style.background = "rgba(255,255,255,0.3)"
        }}
        onMouseOut={(e) => {
          e.currentTarget.style.background = "rgba(255,255,255,0.2)"
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
        </svg>
        <span>Format</span>
      </button>

      {typeof window !== 'undefined' && createPortal(
        <div
          id={`format-toolbar-dropdown-${panelId}`}
        className="format-toolbar-dropdown"
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        style={{
          position: "fixed",
          top: `${dropdownPosition.top}px`,
          left: `${dropdownPosition.left}px`,
          background: "#e8eaed",
          border: "1px solid #dadce0",
          borderRadius: "12px",
          padding: "8px",
          boxShadow: "0 2px 10px rgba(0,0,0,0.2)",
          zIndex: 99999,
          display: isVisible ? "grid" : "none",
          gridTemplateColumns: "repeat(5, 1fr)",
          gap: "6px",
          minWidth: "250px",
          opacity: isVisible ? 1 : 0,
          pointerEvents: isVisible ? "auto" : "none",
        }}
        >
          {/* First row */}
          <button
            onClick={() => { executeCommand("bold"); setIsVisible(false) }}
            title={`Bold (${formatShortcut(SHORTCUTS.bold)})`}
            style={{
              background: "white",
              border: "1px solid #dadce0",
              borderRadius: "8px",
              width: "42px",
              height: "42px",
              cursor: "pointer",
              transition: "all 0.15s ease",
              color: "#202124",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              position: "relative",
              padding: "4px",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "#f1f3f4"
              e.currentTarget.style.borderColor = "#5f6368"
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "white"
              e.currentTarget.style.borderColor = "#dadce0"
            }}
          >
            <span style={{ fontSize: "16px", fontWeight: "bold" }}>B</span>
            <span style={{ fontSize: "9px", color: "#5f6368", marginTop: "2px" }}>
              {formatShortcut(SHORTCUTS.bold)}
            </span>
          </button>
          
          <button
            onClick={() => { executeCommand("italic"); setIsVisible(false) }}
            title={`Italic (${formatShortcut(SHORTCUTS.italic)})`}
            style={{
              background: "white",
              border: "1px solid #dadce0",
              borderRadius: "8px",
              width: "42px",
              height: "42px",
              cursor: "pointer",
              transition: "all 0.15s ease",
              color: "#202124",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              padding: "4px",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "#f1f3f4"
              e.currentTarget.style.borderColor = "#5f6368"
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "white"
              e.currentTarget.style.borderColor = "#dadce0"
            }}
          >
            <span style={{ fontSize: "16px", fontStyle: "italic", fontFamily: "serif" }}>I</span>
            <span style={{ fontSize: "9px", color: "#5f6368", marginTop: "2px" }}>
              {formatShortcut(SHORTCUTS.italic)}
            </span>
          </button>

          <button
            onClick={() => { executeCommand("underline"); setIsVisible(false) }}
            title={`Underline (${formatShortcut(SHORTCUTS.underline)})`}
            style={{
              background: "white",
              border: "1px solid #dadce0",
              borderRadius: "8px",
              width: "42px",
              height: "42px",
              cursor: "pointer",
              transition: "all 0.15s ease",
              color: "#202124",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              padding: "4px",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "#f1f3f4"
              e.currentTarget.style.borderColor = "#5f6368"
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "white"
              e.currentTarget.style.borderColor = "#dadce0"
            }}
          >
            <span style={{ fontSize: "16px", textDecoration: "underline" }}>U</span>
            <span style={{ fontSize: "9px", color: "#5f6368", marginTop: "2px" }}>
              {formatShortcut(SHORTCUTS.underline)}
            </span>
          </button>

          <button
            onClick={() => { executeCommand("heading", 2); setIsVisible(false) }}
            title={`Heading 2 (${formatShortcut(SHORTCUTS.heading2)})`}
            style={{
              background: "white",
              border: "1px solid #dadce0",
              borderRadius: "8px",
              width: "42px",
              height: "42px",
              cursor: "pointer",
              transition: "all 0.15s ease",
              color: "#202124",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              padding: "4px",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "#f1f3f4"
              e.currentTarget.style.borderColor = "#5f6368"
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "white"
              e.currentTarget.style.borderColor = "#dadce0"
            }}
          >
            <span style={{ fontSize: "13px", fontWeight: "600" }}>H2</span>
            <span style={{ fontSize: "8px", color: "#5f6368", marginTop: "1px" }}>
              {formatShortcut(SHORTCUTS.heading2)}
            </span>
          </button>

          <button
            onClick={() => { executeCommand("heading", 3); setIsVisible(false) }}
            title={`Heading 3 (${formatShortcut(SHORTCUTS.heading3)})`}
            style={{
              background: "white",
              border: "1px solid #dadce0",
              borderRadius: "8px",
              width: "42px",
              height: "42px",
              cursor: "pointer",
              transition: "all 0.15s ease",
              color: "#202124",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              padding: "4px",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "#f1f3f4"
              e.currentTarget.style.borderColor = "#5f6368"
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "white"
              e.currentTarget.style.borderColor = "#dadce0"
            }}
          >
            <span style={{ fontSize: "13px", fontWeight: "600" }}>H3</span>
            <span style={{ fontSize: "8px", color: "#5f6368", marginTop: "1px" }}>
              {formatShortcut(SHORTCUTS.heading3)}
            </span>
          </button>

          {/* Second row */}
          <button
            onClick={() => { executeCommand("bulletList"); setIsVisible(false) }}
            title={`Bullet List (${formatShortcut(SHORTCUTS.bulletList)})`}
            style={{
              background: "white",
              border: "1px solid #dadce0",
              borderRadius: "8px",
              width: "42px",
              height: "42px",
              cursor: "pointer",
              transition: "all 0.15s ease",
              color: "#202124",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              padding: "4px",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "#f1f3f4"
              e.currentTarget.style.borderColor = "#5f6368"
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "white"
              e.currentTarget.style.borderColor = "#dadce0"
            }}
          >
            <span style={{ fontSize: "18px" }}>•</span>
            <span style={{ fontSize: "8px", color: "#5f6368", marginTop: "1px" }}>
              {formatShortcut(SHORTCUTS.bulletList)}
            </span>
          </button>

          <button
            onClick={() => { executeCommand("orderedList"); setIsVisible(false) }}
            title={`Numbered List (${formatShortcut(SHORTCUTS.orderedList)})`}
            style={{
              background: "white",
              border: "1px solid #dadce0",
              borderRadius: "8px",
              width: "42px",
              height: "42px",
              cursor: "pointer",
              transition: "all 0.15s ease",
              color: "#202124",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              padding: "4px",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "#f1f3f4"
              e.currentTarget.style.borderColor = "#5f6368"
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "white"
              e.currentTarget.style.borderColor = "#dadce0"
            }}
          >
            <span style={{ fontSize: "13px" }}>1.</span>
            <span style={{ fontSize: "8px", color: "#5f6368", marginTop: "1px" }}>
              {formatShortcut(SHORTCUTS.orderedList)}
            </span>
          </button>

          <button
            onClick={() => { executeCommand("blockquote"); setIsVisible(false) }}
            title={`Quote (${formatShortcut(SHORTCUTS.blockquote)})`}
            style={{
              background: "white",
              border: "1px solid #dadce0",
              borderRadius: "8px",
              width: "42px",
              height: "42px",
              cursor: "pointer",
              transition: "all 0.15s ease",
              color: "#202124",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              padding: "4px",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "#f1f3f4"
              e.currentTarget.style.borderColor = "#5f6368"
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "white"
              e.currentTarget.style.borderColor = "#dadce0"
            }}
          >
            <span style={{ fontSize: "18px", fontWeight: "500" }}>"</span>
            <span style={{ fontSize: "8px", color: "#5f6368", marginTop: "1px" }}>
              {formatShortcut(SHORTCUTS.blockquote)}
            </span>
          </button>

          <button
            onClick={() => { executeCommand("highlight"); setIsVisible(false) }}
            title={`Highlight (${formatShortcut(SHORTCUTS.highlight)})`}
            style={{
              background: "white",
              border: "1px solid #dadce0",
              borderRadius: "8px",
              width: "42px",
              height: "42px",
              cursor: "pointer",
              transition: "all 0.15s ease",
              color: "#202124",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              padding: "4px",
              gap: "2px",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "#f1f3f4"
              e.currentTarget.style.borderColor = "#5f6368"
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "white"
              e.currentTarget.style.borderColor = "#dadce0"
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#ea4335" strokeWidth="2">
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
            </svg>
            <span style={{ fontSize: "8px", color: "#5f6368" }}>
              {formatShortcut(SHORTCUTS.highlight)}
            </span>
          </button>

          <button
            onClick={() => { executeCommand("collapsibleBlock"); setIsVisible(false) }}
            title={`Block Based (${formatShortcut(SHORTCUTS.collapsibleBlock)})`}
            style={{
              background: "white",
              border: "1px solid #dadce0",
              borderRadius: "8px",
              width: "42px",
              height: "42px",
              cursor: "pointer",
              transition: "all 0.15s ease",
              color: "#202124",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              padding: "4px",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "#f1f3f4"
              e.currentTarget.style.borderColor = "#5f6368"
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "white"
              e.currentTarget.style.borderColor = "#dadce0"
            }}
          >
            <span style={{ fontSize: "18px" }}>▦</span>
            <span style={{ fontSize: "8px", color: "#5f6368", marginTop: "1px" }}>
              {formatShortcut(SHORTCUTS.collapsibleBlock)}
            </span>
          </button>

          {/* Third row - only Clear Format */}
          <button
            onClick={() => { executeCommand("removeFormat"); setIsVisible(false) }}
            title={`Clear Format (${formatShortcut(SHORTCUTS.removeFormat)})`}
            style={{
              background: "white",
              border: "1px solid #dadce0",
              borderRadius: "8px",
              width: "42px",
              height: "42px",
              cursor: "pointer",
              transition: "all 0.15s ease",
              color: "#202124",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              padding: "4px",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "#f1f3f4"
              e.currentTarget.style.borderColor = "#5f6368"
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "white"
              e.currentTarget.style.borderColor = "#dadce0"
            }}
          >
            <span style={{ fontSize: "18px" }}>✕</span>
            <span style={{ fontSize: "9px", color: "#5f6368", marginTop: "2px" }}>
              {formatShortcut(SHORTCUTS.removeFormat)}
            </span>
          </button>

          {hasBlockSelection && (
            <>
              <div
                style={{
                  gridColumn: "1 / -1",
                  marginTop: "6px",
                  fontSize: "11px",
                  fontWeight: 600,
                  color: "#5f6368",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  letterSpacing: "0.01em",
                }}
              >
                <span>Block actions</span>
                <span style={{ fontWeight: 500 }}>{selectedBlockCount} selected</span>
              </div>

              <div
                style={{
                  gridColumn: "1 / -1",
                  display: "flex",
                  gap: "6px",
                }}
              >
                <button
                  onClick={() => { executeCommand("collapsible:collapse"); setIsVisible(false) }}
                  disabled={allCollapsed}
                  style={{
                    flex: 1,
                    background: allCollapsed ? "#f1f3f4" : "white",
                    border: "1px solid #dadce0",
                    borderRadius: "8px",
                    height: "36px",
                    cursor: allCollapsed ? "not-allowed" : "pointer",
                    transition: "all 0.15s ease",
                    fontSize: "12px",
                    fontWeight: 600,
                    color: allCollapsed ? "#9aa0a6" : "#202124",
                  }}
                  onMouseEnter={(e) => {
                    if (allCollapsed) return
                    e.currentTarget.style.background = "#f1f3f4"
                    e.currentTarget.style.borderColor = "#5f6368"
                  }}
                  onMouseLeave={(e) => {
                    if (allCollapsed) return
                    e.currentTarget.style.background = "white"
                    e.currentTarget.style.borderColor = "#dadce0"
                  }}
                >
                  Collapse
                </button>

                <button
                  onClick={() => { executeCommand("collapsible:expand"); setIsVisible(false) }}
                  disabled={allExpanded}
                  style={{
                    flex: 1,
                    background: allExpanded ? "#f1f3f4" : "white",
                    border: "1px solid #dadce0",
                    borderRadius: "8px",
                    height: "36px",
                    cursor: allExpanded ? "not-allowed" : "pointer",
                    transition: "all 0.15s ease",
                    fontSize: "12px",
                    fontWeight: 600,
                    color: allExpanded ? "#9aa0a6" : "#202124",
                  }}
                  onMouseEnter={(e) => {
                    if (allExpanded) return
                    e.currentTarget.style.background = "#f1f3f4"
                    e.currentTarget.style.borderColor = "#5f6368"
                  }}
                  onMouseLeave={(e) => {
                    if (allExpanded) return
                    e.currentTarget.style.background = "white"
                    e.currentTarget.style.borderColor = "#dadce0"
                  }}
                >
                  Expand
                </button>

                <button
                  onClick={() => { executeCommand("collapsible:delete"); setIsVisible(false) }}
                  style={{
                    flex: 1,
                    background: "#ffecec",
                    border: "1px solid #f28b82",
                    borderRadius: "8px",
                    height: "36px",
                    cursor: "pointer",
                    transition: "all 0.15s ease",
                    fontSize: "12px",
                    fontWeight: 600,
                    color: "#b00020",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = "#fce8e6"
                    e.currentTarget.style.borderColor = "#d93025"
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = "#ffecec"
                    e.currentTarget.style.borderColor = "#f28b82"
                  }}
                >
                  Delete
                </button>
              </div>

              <button
                onClick={() => { executeCommand("collapsible:clearSelection"); setIsVisible(false) }}
                style={{
                  gridColumn: "1 / -1",
                  background: "transparent",
                  border: "none",
                  color: "#5f6368",
                  cursor: "pointer",
                  fontSize: "12px",
                  fontWeight: 500,
                  textAlign: "right",
                  padding: "4px 2px 2px",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.color = "#1a73e8"
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.color = "#5f6368"
                }}
              >
                Clear selection
              </button>
            </>
          )}
        </div>,
        document.body
      )}
    </div>
  )
}
