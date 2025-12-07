"use client"

/**
 * Base Dashboard Panel Component
 * Part of Dashboard Implementation - Phase 2.2
 *
 * Provides a consistent wrapper for all dashboard panel types.
 * Handles common functionality: header, close button, drag handle area.
 * Supports editable title feature for panels that enable it.
 */

import React, { useState, useRef, useEffect, useCallback } from 'react'
import { X, Pencil, Check, MoreVertical, Trash2, EyeOff } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { BasePanelProps, PanelTypeDefinition } from '@/lib/dashboard/panel-registry'

// Custom menu item for the dropdown
export interface CustomMenuItem {
  id: string
  label: string
  icon: React.ReactNode
  onClick: () => void
  color?: string // Optional custom text color
  badge?: number | string // Optional badge (e.g., count)
}

export interface BaseDashboardPanelProps extends BasePanelProps {
  panelDef: PanelTypeDefinition
  children: React.ReactNode
  className?: string
  headerClassName?: string
  contentClassName?: string
  showCloseButton?: boolean
  headerActions?: React.ReactNode
  /** Callback when title is changed */
  onTitleChange?: (newTitle: string) => void
  /** Whether title is editable (default: false) */
  titleEditable?: boolean
  /** Optional badge to display before the title (e.g., "A", "B") */
  badge?: string | null
  /** Callback when panel is deleted (moved to trash) */
  onDelete?: () => void
  /** Custom menu items to add to the dropdown */
  customMenuItems?: CustomMenuItem[]
}

export function BaseDashboardPanel({
  panel,
  panelDef,
  onClose,
  isActive,
  children,
  className,
  headerClassName,
  contentClassName,
  showCloseButton = true,
  headerActions,
  onTitleChange,
  titleEditable = false,
  badge,
  onDelete,
  customMenuItems,
}: BaseDashboardPanelProps) {
  const [isEditingTitle, setIsEditingTitle] = useState(false)
  const [editedTitle, setEditedTitle] = useState(panel.title || panelDef.name)
  const [showMenu, setShowMenu] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  // Update local state when panel title changes externally
  useEffect(() => {
    setEditedTitle(panel.title || panelDef.name)
  }, [panel.title, panelDef.name])

  // Focus input when entering edit mode
  useEffect(() => {
    if (isEditingTitle && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [isEditingTitle])

  // Close menu when clicking outside
  useEffect(() => {
    if (!showMenu) return

    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowMenu(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showMenu])

  const handleStartEdit = useCallback((e: React.MouseEvent) => {
    e.stopPropagation() // Prevent drag
    if (titleEditable && onTitleChange) {
      setIsEditingTitle(true)
    }
  }, [titleEditable, onTitleChange])

  const handleSaveTitle = useCallback(() => {
    const trimmedTitle = editedTitle.trim()
    if (trimmedTitle && trimmedTitle !== (panel.title || panelDef.name)) {
      onTitleChange?.(trimmedTitle)
    } else {
      // Reset to original if empty or unchanged
      setEditedTitle(panel.title || panelDef.name)
    }
    setIsEditingTitle(false)
  }, [editedTitle, panel.title, panelDef.name, onTitleChange])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleSaveTitle()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      setEditedTitle(panel.title || panelDef.name)
      setIsEditingTitle(false)
    }
  }, [handleSaveTitle, panel.title, panelDef.name])

  const handleInputMouseDown = useCallback((e: React.MouseEvent) => {
    e.stopPropagation() // Prevent drag while editing
  }, [])

  // Edit button for header actions (shown when titleEditable is true)
  const editButton = titleEditable && onTitleChange && !isEditingTitle ? (
    <button
      onClick={handleStartEdit}
      onMouseDown={(e) => e.stopPropagation()}
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
        transition: 'all 0.15s ease',
      }}
      title="Edit title"
      onMouseEnter={(e) => {
        e.currentTarget.style.background = 'rgba(99, 102, 241, 0.15)'
        e.currentTarget.style.color = '#818cf8'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'transparent'
        e.currentTarget.style.color = '#5c6070'
      }}
    >
      <Pencil size={12} />
    </button>
  ) : null

  return (
    <div
      className={cn('flex flex-col overflow-hidden h-full', className)}
      style={{
        background: '#1e222a',
        border: '1px solid rgba(255, 255, 255, 0.1)',
        borderRadius: 12,
        boxShadow: '0 4px 24px rgba(0, 0, 0, 0.4)',
        ...(isActive ? { boxShadow: '0 4px 24px rgba(0, 0, 0, 0.4), 0 0 0 2px rgba(99, 102, 241, 0.3)' } : {}),
      }}
    >
      {/* Header - acts as drag handle */}
      <div
        className={cn('flex items-center justify-between cursor-grab select-none', headerClassName)}
        style={{
          padding: '10px 14px',
          borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
          borderRadius: '12px 12px 0 0',
        }}
      >
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {/* Badge (e.g., "A", "B") for links_note panels */}
          {badge && (
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 20,
                height: 20,
                background: 'rgba(99, 102, 241, 0.2)',
                color: '#818cf8',
                fontSize: 11,
                fontWeight: 700,
                borderRadius: 4,
                flexShrink: 0,
              }}
              title={`Panel ${badge}`}
            >
              {badge}
            </span>
          )}
          <span style={{ fontSize: 14, opacity: 0.8 }} aria-hidden="true">
            {panelDef.icon}
          </span>

          {isEditingTitle ? (
            // Edit mode - input field
            <div className="flex items-center gap-1 flex-1 min-w-0">
              <input
                ref={inputRef}
                type="text"
                value={editedTitle}
                onChange={(e) => setEditedTitle(e.target.value)}
                onBlur={handleSaveTitle}
                onKeyDown={handleKeyDown}
                onMouseDown={handleInputMouseDown}
                style={{
                  flex: 1,
                  minWidth: 0,
                  fontSize: 13,
                  fontWeight: 600,
                  color: '#f0f0f0',
                  background: 'rgba(255, 255, 255, 0.08)',
                  border: '1px solid rgba(99, 102, 241, 0.5)',
                  borderRadius: 4,
                  padding: '2px 6px',
                  outline: 'none',
                }}
              />
              <button
                onClick={handleSaveTitle}
                onMouseDown={(e) => e.stopPropagation()}
                style={{
                  width: 20,
                  height: 20,
                  background: 'rgba(99, 102, 241, 0.2)',
                  border: 'none',
                  borderRadius: 4,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  color: '#818cf8',
                  flexShrink: 0,
                }}
                title="Save"
              >
                <Check size={12} />
              </button>
            </div>
          ) : (
            // Display mode - just the title
            <span
              className="truncate"
              style={{ fontSize: 13, fontWeight: 600, color: '#f0f0f0' }}
            >
              {panel.title || panelDef.name}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {editButton}
          {headerActions}
          {/* Menu button with dropdown */}
          {(onClose || onDelete || (customMenuItems && customMenuItems.length > 0)) && (
            <div ref={menuRef} className="relative">
              <button
                onClick={() => setShowMenu(prev => !prev)}
                onMouseDown={(e) => e.stopPropagation()}
                aria-label="Panel options"
                style={{
                  width: 24,
                  height: 24,
                  background: showMenu ? 'rgba(255, 255, 255, 0.1)' : 'transparent',
                  border: 'none',
                  borderRadius: 4,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  color: showMenu ? '#f0f0f0' : '#5c6070',
                  transition: 'all 0.15s',
                }}
              >
                <MoreVertical size={14} />
              </button>

              {/* Dropdown menu */}
              {showMenu && (
                <div
                  style={{
                    position: 'absolute',
                    top: '100%',
                    right: 0,
                    marginTop: 4,
                    background: '#252830',
                    border: '1px solid rgba(255, 255, 255, 0.15)',
                    borderRadius: 8,
                    boxShadow: '0 8px 24px rgba(0, 0, 0, 0.4)',
                    minWidth: 140,
                    zIndex: 100,
                    overflow: 'hidden',
                  }}
                >
                  {/* Custom menu items */}
                  {customMenuItems?.map((item) => (
                    <button
                      key={item.id}
                      onClick={() => {
                        setShowMenu(false)
                        item.onClick()
                      }}
                      onMouseDown={(e) => e.stopPropagation()}
                      style={{
                        width: '100%',
                        padding: '8px 12px',
                        background: 'transparent',
                        border: 'none',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        cursor: 'pointer',
                        color: item.color || '#e0e0e0',
                        fontSize: 13,
                        transition: 'background 0.15s',
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)'}
                      onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                    >
                      {item.icon}
                      {item.label}
                      {item.badge !== undefined && (
                        <span
                          style={{
                            marginLeft: 'auto',
                            fontSize: 10,
                            fontWeight: 600,
                            background: item.color ? `${item.color}20` : 'rgba(255, 255, 255, 0.1)',
                            color: item.color || '#8b8fa3',
                            padding: '2px 6px',
                            borderRadius: 4,
                          }}
                        >
                          {item.badge}
                        </span>
                      )}
                    </button>
                  ))}

                  {/* Divider if there are custom items and also hide/delete */}
                  {customMenuItems && customMenuItems.length > 0 && (onClose || onDelete) && (
                    <div style={{ height: 1, background: 'rgba(255, 255, 255, 0.08)', margin: '4px 0' }} />
                  )}

                  {/* Hide option (current close behavior) */}
                  {showCloseButton && onClose && (
                    <button
                      onClick={() => {
                        setShowMenu(false)
                        onClose()
                      }}
                      onMouseDown={(e) => e.stopPropagation()}
                      style={{
                        width: '100%',
                        padding: '8px 12px',
                        background: 'transparent',
                        border: 'none',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        cursor: 'pointer',
                        color: '#e0e0e0',
                        fontSize: 13,
                        transition: 'background 0.15s',
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)'}
                      onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                    >
                      <EyeOff size={14} style={{ color: '#8b8fa3' }} />
                      Hide
                    </button>
                  )}

                  {/* Delete option (move to trash) */}
                  {onDelete && (
                    <button
                      onClick={() => {
                        setShowMenu(false)
                        onDelete()
                      }}
                      onMouseDown={(e) => e.stopPropagation()}
                      style={{
                        width: '100%',
                        padding: '8px 12px',
                        background: 'transparent',
                        border: 'none',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        cursor: 'pointer',
                        color: '#ef4444',
                        fontSize: 13,
                        transition: 'background 0.15s',
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(239, 68, 68, 0.1)'}
                      onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                    >
                      <Trash2 size={14} />
                      Delete
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Content */}
      <div
        className={cn('flex-1 overflow-auto', contentClassName)}
        style={{ padding: 14, color: '#f0f0f0' }}
      >
        {children}
      </div>
    </div>
  )
}
