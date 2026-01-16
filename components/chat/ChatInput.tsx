/**
 * Chat Input Component
 * Part of: Step 4 Refactor (UI subcomponents extraction)
 *
 * Simple input field with send button for the chat navigation panel.
 */

'use client'

import { forwardRef } from 'react'
import { Send, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

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
      <div className="border-t border-white/20 p-3 shrink-0 bg-white/90 backdrop-blur-md">
        <div className="flex items-center gap-2">
          <Input
            ref={ref}
            type="text"
            placeholder={placeholder}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isLoading}
            className="h-10 text-sm bg-white text-zinc-900 border-zinc-300 placeholder:text-zinc-400"
          />
          <Button
            size="icon"
            className="h-10 w-10 shrink-0"
            onClick={onSend}
            disabled={!value.trim() || isLoading}
          >
            {isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
            <span className="sr-only">Send</span>
          </Button>
        </div>
      </div>
    )
  }
)

ChatInput.displayName = 'ChatInput'
