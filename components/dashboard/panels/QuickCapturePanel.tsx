"use client"

/**
 * Quick Capture Panel Component
 * Part of Dashboard Implementation - Phase 2.2d
 *
 * Provides a quick text input to capture notes that are saved
 * to the user's designated quick capture entry (Ideas Inbox by default).
 */

import React, { useState, useRef, useEffect } from 'react'
import { Send, Loader2, CheckCircle, AlertCircle, Settings } from 'lucide-react'
import { BaseDashboardPanel } from './BaseDashboardPanel'
import { panelTypeRegistry } from '@/lib/dashboard/panel-registry'
import type { BasePanelProps, PanelConfig } from '@/lib/dashboard/panel-registry'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface QuickCaptureConfig extends PanelConfig {
  destinationEntryId?: string
}

type CaptureStatus = 'idle' | 'saving' | 'success' | 'error'

export function QuickCapturePanel({ panel, onClose, onNavigate, isActive }: BasePanelProps) {
  const panelDef = panelTypeRegistry.quick_capture
  const config = panel.config as QuickCaptureConfig

  const [content, setContent] = useState('')
  const [status, setStatus] = useState<CaptureStatus>('idle')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [lastCreatedNoteId, setLastCreatedNoteId] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Clear success status after a delay
  useEffect(() => {
    if (status === 'success') {
      const timer = setTimeout(() => {
        setStatus('idle')
        setLastCreatedNoteId(null)
      }, 3000)
      return () => clearTimeout(timer)
    }
  }, [status])

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault()

    const trimmedContent = content.trim()
    if (!trimmedContent) return

    try {
      setStatus('saving')
      setErrorMessage(null)

      // Generate a title from the first line or first N characters
      const firstLine = trimmedContent.split('\n')[0]
      const title = firstLine.length > 50
        ? `${firstLine.substring(0, 47)}...`
        : firstLine || `Quick Note - ${new Date().toLocaleString()}`

      // Create the note in the quick capture entry
      const response = await fetch('/api/dashboard/quick-capture', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          content: trimmedContent,
          destinationEntryId: config.destinationEntryId,
        }),
      })

      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to save note')
      }

      const data = await response.json()
      setLastCreatedNoteId(data.noteId)
      setContent('')
      setStatus('success')

      // Focus textarea for next capture
      textareaRef.current?.focus()
    } catch (err) {
      console.error('[QuickCapturePanel] Failed to save note:', err)
      setStatus('error')
      setErrorMessage(err instanceof Error ? err.message : 'Failed to save note')
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Ctrl/Cmd + Enter to submit
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      handleSubmit()
    }
  }

  const handleViewNote = () => {
    if (lastCreatedNoteId && onNavigate) {
      // Navigate to the note
      onNavigate(lastCreatedNoteId, '')
    }
  }

  const isSubmitDisabled = !content.trim() || status === 'saving'

  return (
    <BaseDashboardPanel
      panel={panel}
      panelDef={panelDef}
      onClose={onClose}
      isActive={isActive}
      contentClassName="p-3 flex flex-col"
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-2 flex-1">
        <textarea
          ref={textareaRef}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Capture a quick thought..."
          disabled={status === 'saving'}
          className={cn(
            'flex-1 min-h-[60px] px-3 py-2 text-sm rounded-md border border-input bg-background',
            'placeholder:text-muted-foreground resize-none',
            'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
            'disabled:cursor-not-allowed disabled:opacity-50'
          )}
        />

        <div className="flex items-center justify-between gap-2">
          {/* Status indicator */}
          <div className="flex items-center gap-1 text-xs">
            {status === 'success' && (
              <>
                <CheckCircle size={14} className="text-green-500" />
                <span className="text-green-600">Saved!</span>
                {lastCreatedNoteId && (
                  <button
                    type="button"
                    onClick={handleViewNote}
                    className="text-primary hover:underline ml-1"
                  >
                    View
                  </button>
                )}
              </>
            )}
            {status === 'error' && (
              <>
                <AlertCircle size={14} className="text-destructive" />
                <span className="text-destructive">{errorMessage || 'Error'}</span>
              </>
            )}
            {status === 'idle' && (
              <span className="text-muted-foreground">
                {/* Hint about keyboard shortcut */}
                <kbd className="px-1 py-0.5 text-[10px] bg-muted rounded">Ctrl</kbd>
                {' + '}
                <kbd className="px-1 py-0.5 text-[10px] bg-muted rounded">Enter</kbd>
                {' to save'}
              </span>
            )}
          </div>

          {/* Submit button */}
          <Button
            type="submit"
            size="sm"
            disabled={isSubmitDisabled}
          >
            {status === 'saving' ? (
              <>
                <Loader2 size={14} className="animate-spin mr-1" />
                Saving
              </>
            ) : (
              <>
                <Send size={14} className="mr-1" />
                Capture
              </>
            )}
          </Button>
        </div>
      </form>
    </BaseDashboardPanel>
  )
}
