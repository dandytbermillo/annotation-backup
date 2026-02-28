/**
 * Show More Button Component
 * Per: show-more-button-spec.md
 *
 * Provides a clear "Show more" affordance for doc-based and notes-based answers
 * so users can open the full content without typing a follow-up.
 */

'use client'

import { cn } from '@/lib/utils'

export interface ShowMoreButtonProps {
  /** Doc slug for the source document (docs corpus) */
  docSlug?: string
  /** Item ID for the source note (notes corpus) */
  itemId?: string
  /** Item name for display (notes corpus, optional) */
  itemName?: string
  /** Chunk ID to scroll to (optional) */
  chunkId?: string
  /** Header path for breadcrumb display (optional) */
  headerPath?: string
  /** Click handler - opens doc/note panel */
  onClick: (docSlug?: string, itemId?: string, chunkId?: string) => void
  /** Whether the button is disabled */
  disabled?: boolean
  /** Additional CSS classes */
  className?: string
}

/**
 * Renders a "Show more" button for doc-based and notes-based responses.
 * Only shown when eligibility criteria are met (found/weak with docSlug or itemId).
 */
export function ShowMoreButton({
  docSlug,
  itemId,
  itemName,
  chunkId,
  headerPath,
  onClick,
  disabled = false,
  className,
}: ShowMoreButtonProps) {
  // Don't render if neither docSlug nor itemId is provided
  if (!docSlug && !itemId) return null

  // Determine display title based on available data
  const displayTitle = docSlug
    ? (headerPath ? `Open: ${headerPath}` : 'Open the full doc section')
    : (itemName ? `Open: ${itemName}` : 'Open the full note')

  return (
    <button
      type="button"
      onClick={() => onClick(docSlug, itemId, chunkId)}
      disabled={disabled}
      title={displayTitle}
      className={cn(
        'inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium',
        'rounded-full border transition-all duration-200',
        'bg-cyan-800/10 text-cyan-400/75 border-cyan-600/25',
        'hover:bg-cyan-700/15 hover:border-cyan-500/40 hover:shadow-sm',
        'focus:outline-none focus:ring-2 focus:ring-cyan-500/30 focus:ring-offset-1',
        'disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-cyan-800/10',
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
