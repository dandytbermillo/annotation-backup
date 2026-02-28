/**
 * Chat Input Component
 * Part of: Step 4 Refactor (UI subcomponents extraction)
 *
 * Simple input field with send button for the chat navigation panel.
 */

'use client'

import { forwardRef } from 'react'
import { Send, Loader2 } from 'lucide-react'

export interface ChatInputProps {
  /** Current input value */
  value: string
  /** Callback when input value changes */
  onChange: (value: string) => void
  /** Callback when send button is clicked or Enter is pressed */
  onSend: () => void
  /** Whether the chat is currently processing */
  isLoading: boolean
  /** Placeholder text */
  placeholder?: string
}

/**
 * Chat input field with send button.
 * Handles Enter key to send and disables during loading.
 */
export const ChatInput = forwardRef<HTMLInputElement, ChatInputProps>(
  ({ value, onChange, onSend, isLoading, placeholder = 'Where would you like to go?' }, ref) => {
    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter' && !e.shiftKey && value.trim() && !isLoading) {
        e.preventDefault()
        onSend()
      }
    }

    return (
      <div className="border-t border-cyan-700/15 p-3 shrink-0 bg-slate-950/90 backdrop-blur-md">
        <div className="flex items-center gap-2">
          <input
            ref={ref}
            type="text"
            placeholder={placeholder}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isLoading}
            className="flex-1 h-10 rounded-md px-3 py-2 text-sm border border-cyan-700/25 placeholder:text-slate-500 focus:outline-none focus:border-cyan-500/40 disabled:cursor-not-allowed disabled:opacity-50"
            style={{
              backgroundColor: 'rgba(15, 23, 42, 0.5)',
              color: '#67e8f9',
            }}
          />
          <button
            type="button"
            className="h-10 w-10 shrink-0 rounded-md flex items-center justify-center border border-cyan-500/30 hover:border-cyan-400/50 disabled:cursor-not-allowed disabled:opacity-50 transition-colors"
            style={{
              backgroundColor: 'rgba(22, 78, 99, 0.15)',
              color: '#22d3ee',
            }}
            onClick={onSend}
            disabled={!value.trim() || isLoading}
          >
            {isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
            <span className="sr-only">Send</span>
          </button>
        </div>
      </div>
    )
  }
)

ChatInput.displayName = 'ChatInput'
