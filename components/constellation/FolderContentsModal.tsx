'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Eye } from 'lucide-react';
import { ConstellationItem } from '@/types/constellation';
import { getItemIcon } from '@/lib/constellation/constellation-utils';
import PreviewPopover from './PreviewPopover';
import { PREVIEW_HOVER_DELAY_MS, PREVIEW_CLOSE_DELAY_MS } from '@/lib/constants/ui-timings';
import { Z_INDEX } from '@/lib/constants/z-index';

interface FolderContentsModalProps {
  isOpen: boolean;
  folderName: string;
  items: ConstellationItem[];
  onClose: () => void;
  onItemClick: (item: ConstellationItem) => void;
}

export default function FolderContentsModal({
  isOpen,
  folderName,
  items,
  onClose,
  onItemClick,
}: FolderContentsModalProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [position, setPosition] = useState(() => {
    // Initialize with center position
    if (typeof window !== 'undefined') {
      return { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    }
    return { x: 0, y: 0 };
  });
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const modalRef = useRef<HTMLDivElement>(null);

  // Preview state
  const [activePreview, setActivePreview] = useState<{
    itemId: string;
    content: string;
    position: { x: number; y: number };
    status: 'loading' | 'ready' | 'error';
  } | null>(null);
  const previewTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const previewCloseTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isHoveringPreviewRef = useRef(false);

  // Effect for drag event listeners - must be before early return
  useEffect(() => {
    const handleMove = (e: MouseEvent) => {
      if (!isDragging) return;
      setPosition({
        x: e.clientX - dragOffset.x,
        y: e.clientY - dragOffset.y
      });
    };

    const handleUp = () => {
      setIsDragging(false);
    };

    if (isDragging) {
      window.addEventListener('mousemove', handleMove);
      window.addEventListener('mouseup', handleUp);
    }

    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, [isDragging, dragOffset.x, dragOffset.y]);

  // Handler for starting drag
  const handleMouseDown = (e: React.MouseEvent) => {
    // Only start dragging if clicking on the header (not on close button)
    if ((e.target as HTMLElement).tagName === 'BUTTON') return;

    setIsDragging(true);
    const rect = modalRef.current?.getBoundingClientRect();
    if (rect) {
      setDragOffset({
        x: e.clientX - rect.left,
        y: e.clientY - rect.top
      });
    }
  };

  // Preview handlers
  const handleEyeMouseEnter = (e: React.MouseEvent, item: ConstellationItem) => {
    // Clear any pending close timeout
    if (previewCloseTimeoutRef.current) {
      clearTimeout(previewCloseTimeoutRef.current);
      previewCloseTimeoutRef.current = null;
    }

    // Don't show preview for folders
    if (item.isFolder) return;

    // Set loading state immediately
    const eyeButton = e.currentTarget as HTMLElement;
    const rect = eyeButton.getBoundingClientRect();
    const modalRect = modalRef.current?.getBoundingClientRect();

    if (!modalRect) return;

    // Position preview to the right of the modal with a gap
    const gap = 15;
    const previewX = modalRect.right + gap;
    const previewY = rect.top;

    // Start delay before showing preview
    previewTimeoutRef.current = setTimeout(async () => {
      setActivePreview({
        itemId: item.id,
        content: '',
        position: { x: previewX, y: previewY },
        status: 'loading'
      });

      // Fetch content from document_saves table
      try {
        const response = await fetch(`/api/items/${item.id}/content`);
        const data = await response.json();

        if (data.success && data.content) {
          setActivePreview({
            itemId: item.id,
            content: data.content,
            position: { x: previewX, y: previewY },
            status: 'ready'
          });
        } else {
          // Fallback if no content found
          setActivePreview({
            itemId: item.id,
            content: `Content preview for ${item.title}\n\nThis is where the file content would be displayed.`,
            position: { x: previewX, y: previewY },
            status: 'ready'
          });
        }
      } catch (error) {
        setActivePreview({
          itemId: item.id,
          content: '',
          position: { x: previewX, y: previewY },
          status: 'error'
        });
      }
    }, PREVIEW_HOVER_DELAY_MS);
  };

  const handleEyeMouseLeave = () => {
    // Clear pending preview
    if (previewTimeoutRef.current) {
      clearTimeout(previewTimeoutRef.current);
      previewTimeoutRef.current = null;
    }

    // Delay closing to allow moving to preview popover
    if (!isHoveringPreviewRef.current) {
      previewCloseTimeoutRef.current = setTimeout(() => {
        if (!isHoveringPreviewRef.current) {
          setActivePreview(null);
        }
      }, PREVIEW_CLOSE_DELAY_MS);
    }
  };

  const handlePreviewMouseEnter = () => {
    isHoveringPreviewRef.current = true;
    if (previewCloseTimeoutRef.current) {
      clearTimeout(previewCloseTimeoutRef.current);
      previewCloseTimeoutRef.current = null;
    }
  };

  const handlePreviewMouseLeave = () => {
    isHoveringPreviewRef.current = false;
    previewCloseTimeoutRef.current = setTimeout(() => {
      setActivePreview(null);
    }, PREVIEW_CLOSE_DELAY_MS);
  };

  if (!isOpen) return null;

  // Filter items based on search query
  const filteredItems = items.filter(item =>
    item.title.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Sort by type (folders first) then alphabetically
  const sortedItems = [...filteredItems].sort((a, b) => {
    // Folders first
    if (a.isFolder && !b.isFolder) return -1;
    if (!a.isFolder && b.isFolder) return 1;
    // Then alphabetically
    return a.title.localeCompare(b.title);
  });

  return (
    <>
      {/* Backdrop - no blur, just slight darkening, allows clicks to pass through to constellation */}
      <div
        className="fixed inset-0 bg-black/20 pointer-events-none"
        style={{ zIndex: Z_INDEX.CONSTELLATION }}
      />

      {/* Modal */}
      <div
        ref={modalRef}
        className="fixed w-full max-w-lg pointer-events-auto"
        style={{
          zIndex: Z_INDEX.CONSTELLATION,
          left: `${position.x}px`,
          top: `${position.y}px`,
          transform: 'translate(-50%, -50%)',
          cursor: isDragging ? 'grabbing' : 'default'
        }}
      >
        <div
          className="rounded-2xl border border-white/20 shadow-2xl overflow-hidden"
          style={{ backgroundColor: 'rgba(17, 24, 39, 0.98)' }}
        >
          {/* Header - Draggable */}
          <div
            className="px-4 py-3 border-b border-white/10 cursor-grab active:cursor-grabbing select-none"
            onMouseDown={handleMouseDown}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="flex-shrink-0">📁</span>
                <span className="font-medium text-white text-sm truncate">{folderName}</span>
              </div>
              <button
                onClick={onClose}
                className="text-gray-400 hover:text-white text-xl leading-none transition-colors"
              >
                ×
              </button>
            </div>
          </div>

          {/* Search Bar */}
          <div className="px-4 py-3 border-b border-white/10">
            <input
              type="text"
              placeholder="Search items..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-400/20 placeholder-gray-500"
            />
          </div>

          {/* Items List */}
          <div className="p-3 max-h-96 overflow-y-auto">
            {sortedItems.length === 0 ? (
              <div className="text-center text-gray-500 text-sm py-4">
                {searchQuery ? 'No items found' : 'Empty folder'}
              </div>
            ) : (
              <div className="space-y-1">
                {sortedItems.map((item) => (
                  <div key={item.id} className="group relative">
                    <button
                      onClick={() => {
                        onItemClick(item);
                        onClose();
                      }}
                      className="w-full flex items-center gap-2 px-2 py-1.5 hover:bg-white/5 rounded text-sm transition-colors text-left"
                    >
                      <span className="flex-shrink-0">{getItemIcon(item)}</span>
                      <span className="truncate text-gray-200 flex-1">{item.title}</span>

                      {/* Eye icon - only for non-folder items */}
                      {!item.isFolder && (
                        <button
                          onMouseEnter={(e) => handleEyeMouseEnter(e, item)}
                          onMouseLeave={handleEyeMouseLeave}
                          onClick={(e) => {
                            e.stopPropagation();
                            // Eye click could pin the preview or open the item
                          }}
                          className="opacity-0 group-hover:opacity-100 transition-opacity hover:bg-white/10 rounded p-0.5 cursor-pointer"
                          title="Hover to preview"
                        >
                          <Eye className="w-3.5 h-3.5 text-blue-400" />
                        </button>
                      )}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="px-4 py-2 border-t border-white/10">
            <div className="flex items-center justify-between text-xs text-gray-400">
              <span>{items.length} {items.length === 1 ? 'item' : 'items'}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Preview Popover */}
      {activePreview && (
        <PreviewPopover
          position={activePreview.position}
          content={activePreview.content}
          status={activePreview.status}
          onMouseEnter={handlePreviewMouseEnter}
          onMouseLeave={handlePreviewMouseLeave}
          onOpen={() => {
            const item = items.find(i => i.id === activePreview.itemId);
            if (item) {
              onItemClick(item);
              onClose();
            }
          }}
        />
      )}
    </>
  );
}
