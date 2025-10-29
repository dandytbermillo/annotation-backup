'use client';

import React, { useState } from 'react';

interface PreviewPopoverProps {
  position: { x: number; y: number };
  content: string;
  status: 'loading' | 'ready' | 'error';
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  onOpen?: () => void;
}

export default function PreviewPopover({
  position,
  content,
  status,
  onMouseEnter,
  onMouseLeave,
  onOpen,
}: PreviewPopoverProps) {
  const [visibleLength, setVisibleLength] = useState(300);
  const [clickCount, setClickCount] = useState(0);

  const handleShowMore = () => {
    const newClickCount = clickCount + 1;
    setClickCount(newClickCount);

    // Incremental disclosure: first 3 clicks +500, then +1000
    if (newClickCount <= 3) {
      setVisibleLength(prev => prev + 500);
    } else {
      setVisibleLength(prev => prev + 1000);
    }
  };

  const displayContent = content.slice(0, visibleLength);
  const hasMore = content.length > visibleLength;

  return (
    <div
      className="fixed pointer-events-auto"
      style={{
        left: `${position.x}px`,
        top: `${position.y}px`,
        zIndex: 2147483647,
      }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <div
        className="rounded-2xl border border-white/15 shadow-2xl overflow-hidden"
        style={{
          backgroundColor: 'rgba(17, 24, 39, 0.98)',
          width: '360px',
          maxHeight: '500px',
        }}
      >
        {/* Header */}
        <div className="px-4 py-2.5 border-b border-white/10">
          <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">
            Preview
          </span>
        </div>

        {/* Content */}
        <div className="relative" style={{ maxHeight: '360px', overflowY: 'auto' }}>
          <div className="px-4 py-3">
            {status === 'loading' && (
              <div className="text-gray-400 text-sm">Loading preview...</div>
            )}
            {status === 'error' && (
              <div className="text-red-400 text-sm">Failed to load preview</div>
            )}
            {status === 'ready' && (
              <div className="text-gray-200 text-sm whitespace-pre-line leading-relaxed">
                {displayContent}
              </div>
            )}
          </div>

          {/* Gradient fade overlay when content overflows */}
          {status === 'ready' && hasMore && (
            <div
              className="absolute bottom-0 left-0 right-0 h-12 pointer-events-none"
              style={{
                background: 'linear-gradient(to bottom, transparent, rgba(17, 24, 39, 0.98))',
              }}
            />
          )}
        </div>

        {/* Actions */}
        <div className="px-4 py-3 border-t border-white/10 flex items-center justify-between gap-2">
          {hasMore && (
            <button
              onClick={handleShowMore}
              className="flex-1 px-3 py-1.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-xs text-gray-300 transition-colors"
            >
              Show more ↓
            </button>
          )}
          {onOpen && (
            <button
              onClick={onOpen}
              className="flex-1 px-3 py-1.5 bg-blue-500/20 hover:bg-blue-500/30 border border-blue-400/30 rounded-lg text-xs text-blue-300 transition-colors"
            >
              Open note →
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
