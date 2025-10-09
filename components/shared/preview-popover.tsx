'use client';

import React, { useRef, useState, useLayoutEffect } from 'react';

interface PreviewPopoverProps {
  /** Preview content text */
  content: string;
  /** Loading/ready/error state */
  status: 'loading' | 'ready' | 'error';
  /** Fixed position for the popover */
  position: { x: number; y: number };
  /** Note ID for tracking and opening */
  noteId: string;
  /** Callback when "Open note" button is clicked */
  onOpenNote?: (noteId: string) => void;
  /** Mouse enter handler for hover management */
  onMouseEnter?: () => void;
  /** Mouse leave handler for hover management */
  onMouseLeave?: () => void;
  /** Z-index override (default: 2147483647) */
  zIndex?: number;
}

/**
 * Shared preview popover with incremental content disclosure.
 * Used by both popup-overlay and floating-toolbar for consistent preview UX.
 *
 * Features:
 * - Initial preview: 300 chars
 * - Incremental "Show more": +500 chars each click
 * - Handles unlimited content length
 * - Scrollable view with gradient fade
 * - "Open note →" button when fully expanded and overflowing
 * - Keyboard accessible (tab to focus, scroll with arrow keys)
 * - Auto reset when switching notes
 */
export function PreviewPopover({
  content,
  status,
  position,
  noteId,
  onOpenNote,
  onMouseEnter,
  onMouseLeave,
  zIndex = 2147483647,
}: PreviewPopoverProps) {
  const INITIAL_CHARS = 300; // Initial preview length
  const SMALL_INCREMENT = 500; // First 3 clicks
  const LARGE_INCREMENT = 1000; // After 3 clicks
  const THRESHOLD_FOR_LARGE = 300 + (SMALL_INCREMENT * 3); // 1800 chars

  const [visibleChars, setVisibleChars] = useState(INITIAL_CHARS);
  const [isOverflowing, setIsOverflowing] = useState(false);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const lastNoteIdRef = useRef<string | null>(null);

  // Calculate display state
  const totalContentLength = content?.length || 0;
  const hasMore = totalContentLength > visibleChars;
  const displayContent = hasMore
    ? content?.substring(0, visibleChars) + '...'
    : content;

  // Calculate next increment (hybrid: first 3 clicks +500, then +1000)
  const getNextIncrement = () => {
    return visibleChars < THRESHOLD_FOR_LARGE ? SMALL_INCREMENT : LARGE_INCREMENT;
  };

  // Reset visible chars when note changes
  useLayoutEffect(() => {
    if (lastNoteIdRef.current !== noteId) {
      setVisibleChars(INITIAL_CHARS);
      lastNoteIdRef.current = noteId;
    }
  }, [noteId]);

  // Overflow detection for showing scrollbar and gradient
  useLayoutEffect(() => {
    const contentEl = contentRef.current;

    if (!contentEl) {
      setIsOverflowing(false);
      return;
    }

    // Check overflow for gradient display
    const checkOverflow = () => {
      if (contentEl) {
        const overflowing = contentEl.scrollHeight > contentEl.clientHeight;
        setIsOverflowing(overflowing);
      }
    };

    // Initial check with delay to ensure layout is complete
    checkOverflow();
    const timeoutId = setTimeout(checkOverflow, 100);

    // Watch for content changes - guard for browser compatibility
    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(checkOverflow);
      resizeObserver.observe(contentEl);
    }

    return () => {
      clearTimeout(timeoutId);
      if (resizeObserver) {
        resizeObserver.disconnect();
      }
    };
  }, [noteId, displayContent, visibleChars]);

  return (
    <div
      data-toolbar-resident="true"
      className="fixed rounded-xl border border-white/15 bg-gray-900 shadow-2xl"
      style={{
        backgroundColor: 'rgba(17, 24, 39, 0.98)',
        left: `${position.x}px`,
        top: `${position.y}px`,
        zIndex,
        position: 'fixed',
        isolation: 'isolate',
        width: '360px',
        maxHeight: '500px',
        display: 'flex',
        flexDirection: 'column',
      }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {/* Header */}
      <div className="px-4 py-2 border-b border-white/10 flex-shrink-0">
        <p className="text-xs text-blue-400 font-semibold">Preview</p>
      </div>

      {/* Content container - scrollable with max height */}
      <div style={{ position: 'relative', flex: '1 1 auto', overflow: 'hidden' }}>
        <div
          ref={contentRef}
          tabIndex={0}
          style={{
            maxHeight: '360px',
            overflowY: 'auto', // Auto scrollbar (appears when needed)
            overflowX: 'hidden',
            padding: '16px',
            paddingRight: '8px', // Less padding on right for scrollbar
            outline: '2px solid transparent',
            outlineOffset: '2px',
            WebkitOverflowScrolling: 'touch',
          }}
          onFocus={(e) => {
            e.currentTarget.style.outline = '2px solid #3b82f6';
          }}
          onBlur={(e) => {
            e.currentTarget.style.outline = '2px solid transparent';
          }}
          className="text-sm text-white/90 whitespace-pre-line leading-relaxed"
        >
          {status === 'loading' && 'Loading...'}
          {status === 'error' && (
            <span className="text-red-400">Failed to load preview</span>
          )}
          {status === 'ready' && displayContent}
        </div>

        {/* Gradient fade overlay when overflowing */}
        {isOverflowing && (
          <div
            style={{
              position: 'absolute',
              bottom: 0,
              left: 0,
              right: 0,
              height: '60px',
              background: 'linear-gradient(to bottom, transparent, rgba(17, 24, 39, 0.98))',
              pointerEvents: 'none',
            }}
          />
        )}
      </div>

      {/* Action buttons - "Show more" and/or "Open note" */}
      {status === 'ready' && (hasMore || onOpenNote) && (
        <div
          style={{
            position: 'sticky',
            bottom: 0,
            padding: '12px 16px',
            background: 'rgba(17, 24, 39, 0.98)',
            borderTop: '1px solid rgba(255, 255, 255, 0.1)',
            display: 'flex',
            gap: '8px',
          }}
        >
          {/* "Show more ↓" button - incremental expansion (secondary) */}
          {hasMore && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setVisibleChars(prev => prev + getNextIncrement());
              }}
              style={{
                flex: onOpenNote ? '1' : 'auto',
                width: onOpenNote ? 'auto' : '100%',
                padding: '8px 16px',
                background: 'transparent',
                color: '#60a5fa',
                border: '1px solid rgba(59, 130, 246, 0.4)',
                borderRadius: '8px',
                fontSize: '13px',
                fontWeight: 500,
                cursor: 'pointer',
                transition: 'all 0.2s ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'rgba(59, 130, 246, 0.15)';
                e.currentTarget.style.borderColor = 'rgba(59, 130, 246, 0.6)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent';
                e.currentTarget.style.borderColor = 'rgba(59, 130, 246, 0.4)';
              }}
            >
              Show more ↓
            </button>
          )}

          {/* "Open note →" button - always visible when callback provided (primary) */}
          {onOpenNote && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onOpenNote(noteId);
              }}
              style={{
                flex: hasMore ? '1' : 'auto',
                width: hasMore ? 'auto' : '100%',
                padding: '8px 16px',
                background: '#3b82f6',
                color: '#fff',
                border: 'none',
                borderRadius: '8px',
                fontSize: '13px',
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'background 0.2s ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = '#2563eb';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = '#3b82f6';
              }}
            >
              Open note →
            </button>
          )}
        </div>
      )}
    </div>
  );
}
