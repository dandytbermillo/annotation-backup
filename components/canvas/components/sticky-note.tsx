"use client"

import React, { useRef, useEffect, useCallback } from 'react'
import { useComponentRegistration } from '@/lib/hooks/use-component-registration'
import {
  useComponentState,
  useWorkspaceStoreActions,
} from '@/lib/hooks/use-workspace-component-store'
import { debugLog } from '@/lib/utils/debug-logger'

interface StickyNoteProps {
  componentId: string
  workspaceId?: string | null
  position?: { x: number; y: number }
  state?: Partial<StickyNoteState>
  onStateUpdate?: (state: StickyNoteState) => void
}

interface StickyNoteState {
  content: string
  colorIndex: number
}

const DEFAULT_STICKY_STATE: StickyNoteState = {
  content: '',
  colorIndex: 0,
}

const STICKY_COLORS = [
  { name: 'yellow', bg: '#fef08a', border: '#fde047', text: '#713f12', shadow: 'rgba(254, 240, 138, 0.4)' },
  { name: 'pink', bg: '#fbcfe8', border: '#f9a8d4', text: '#831843', shadow: 'rgba(251, 207, 232, 0.4)' },
  { name: 'blue', bg: '#bfdbfe', border: '#93c5fd', text: '#1e3a8a', shadow: 'rgba(191, 219, 254, 0.4)' },
  { name: 'green', bg: '#bbf7d0', border: '#86efac', text: '#14532d', shadow: 'rgba(187, 247, 208, 0.4)' },
  { name: 'purple', bg: '#e9d5ff', border: '#d8b4fe', text: '#581c87', shadow: 'rgba(233, 213, 255, 0.4)' },
  { name: 'orange', bg: '#fed7aa', border: '#fdba74', text: '#7c2d12', shadow: 'rgba(254, 215, 170, 0.4)' },
]

/**
 * Sticky Note Component - Phase 5 Migration
 *
 * Migrated to use workspace component store for state management.
 * Sticky Note has no background operations, but benefits from:
 * - Single source of truth
 * - Proper cold restore
 * - Consistent persistence
 */
export function StickyNote({ componentId, workspaceId, position, state, onStateUpdate }: StickyNoteProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // ==========================================================================
  // Phase 5: Read state from workspace component store
  // ==========================================================================

  const storeState = useComponentState<StickyNoteState>(workspaceId, componentId)
  const actions = useWorkspaceStoreActions(workspaceId)

  // Resolve effective state: store state > prop state > defaults
  const content = storeState?.content ?? state?.content ?? DEFAULT_STICKY_STATE.content
  const colorIndex = storeState?.colorIndex ?? state?.colorIndex ?? DEFAULT_STICKY_STATE.colorIndex

  // ==========================================================================
  // Phase 5: Initialize store state if not present
  // ==========================================================================

  useEffect(() => {
    if (!workspaceId) return

    if (storeState === null) {
      const initialState: StickyNoteState = {
        content: state?.content ?? DEFAULT_STICKY_STATE.content,
        colorIndex: state?.colorIndex ?? DEFAULT_STICKY_STATE.colorIndex,
      }

      actions.updateComponentState<StickyNoteState>(componentId, initialState)

      void debugLog({
        component: 'StickyNoteDiagnostic',
        action: 'sticky_note_store_initialized',
        metadata: { componentId, workspaceId, initialState },
      })
    }
  }, [workspaceId, componentId, storeState, state, actions])

  // ==========================================================================
  // Phase 5: Sync to legacy onStateUpdate callback (backward compatibility)
  // ==========================================================================

  useEffect(() => {
    if (storeState && onStateUpdate) {
      onStateUpdate(storeState)
    }
  }, [storeState, onStateUpdate])

  // ==========================================================================
  // Legacy: Register with runtime ledger (backward compatibility during migration)
  // ==========================================================================

  useComponentRegistration({
    workspaceId,
    componentId,
    componentType: 'sticky-note',
    position,
    metadata: (storeState ?? { content, colorIndex }) as unknown as Record<string, unknown>,
    isActive: false, // Sticky Note has no background operations
    strict: false,
  })

  // ==========================================================================
  // Auto-resize textarea based on content
  // ==========================================================================

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
      textareaRef.current.style.height = textareaRef.current.scrollHeight + 'px'
    }
  }, [content])

  // ==========================================================================
  // Action Handlers - dispatch to store
  // ==========================================================================

  const handleContentChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    if (!workspaceId) return

    actions.updateComponentState<StickyNoteState>(componentId, {
      content: e.target.value,
    })
  }, [workspaceId, componentId, actions])

  const cycleColor = useCallback(() => {
    if (!workspaceId) return

    const newIndex = (colorIndex + 1) % STICKY_COLORS.length
    actions.updateComponentState<StickyNoteState>(componentId, {
      colorIndex: newIndex,
    })
  }, [workspaceId, componentId, colorIndex, actions])

  const currentColor = STICKY_COLORS[colorIndex]

  return (
    <div
      className="sticky-note-component relative flex flex-col p-4"
      style={{
        backgroundColor: currentColor.bg,
        minHeight: '250px',
        width: '100%',
        boxShadow: '2px 2px 8px rgba(0, 0, 0, 0.15)',
      }}
    >
      {/* Color switcher button in corner */}
      <button
        onClick={cycleColor}
        className="absolute top-2 right-2 w-4 h-4 rounded-full opacity-50 hover:opacity-100 transition-opacity"
        style={{
          backgroundColor: STICKY_COLORS[(colorIndex + 1) % STICKY_COLORS.length].bg,
          border: `1px solid ${STICKY_COLORS[(colorIndex + 1) % STICKY_COLORS.length].border}`,
        }}
        title="Change color"
      />

      {/* Main textarea - looks like handwritten note */}
      <textarea
        ref={textareaRef}
        value={content}
        onChange={handleContentChange}
        className="w-full flex-1 bg-transparent resize-none focus:outline-none"
        style={{
          color: currentColor.text,
          fontFamily: '"Marker Felt", "Comic Sans MS", cursive',
          fontSize: '16px',
          lineHeight: '1.8',
          minHeight: '200px',
        }}
        placeholder="Write a note..."
      />

      {/* Character count - subtle, bottom corner */}
      <div
        className="absolute bottom-2 left-2 text-xs opacity-30"
        style={{ color: currentColor.text }}
      >
        {content.length > 0 && `${content.length}`}
      </div>
    </div>
  )
}
