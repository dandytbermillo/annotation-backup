'use client';

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { cn } from '@/lib/utils';
import type { CanvasToolType } from '@/lib/hooks/annotation/use-canvas-pointer-handlers';
import { NoteSwitcherPopover } from './note-switcher-popover';
import type { OpenNoteItem } from './note-switcher-item';

// ============================================================================
// TYPES
// ============================================================================

export type CanvasTool = CanvasToolType;
export type ComponentType = 'calculator' | 'timer' | 'sticky-note' | 'counter';

export interface CanvasControlCenterProps {
  activeTool?: CanvasTool;
  onToolChange?: (tool: CanvasTool) => void;
  zoom?: number;
  minZoom?: number;
  maxZoom?: number;
  onZoomChange?: (zoom: number) => void;
  gridEnabled?: boolean;
  onGridToggle?: () => void;
  minimapEnabled?: boolean;
  onMinimapToggle?: () => void;
  onAddComponent?: (type: ComponentType) => void;
  onAddPanel?: () => void;
  onToggleOrganize?: () => void;
  visible?: boolean;
  className?: string;

  // Floating toolbar integration - transferred from floating-toolbar.tsx
  /** Callback to create a new note */
  onCreateNote?: () => void;
  /** Callback to open recent notes panel */
  onOpenRecent?: () => void;
  /** Callback to toggle constellation/canvas view */
  onToggleCanvas?: () => void;
  /** Whether constellation panel is currently visible */
  showConstellationPanel?: boolean;
  /** Callback to open component picker panel (different from direct add) */
  onOpenComponentPicker?: () => void;

  // Note switcher integration (for dock Notes button)
  /** Open notes for the switcher popover */
  openNotes?: OpenNoteItem[];
  /** Whether the note switcher popover is currently open */
  isNoteSwitcherOpen?: boolean;
  /** Callback to toggle the note switcher popover */
  onToggleNoteSwitcher?: () => void;
  /** Callback when a note is selected in the switcher */
  onSelectNote?: (noteId: string) => void;
  /** Callback when a note is closed from the switcher */
  onCloseNote?: (noteId: string) => void;
  /** Callback to center on a note */
  onCenterNote?: (noteId: string) => void;
  /** Whether notes are currently loading */
  isNotesLoading?: boolean;
}

// ============================================================================
// CONSTANTS - Match iOS Control Center reference design
// ============================================================================

const TILE_SIZE = 90; // px - reduced by 25% from 120px
const GAP = 10; // px - gap between tiles
const Z_INDEX_TOGGLE = 99999;
const Z_INDEX_PANEL = 99998;

// ============================================================================
// COMPONENT
// ============================================================================

export function CanvasControlCenter({
  activeTool = 'select',
  onToolChange,
  zoom = 1,
  minZoom = 0.25,
  maxZoom = 2,
  onZoomChange,
  gridEnabled = false,
  onGridToggle,
  minimapEnabled = true,
  onMinimapToggle,
  onAddComponent,
  onAddPanel,
  onToggleOrganize,
  visible = true,
  className,
  // Floating toolbar integration
  onCreateNote,
  onOpenRecent,
  onToggleCanvas,
  showConstellationPanel,
  onOpenComponentPicker,
  // Note switcher integration
  openNotes = [],
  isNoteSwitcherOpen = false,
  onToggleNoteSwitcher,
  onSelectNote,
  onCloseNote,
  onCenterNote,
  isNotesLoading = false,
}: CanvasControlCenterProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isDraggingZoom, setIsDraggingZoom] = useState(false);
  const zoomTrackRef = useRef<HTMLDivElement>(null);
  const controlCenterRef = useRef<HTMLDivElement>(null);

  const zoomPercent = Math.round(zoom * 100);

  const zoomToSliderPosition = useCallback(
    (z: number) => ((z - minZoom) / (maxZoom - minZoom)) * 100,
    [minZoom, maxZoom]
  );

  const sliderPositionToZoom = useCallback(
    (position: number) => minZoom + (position / 100) * (maxZoom - minZoom),
    [minZoom, maxZoom]
  );

  const sliderPosition = zoomToSliderPosition(zoom);

  const toggleOpen = useCallback(() => setIsOpen((prev) => !prev), []);
  const close = useCallback(() => setIsOpen(false), []);

  const handleToolSelect = useCallback(
    (tool: CanvasTool) => {
      onToolChange?.(tool);
      setTimeout(close, 150);
    },
    [onToolChange, close]
  );

  const handleAddComponent = useCallback(
    (type: ComponentType) => {
      onAddComponent?.(type);
      setTimeout(close, 150);
    },
    [onAddComponent, close]
  );

  const handleZoomClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!zoomTrackRef.current) return;
      const rect = zoomTrackRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const percentage = Math.max(0, Math.min(100, (x / rect.width) * 100));
      onZoomChange?.(sliderPositionToZoom(percentage));
    },
    [sliderPositionToZoom, onZoomChange]
  );

  const handleZoomDrag = useCallback(
    (e: MouseEvent) => {
      if (!isDraggingZoom || !zoomTrackRef.current) return;
      const rect = zoomTrackRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const percentage = Math.max(0, Math.min(100, (x / rect.width) * 100));
      onZoomChange?.(sliderPositionToZoom(percentage));
    },
    [isDraggingZoom, sliderPositionToZoom, onZoomChange]
  );

  const handleZoomDragEnd = useCallback(() => setIsDraggingZoom(false), []);

  // Drag listeners
  useEffect(() => {
    if (isDraggingZoom) {
      document.addEventListener('mousemove', handleZoomDrag);
      document.addEventListener('mouseup', handleZoomDragEnd);
      return () => {
        document.removeEventListener('mousemove', handleZoomDrag);
        document.removeEventListener('mouseup', handleZoomDragEnd);
      };
    }
  }, [isDraggingZoom, handleZoomDrag, handleZoomDragEnd]);

  // Click outside to close Control Center
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;

      // Close Control Center if clicking outside
      if (
        isOpen &&
        controlCenterRef.current &&
        !controlCenterRef.current.contains(target) &&
        !target.closest('[data-cc-toggle]')
      ) {
        close();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen, close]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Escape closes Control Center
      if (e.key === 'Escape' && isOpen) {
        close();
      }
      // Backtick toggles Control Center (when not in input)
      if (
        e.key === '`' &&
        !(e.target as HTMLElement).matches('input, textarea, [contenteditable]')
      ) {
        toggleOpen();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, close, toggleOpen]);

  // Handler for notes button click - toggles workspace toolbar's popover
  const handleNotesClick = useCallback(() => {
    onToggleNoteSwitcher?.();
    // Close Control Center if open
    if (isOpen) close();
  }, [isOpen, close, onToggleNoteSwitcher]);

  if (!visible) return null;

  return (
    <>
      {/* Dock Container */}
      <div
        className={className}
        style={{
          position: 'fixed',
          bottom: 24,
          left: '50%',
          transform: 'translateX(-50%)',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: 8,
          borderRadius: 28,
          zIndex: Z_INDEX_TOGGLE,
          background: 'rgba(18, 18, 22, 0.85)',
          backdropFilter: 'blur(30px) saturate(180%)',
          WebkitBackdropFilter: 'blur(30px) saturate(180%)',
          border: '1px solid rgba(255,255,255,0.1)',
          boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
        }}
      >
        {/* Notes Button */}
        <button
          data-notes-toggle
          onClick={handleNotesClick}
          title="Open Notes"
          style={{
            position: 'relative',
            width: 48,
            height: 48,
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            transition: 'all 0.2s ease-out',
            border: '1px solid rgba(255,255,255,0.1)',
            background: isNoteSwitcherOpen
              ? 'rgb(99, 102, 241)'
              : 'rgba(39, 39, 42, 0.8)',
            color: 'white',
            boxShadow: isNoteSwitcherOpen
              ? '0 4px 20px rgba(99,102,241,0.4)'
              : 'none',
          }}
        >
          <span style={{ fontSize: 20 }}>📄</span>
          {/* Badge */}
          {openNotes.length > 0 && (
            <span
              style={{
                position: 'absolute',
                top: -4,
                right: -4,
                minWidth: 20,
                height: 20,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: 10,
                padding: '0 6px',
                fontSize: 11,
                fontWeight: 700,
                background: isNoteSwitcherOpen ? 'white' : 'rgb(99, 102, 241)',
                color: isNoteSwitcherOpen ? 'rgb(99, 102, 241)' : 'white',
                boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
              }}
            >
              {openNotes.length > 99 ? '99+' : openNotes.length}
            </span>
          )}
        </button>

        {/* Control Center Button */}
        <button
          data-cc-toggle
          onClick={toggleOpen}
          title="Canvas Controls (`)"
          style={{
            width: 48,
            height: 48,
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            transition: 'all 0.2s ease-out',
            border: '1px solid rgba(255,255,255,0.1)',
            background: isOpen
              ? 'rgb(99, 102, 241)'
              : 'rgba(39, 39, 42, 0.8)',
            color: 'white',
            boxShadow: isOpen
              ? '0 4px 20px rgba(99,102,241,0.4)'
              : 'none',
          }}
        >
          <span style={{ fontSize: 20 }}>⚡</span>
        </button>
      </div>

      {/* Note Switcher Popover */}
      {isNoteSwitcherOpen && (
        <div
          style={{
            position: 'fixed',
            bottom: 100,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: Z_INDEX_PANEL + 1,
          }}
        >
          <NoteSwitcherPopover
            notes={openNotes}
            onSelectNote={(noteId) => {
              onSelectNote?.(noteId);
              onToggleNoteSwitcher?.();
            }}
            onCloseNote={(noteId) => onCloseNote?.(noteId)}
            onCenterNote={onCenterNote ? (noteId) => onCenterNote(noteId) : undefined}
            onCreateNote={() => {
              onCreateNote?.();
              onToggleNoteSwitcher?.();
            }}
            onClose={() => onToggleNoteSwitcher?.()}
            isLoading={isNotesLoading}
          />
        </div>
      )}

      {/* Control Center Panel */}
      <div
        ref={controlCenterRef}
        style={{
          position: 'fixed',
          bottom: 100,
          left: '50%',
          transform: `translateX(-50%) translateY(${isOpen ? 0 : 20}px)`,
          opacity: isOpen ? 1 : 0,
          visibility: isOpen ? 'visible' : 'hidden',
          pointerEvents: isOpen ? 'auto' : 'none',
          zIndex: Z_INDEX_PANEL,
          background: 'rgba(18, 18, 22, 0.95)',
          backdropFilter: 'blur(50px) saturate(200%)',
          WebkitBackdropFilter: 'blur(50px) saturate(200%)',
          borderRadius: 24,
          padding: 18,
          border: '1px solid rgba(255,255,255,0.1)',
          boxShadow: `
            0 30px 60px rgba(0,0,0,0.6),
            0 0 0 1px rgba(255,255,255,0.06) inset
          `,
          transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
        }}
      >
        {/* Grid: 4 columns x 4 rows */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(4, ${TILE_SIZE}px)`,
            gridTemplateRows: `repeat(4, ${TILE_SIZE}px)`,
            gap: GAP,
          }}
        >
          {/* Row 1: Select, Pan, Components (2x2 spanning rows 1-2) */}

          {/* Select Tool */}
          <Tile
            active={activeTool === 'select'}
            onClick={() => handleToolSelect('select')}
            icon="👆"
            label="Select"
          />

          {/* Pan Tool */}
          <Tile
            active={activeTool === 'pan'}
            onClick={() => handleToolSelect('pan')}
            icon="🖐️"
            label="Pan"
          />

          {/* Components Group (2x2) */}
          <div
            style={{
              gridColumn: 'span 2',
              gridRow: 'span 2',
              background: 'rgba(39, 39, 42, 0.8)',
              borderRadius: 16,
              padding: 10,
              border: '1px solid rgba(255,255,255,0.06)',
              display: 'grid',
              gridTemplateColumns: 'repeat(2, 1fr)',
              gridTemplateRows: 'repeat(2, 1fr)',
              gap: 8,
            }}
          >
            <GroupItem icon="🧮" title="Calculator" onClick={() => handleAddComponent('calculator')} />
            <GroupItem icon="⏱️" title="Timer" onClick={() => handleAddComponent('timer')} />
            <GroupItem icon="📝" title="Sticky Note" onClick={() => handleAddComponent('sticky-note')} />
            <GroupItem icon="🔢" title="Counter" onClick={() => handleAddComponent('counter')} />
          </div>

          {/* Row 2: +Note, Recent (Components spans into this row) */}

          {/* + Note - Create new note */}
          <Tile
            onClick={() => {
              onCreateNote?.();
              setTimeout(close, 150);
            }}
            icon="📄"
            label="+ Note"
          />

          {/* Recent - Open recent notes */}
          <Tile
            onClick={() => {
              onOpenRecent?.();
              setTimeout(close, 150);
            }}
            icon="🕒"
            label="Recent"
          />

          {/* Row 3: Canvas, Component, Organize, Panel */}

          {/* Canvas - Toggle constellation view */}
          <Tile
            active={showConstellationPanel}
            onClick={() => {
              onToggleCanvas?.();
              setTimeout(close, 150);
            }}
            icon="🌌"
            label="Canvas"
          />

          {/* Component Picker - Open component panel */}
          <Tile
            onClick={() => {
              onOpenComponentPicker?.();
              setTimeout(close, 150);
            }}
            icon="🧩"
            label="Component"
          />

          {/* Organize */}
          <Tile
            onClick={() => {
              onToggleOrganize?.();
              setTimeout(close, 150);
            }}
            icon="📁"
            label="Organize"
          />

          {/* Add Panel */}
          <Tile
            onClick={() => {
              onAddPanel?.();
              setTimeout(close, 150);
            }}
            icon="➕"
            label="Panel"
          />

          {/* Row 4: Zoom (2x1), Grid, Map */}

          {/* Zoom Slider (spans 2 columns) */}
          <div
            style={{
              gridColumn: 'span 2',
              background: 'rgba(39, 39, 42, 0.8)',
              borderRadius: 16,
              padding: 14,
              border: '1px solid rgba(255,255,255,0.06)',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <span style={{ fontSize: 20 }}>🔍</span>
              <span style={{ fontSize: 12, color: 'rgba(161, 161, 170, 1)', fontWeight: 500 }}>
                Zoom
              </span>
              <span
                style={{
                  marginLeft: 'auto',
                  fontSize: 14,
                  color: 'white',
                  fontWeight: 600,
                }}
              >
                {zoomPercent}%
              </span>
            </div>
            <div
              ref={zoomTrackRef}
              onClick={handleZoomClick}
              style={{
                width: '100%',
                height: 8,
                background: 'rgba(63, 63, 70, 0.8)',
                borderRadius: 4,
                position: 'relative',
                cursor: 'pointer',
              }}
            >
              <div
                style={{
                  position: 'absolute',
                  left: 0,
                  top: 0,
                  height: '100%',
                  width: `${sliderPosition}%`,
                  background: 'rgb(99, 102, 241)',
                  borderRadius: 4,
                  transition: 'width 0.1s',
                }}
              />
              <div
                onMouseDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setIsDraggingZoom(true);
                }}
                style={{
                  position: 'absolute',
                  top: '50%',
                  left: `${sliderPosition}%`,
                  transform: 'translate(-50%, -50%)',
                  width: 18,
                  height: 18,
                  background: 'white',
                  borderRadius: '50%',
                  boxShadow: '0 2px 10px rgba(0,0,0,0.4)',
                  cursor: 'grab',
                }}
              />
            </div>
          </div>

          {/* Grid Toggle */}
          <Tile
            active={gridEnabled}
            onClick={onGridToggle}
            icon="⊞"
            label="Grid"
          />

          {/* Minimap Toggle */}
          <Tile
            active={minimapEnabled}
            onClick={onMinimapToggle}
            icon="🗺️"
            label="Map"
          />
        </div>
      </div>
    </>
  );
}

// ============================================================================
// SUB-COMPONENTS
// ============================================================================

interface TileProps {
  icon: string;
  label: string;
  active?: boolean;
  onClick?: () => void;
}

function Tile({ icon, label, active, onClick }: TileProps) {
  return (
    <div
      onClick={onClick}
      style={{
        width: TILE_SIZE,
        height: TILE_SIZE,
        borderRadius: 16,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        transition: 'all 0.15s ease-out',
        border: active
          ? '1px solid rgba(99,102,241,0.3)'
          : '1px solid rgba(255,255,255,0.06)',
        background: active
          ? 'rgb(99, 102, 241)'
          : 'rgba(39, 39, 42, 0.8)',
        boxShadow: active
          ? '0 0 30px rgba(99,102,241,0.5)'
          : 'none',
      }}
      onMouseEnter={(e) => {
        if (!active) {
          e.currentTarget.style.background = 'rgba(52, 52, 56, 0.9)';
          e.currentTarget.style.transform = 'scale(1.02)';
        }
      }}
      onMouseLeave={(e) => {
        if (!active) {
          e.currentTarget.style.background = 'rgba(39, 39, 42, 0.8)';
          e.currentTarget.style.transform = 'scale(1)';
        }
      }}
      onMouseDown={(e) => {
        e.currentTarget.style.transform = 'scale(0.98)';
      }}
      onMouseUp={(e) => {
        e.currentTarget.style.transform = active ? 'scale(1)' : 'scale(1.02)';
      }}
    >
      <span style={{ fontSize: 32, marginBottom: 6 }}>{icon}</span>
      <span
        style={{
          fontSize: 12,
          fontWeight: 600,
          color: active ? 'white' : 'rgba(161, 161, 170, 1)',
        }}
      >
        {label}
      </span>
    </div>
  );
}

interface GroupItemProps {
  icon: string;
  title: string;
  onClick?: () => void;
}

function GroupItem({ icon, title, onClick }: GroupItemProps) {
  return (
    <div
      onClick={(e) => {
        e.stopPropagation();
        onClick?.();
      }}
      title={title}
      style={{
        background: 'rgba(63, 63, 70, 0.6)',
        borderRadius: 12,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        transition: 'all 0.15s',
        fontSize: 26,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = 'rgba(82, 82, 91, 0.8)';
        e.currentTarget.style.transform = 'scale(1.05)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'rgba(63, 63, 70, 0.6)';
        e.currentTarget.style.transform = 'scale(1)';
      }}
      onMouseDown={(e) => {
        e.currentTarget.style.transform = 'scale(0.95)';
      }}
      onMouseUp={(e) => {
        e.currentTarget.style.transform = 'scale(1.05)';
      }}
    >
      {icon}
    </div>
  );
}

export default CanvasControlCenter;
