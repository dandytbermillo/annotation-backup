"use client"

/**
 * Quick Capture Panel Component
 * Part of Dashboard Implementation - Phase 2.2d
 *
 * Provides a quick text input to capture notes that are saved
 * to the user's designated quick capture entry (Ideas Inbox by default).
 */

import React, { useState, useRef, useEffect } from 'react'
import { Send, Loader2, CheckCircle, AlertCircle } from 'lucide-react'
import { BaseDashboardPanel } from './BaseDashboardPanel'
import { panelTypeRegistry } from '@/lib/dashboard/panel-registry'
import type { BasePanelProps, PanelConfig } from '@/lib/dashboard/panel-registry'
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
      <form onSubmit={handleSubmit} className="flex flex-col gap-3 flex-1">
        <textarea
          ref={textareaRef}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Capture a quick thought..."
          disabled={status === 'saving'}
          className={cn('flex-1 resize-none', status === 'saving' && 'opacity-50 cursor-not-allowed')}
          style={{
            width: '100%',
            minHeight: 80,
            padding: 12,
            background: 'rgba(255, 255, 255, 0.03)',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            borderRadius: 8,
            color: '#f0f0f0',
            fontSize: 13,
            outline: 'none',
          }}
        />

        <div className="flex items-center justify-between">
          {/* Status indicator */}
          <div className="flex items-center gap-1 text-xs">
            {status === 'success' && (
              <>
                <CheckCircle size={14} style={{ color: '#22c55e' }} />
                <span style={{ color: '#22c55e' }}>Saved!</span>
                {lastCreatedNoteId && (
                  <button
                    type="button"
                    onClick={handleViewNote}
                    className="ml-1"
                    style={{ color: '#6366f1', fontSize: 12, background: 'none', border: 'none', cursor: 'pointer' }}
                  >
                    View
                  </button>
                )}
              </>
            )}
            {status === 'error' && (
              <>
                <AlertCircle size={14} style={{ color: '#ef4444' }} />
                <span style={{ color: '#ef4444' }}>{errorMessage || 'Error'}</span>
              </>
            )}
            {status === 'idle' && (
              <span style={{ color: '#5c6070', fontSize: 11 }}>
                <kbd
                  className="px-1.5 py-0.5 rounded"
                  style={{
                    fontSize: 10,
                    background: 'rgba(255, 255, 255, 0.05)',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                  }}
                >
                  Ctrl
                </kbd>
                {' + '}
                <kbd
                  className="px-1.5 py-0.5 rounded"
                  style={{
                    fontSize: 10,
                    background: 'rgba(255, 255, 255, 0.05)',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                  }}
                >
                  Enter
                </kbd>
                {' to save'}
              </span>
            )}
          </div>

          {/* Submit button */}
          <button
            type="submit"
            disabled={isSubmitDisabled}
            className="flex items-center gap-1"
            style={{
              padding: '7px 14px',
              borderRadius: 8,
              background: isSubmitDisabled ? 'rgba(99, 102, 241, 0.3)' : 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
              color: isSubmitDisabled ? 'rgba(255, 255, 255, 0.5)' : '#fff',
              border: 'none',
              fontSize: 13,
              fontWeight: 500,
              cursor: isSubmitDisabled ? 'not-allowed' : 'pointer',
            }}
          >
            {status === 'saving' ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                Saving
              </>
            ) : (
              <>
                <Send size={14} />
                Capture
              </>
            )}
          </button>
        </div>
      </form>
    </BaseDashboardPanel>
  )
}
