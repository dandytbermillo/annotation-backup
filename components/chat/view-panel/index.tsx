/**
 * View Panel Component
 *
 * Main view panel that slides in from the right edge to display
 * various content types (lists, documents, notes, Quick Links).
 *
 * Modes:
 * - Overlay (default): Fixed positioned, slides from right with backdrop
 * - Inline: Positioned within parent flex container (side-by-side with chat)
 *
 * Width: 30% with 320px min and 560px max (overlay mode)
 * Animation: 250ms slide with backdrop dim
 */

'use client'

import { useEffect } from 'react'
import { useViewPanel } from '@/lib/chat/view-panel-context'
import { ViewContentType } from '@/lib/chat/view-panel-types'
import { ViewPanelHeader } from './view-panel-header'
import { ViewPanelToolbar } from './view-panel-toolbar'
import { ViewPanelSearch } from './view-panel-search'
import { ViewPanelContent } from './view-panel-content'
import { ViewPanelFooter } from './view-panel-footer'

export interface ViewPanelProps {
  /**
   * Inline mode: Panel is positioned as a fixed element with custom positioning (Claude-style side-by-side)
   * When true: No backdrop, uses provided style for positioning
   * When false (default): Fixed overlay with backdrop, slides from right
   */
  inline?: boolean
  /**
   * Custom positioning styles for inline mode (left offset, width, etc.)
   * Only used when inline={true}
   */
  inlineStyle?: React.CSSProperties
  /**
   * Whether the parent panel (e.g., chat) is open - controls visibility in inline mode
   * Only used when inline={true}
   */
  parentOpen?: boolean
}

export function ViewPanel({ inline = false, inlineStyle, parentOpen = true }: ViewPanelProps) {
  const { state, closePanel } = useViewPanel()
  const { isOpen, content } = state

  // Escape key handler
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        closePanel()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, closePanel])

  const isListType =
    content?.type === ViewContentType.LIST ||
    content?.type === ViewContentType.MIXED_LIST
  const isDocType =
    content?.type === ViewContentType.TEXT ||
    content?.type === ViewContentType.CODE ||
    content?.type === ViewContentType.PDF ||
    content?.type === ViewContentType.NOTE

  // Inline mode: Fixed positioning next to parent panel (Claude-style side-by-side)
  if (inline) {
    // Don't render if parent panel is closed
    if (!parentOpen) return null

    return (
      <div
        className={`
          fixed top-0 z-50
          h-screen
          bg-slate-950/98 backdrop-blur-xl
          border-l border-white/8
          flex flex-col
          transition-all duration-[250ms] ease-[cubic-bezier(0.4,0,0.2,1)]
          ${isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'}
        `}
        style={inlineStyle}
        data-testid="view-panel-inline"
      >
        {isOpen && (
          <>
            <ViewPanelHeader />

            {isDocType && <ViewPanelToolbar />}
            {isListType && <ViewPanelSearch />}
            {isListType && <ViewPanelStats />}

            <ViewPanelContent />

            <ViewPanelFooter />
          </>
        )}
      </div>
    )
  }

  // Overlay mode (default): Fixed positioned with backdrop
  return (
    <>
      {/* Backdrop */}
      <div
        className={`
          fixed inset-0 bg-black/20 z-[9998]
          transition-opacity duration-200 ease-out
          ${isOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}
        `}
        onClick={closePanel}
        data-testid="view-panel-backdrop"
      />

      {/* Panel */}
      <div
        className={`
          fixed top-0 right-0 bottom-0
          bg-slate-950/98 backdrop-blur-xl
          border-l border-white/8
          shadow-[-8px_0_32px_rgba(0,0,0,0.4)]
          flex flex-col
          transition-transform duration-[250ms] ease-[cubic-bezier(0.4,0,0.2,1)]
        `}
        style={{
          width: '30%',
          minWidth: '360px',
          maxWidth: '800px',
          zIndex: 9999,
          transform: isOpen ? 'translateX(0)' : 'translateX(100%)',
        }}
        data-testid="view-panel"
      >
        <ViewPanelHeader />

        {isDocType && <ViewPanelToolbar />}
        {isListType && <ViewPanelSearch />}
        {isListType && <ViewPanelStats />}

        <ViewPanelContent />

        <ViewPanelFooter />
      </div>
    </>
  )
}

function ViewPanelStats() {
  const { state, filteredItems } = useViewPanel()
  const count = filteredItems.length
  const query = state.searchQuery

  return (
    <div className="flex items-center justify-between px-4 py-2 text-xs text-white/50 border-b border-white/4">
      <span>
        {count} item{count !== 1 ? 's' : ''}
        {query && ` matching "${query}"`}
      </span>
      <span>
        Press{' '}
        <kbd className="px-1.5 py-0.5 bg-white/10 rounded text-[10px] font-mono">
          Esc
        </kbd>{' '}
        to close
      </span>
    </div>
  )
}
