"use client"

/**
 * Full Panel Drawer
 * Part of Widget Architecture - Right-side drawer for full panel display
 *
 * Key features:
 * - Right-side drawer (NOT full-screen modal)
 * - Widgets remain visible on left (with subtle dim backdrop)
 * - Chat remains accessible (z-index below chat)
 * - Reuses existing panel components inside drawer
 */

import React, { useEffect, useCallback } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { WorkspacePanel, PanelConfig } from '@/lib/dashboard/panel-registry'
import { DashboardPanelRenderer } from './DashboardPanelRenderer'

/** Drawer width in pixels */
const DRAWER_WIDTH = 420

export interface FullPanelDrawerProps {
  /** Whether the drawer is open */
  isOpen: boolean
  /** Callback to close the drawer */
  onClose: () => void
  /** The panel to display in the drawer */
  panel: WorkspacePanel | null
  /** Callback when panel config changes */
  onConfigChange?: (panelId: string, config: Partial<PanelConfig>) => void
  /** Callback when panel title changes */
  onTitleChange?: (panelId: string, newTitle: string) => void
  /** Callback when navigating to a workspace */
  onNavigate?: (entryId: string, workspaceId: string) => void
  /** Callback when opening a workspace */
  onOpenWorkspace?: (workspaceId: string) => void
  /** Callback when panel is deleted */
  onDelete?: (panelId: string) => void
}

export function FullPanelDrawer({
  isOpen,
  onClose,
  panel,
  onConfigChange,
  onTitleChange,
  onNavigate,
  onOpenWorkspace,
  onDelete,
}: FullPanelDrawerProps) {
  // Close on Escape key
  useEffect(() => {
    if (!isOpen) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  // Prevent body scroll when drawer is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => {
      document.body.style.overflow = ''
    }
  }, [isOpen])

  // Wrapped callbacks with panel ID
  const handleConfigChange = useCallback(
    (config: Partial<PanelConfig>) => {
      if (panel && onConfigChange) {
        onConfigChange(panel.id, config)
      }
    },
    [panel, onConfigChange]
  )

  const handleTitleChange = useCallback(
    (newTitle: string) => {
      if (panel && onTitleChange) {
        onTitleChange(panel.id, newTitle)
      }
    },
    [panel, onTitleChange]
  )

  const handleDelete = useCallback(() => {
    if (panel && onDelete) {
      onDelete(panel.id)
      onClose()
    }
  }, [panel, onDelete, onClose])

  // Get panel title for drawer header
  const getPanelTitle = (): React.ReactNode => {
    if (!panel) return 'Panel'
    if (panel.title) return panel.title
    // Generate title based on panel type
    switch (panel.panelType) {
      case 'recent':
        return 'Recent'
      case 'links_note':
      case 'links_note_tiptap':
        return panel.badge ? (
          <>Quick Links <span className="text-indigo-400">{panel.badge}</span></>
        ) : 'Quick Links'
      case 'continue':
        return 'Continue'
      case 'quick_capture':
        return 'Quick Capture'
      case 'navigator':
        return 'Navigator'
      case 'category':
        return 'Category'
      case 'category_navigator':
        return 'Categories'
      case 'widget_manager':
        return 'Widget Manager'
      default:
        return 'Panel'
    }
  }

  return (
    <>
      {/* Backdrop - LEFT side only, keeps widgets visible and INTERACTIVE
          pointer-events-none allows clicking through to widgets while drawer is open
          Use X button or Escape to close the drawer */}
      <div
        className={cn(
          'fixed top-0 left-0 bottom-0 transition-opacity duration-300',
          isOpen ? 'opacity-100' : 'opacity-0',
          'pointer-events-none' // Always non-blocking so widgets stay interactive
        )}
        style={{
          right: DRAWER_WIDTH,
          background: 'rgba(0, 0, 0, 0.15)', // Lighter dim since it's non-blocking
          zIndex: 99990,
        }}
        aria-hidden="true"
      />

      {/* Right-side drawer */}
      <div
        className={cn(
          'fixed top-0 right-0 bottom-0 flex flex-col',
          'bg-[#1e222a] border-l border-white/10',
          'shadow-[-4px_0_24px_rgba(0,0,0,0.4)]',
          'transition-transform duration-300 ease-out'
        )}
        style={{
          width: DRAWER_WIDTH,
          transform: isOpen ? 'translateX(0)' : 'translateX(100%)',
          zIndex: 99995, // Below chat (99999), above backdrop (99990)
        }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="drawer-title"
      >
        {/* Drawer Header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-white/10 flex-shrink-0">
          <button
            onClick={onClose}
            className={cn(
              'w-8 h-8 flex items-center justify-center rounded-lg',
              'bg-transparent border border-white/10',
              'text-gray-400 hover:text-white hover:bg-white/5',
              'transition-colors duration-150'
            )}
            aria-label="Close drawer"
          >
            <X size={18} />
          </button>
          <span
            id="drawer-title"
            className="text-base font-semibold text-white"
          >
            {getPanelTitle()}
          </span>
        </div>

        {/* Drawer Body - renders the full panel */}
        <div className="flex-1 overflow-y-auto p-5">
          {panel && (
            <DashboardPanelRenderer
              key={panel.id}
              panel={panel}
              onClose={onClose}
              onConfigChange={handleConfigChange}
              onTitleChange={handleTitleChange}
              onNavigate={onNavigate}
              onOpenWorkspace={onOpenWorkspace}
              onDelete={handleDelete}
              isActive={true}
            />
          )}
        </div>
      </div>
    </>
  )
}

export default FullPanelDrawer
