'use client'

import { useState } from 'react'
import { ChevronRight, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { CitedSnippet } from '@/lib/chat/stage6-content-tool-contracts'

interface CitationSnippetsProps {
  snippets: CitedSnippet[]
  contentTruncated?: boolean
  className?: string
}

/**
 * Collapsible "Sources" section for surfaced content answers (6x.6).
 * Shows the cited snippet evidence the answer was grounded on.
 * Collapsed by default — users expand to verify evidence.
 */
export function CitationSnippets({ snippets, contentTruncated, className }: CitationSnippetsProps) {
  const [isExpanded, setIsExpanded] = useState(false)

  if (snippets.length === 0) return null

  return (
    <div className={cn('mt-2', className)}>
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className={cn(
          'flex items-center gap-1.5 px-2 py-1 text-xs font-medium',
          'rounded-md transition-colors duration-150',
          'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800/50',
        )}
        aria-expanded={isExpanded}
      >
        {isExpanded
          ? <ChevronDown className="h-3 w-3" />
          : <ChevronRight className="h-3 w-3" />
        }
        Sources ({snippets.length} {snippets.length === 1 ? 'snippet' : 'snippets'})
      </button>

      {isExpanded && (
        <div className="mt-1.5 space-y-1.5 pl-1">
          {snippets.map((snippet) => (
            <div
              key={snippet.index}
              className={cn(
                'rounded-md border px-3 py-2 text-xs leading-relaxed',
                'border-neutral-700/60 bg-neutral-800/40 text-neutral-300',
              )}
            >
              {snippet.sectionHeading && (
                <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-neutral-500">
                  {snippet.sectionHeading}
                </div>
              )}
              <p className="whitespace-pre-wrap">{snippet.text}</p>
              {snippet.truncated && (
                <div className="mt-1 text-[10px] italic text-neutral-500">
                  Snippet truncated
                </div>
              )}
            </div>
          ))}

          {contentTruncated && (
            <div className="px-2 py-1 text-[10px] italic text-neutral-500">
              Based on partial note content. Some sections may not be included.
            </div>
          )}
        </div>
      )}
    </div>
  )
}
