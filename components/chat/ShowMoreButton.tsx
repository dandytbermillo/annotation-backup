/**
 * Show More Button Component
 * Per: show-more-button-spec.md
 *
 * Provides a clear "Show more" affordance for doc-based answers
 * so users can open the full doc section without typing a follow-up.
 */

'use client'

import { cn } from '@/lib/utils'

export interface ShowMoreButtonProps {
  /** Doc slug for the source document */
  docSlug: string
  /** Chunk ID to scroll to (optional) */
  chunkId?: string
  /** Header path for breadcrumb display (optional) */
  headerPath?: string
  /** Click handler - opens doc panel or triggers HS2 expand */
  onClick: (docSlug: string, chunkId?: string) => void
  /** Whether the button is disabled */
  disabled?: boolean
  /** Additional CSS classes */
  className?: string
}

/**
 * Renders a "Show more" button for doc-based responses.
 * Only shown when eligibility criteria are met (found/weak with docSlug).
 */
export function ShowMoreButton({
  docSlug,
  chunkId,
  headerPath,
  onClick,
  disabled = false,
  className,
}: ShowMoreButtonProps) {
  return (
    <button
      type="button"
      onClick={() => onClick(docSlug, chunkId)}
      disabled={disabled}
      title={headerPath ? `Open: ${headerPath}` : 'Open the full doc section'}
      className={cn(
        'inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium',
        'rounded-full border transition-all duration-200',
        'bg-indigo-50/80 text-indigo-700 border-indigo-200/50',
        'hover:bg-indigo-100 hover:border-indigo-300 hover:shadow-sm',
        'focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:ring-offset-1',
        'disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-indigo-50/80',
        className
      )}
    >
      <svg
        className="w-3.5 h-3.5"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
        />
      </svg>
      Show more
    </button>
  )
}
