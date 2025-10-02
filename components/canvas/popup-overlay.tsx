'use client';

import React, { useEffect, useRef, useMemo, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { CoordinateBridge } from '@/lib/utils/coordinate-bridge';
import { ConnectionLineAdapter, PopupState } from '@/lib/rendering/connection-line-adapter';
import { Z_INDEX, getPopupZIndex } from '@/lib/constants/z-index';
import { useLayer } from '@/components/canvas/layer-provider';
import { X, Folder, FileText, Eye } from 'lucide-react';
import { VirtualList } from '@/components/canvas/VirtualList';
import { Tooltip, TooltipContent, TooltipPortal, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { buildBranchPreview } from '@/lib/utils/branch-preview';
import { debugLog } from '@/lib/utils/debug-logger';
import { getUIResourceManager } from '@/lib/ui/resource-manager';
import '@/styles/popup-overlay.css';
import { ensureFloatingOverlayHost, FLOATING_OVERLAY_HOST_ID } from '@/lib/utils/overlay-host';

const IDENTITY_TRANSFORM = { x: 0, y: 0, scale: 1 } as const;

// Auto-scroll configuration - all values are configurable, not hardcoded
const AUTO_SCROLL_CONFIG = {
  ENABLED: process.env.NEXT_PUBLIC_DISABLE_AUTOSCROLL !== 'true', // Feature flag
  THRESHOLD: parseInt(process.env.NEXT_PUBLIC_AUTOSCROLL_THRESHOLD || '80'), // Distance from edge (px)
  MIN_SPEED: parseInt(process.env.NEXT_PUBLIC_AUTOSCROLL_MIN_SPEED || '5'), // Min scroll speed (px/frame)
  MAX_SPEED: parseInt(process.env.NEXT_PUBLIC_AUTOSCROLL_MAX_SPEED || '15'), // Max scroll speed (px/frame)
  ACCELERATION: 'ease-out' as const, // Speed curve type
  DEBUG: process.env.NODE_ENV === 'development' && process.env.NEXT_PUBLIC_DEBUG_AUTOSCROLL === 'true'
} as const;

// Auto-scroll state interface
interface AutoScrollState {
  isActive: boolean;
  velocity: { x: number; y: number };
  threshold: number;
  minSpeed: number;
  maxSpeed: number;
}

interface PopupData extends PopupState {
  id: string;
  folder: any; // TreeNode from existing implementation
  canvasPosition: { x: number; y: number };
  parentId?: string;
  level: number;
  isDragging?: boolean;
  isLoading?: boolean;
  height?: number;
}

interface PopupOverlayProps {
  popups: Map<string, PopupData>;
  draggingPopup: string | null;
  onClosePopup: (id: string) => void;
  onDragStart?: (id: string, event: React.MouseEvent) => void;
  onHoverFolder?: (folder: any, event: React.MouseEvent, parentPopupId: string, isPersistent?: boolean) => void;
  onLeaveFolder?: (folderId?: string, parentPopoverId?: string) => void;
  onPopupHover?: (folderId: string, parentPopupId?: string) => void; // Cancel close timeout when hovering popup
  sidebarOpen?: boolean; // Track sidebar state to recalculate bounds
}

type PopupChildNode = {
  id: string;
  type?: string;
  name?: string;
  title?: string;
  parentId?: string;
  icon?: string | null;
  color?: string | null;
  hasChildren?: boolean;
};

function isFolderNode(node: PopupChildNode | null | undefined): boolean {
  if (!node || !node.type) return false;
  return node.type.toLowerCase() === 'folder';
}

function isNoteLikeNode(node: PopupChildNode | null | undefined): boolean {
  if (!node) return false;
  return !isFolderNode(node);
}

type PreviewStatus = 'idle' | 'loading' | 'ready' | 'error';

interface PreviewEntry {
  activeChildId: string | null;
  entries: Record<string, {
    status: PreviewStatus;
    content?: unknown;
    previewText?: string;
    error?: string;
    requestedAt?: number;
  }>;
}

const TOOLTIP_PREVIEW_MAX_LENGTH = Number.MAX_SAFE_INTEGER; // allow full content inside scrollable tooltip

/**
 * PopupOverlay - React component for the popup layer
 * Renders popups and connection lines in a separate layer above the notes canvas
 */
export const PopupOverlay: React.FC<PopupOverlayProps> = ({
  popups,
  draggingPopup,
  onClosePopup,
  onDragStart,
  onHoverFolder,
  onLeaveFolder,
  onPopupHover,
  sidebarOpen, // Accept sidebar state
}) => {
  const multiLayerEnabled = true;
  const [previewState, setPreviewState] = useState<Record<string, PreviewEntry>>({});
  const previewStateRef = useRef(previewState);
  const previewControllersRef = useRef<Map<string, AbortController>>(new Map());
  useEffect(() => {
    previewStateRef.current = previewState;
  }, [previewState]);

  useEffect(() => {
    return () => {
      previewControllersRef.current.forEach((controller) => {
        try { controller.abort(); } catch {}
      });
      previewControllersRef.current.clear();
    };
  }, []);

  const fetchPreview = useCallback(async (popupId: string, childId: string) => {
    const controllerKey = `${popupId}:${childId}`;
    const existingController = previewControllersRef.current.get(controllerKey);
    if (existingController) {
      try { existingController.abort(); } catch {}
    }

    const controller = new AbortController();
    previewControllersRef.current.set(controllerKey, controller);

    try {
      const response = await fetch(`/api/items/${childId}`, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
        },
        credentials: 'same-origin',
        cache: 'no-store',
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`Request failed with status ${response.status}`);
      }
      const data = await response.json();
      const content = data?.item?.content ?? null;
      const contentText = data?.item?.contentText ?? '';
      const previewText = buildBranchPreview(content, contentText || '', TOOLTIP_PREVIEW_MAX_LENGTH);

      getUIResourceManager().enqueueLowPriority(() => {
        debugLog('PopupOverlay', 'preview_fetch_success', {
          popupId,
          childId,
          hasContent: Boolean(content),
          hasContentText: Boolean(contentText && contentText.trim().length),
          contentType: typeof content,
          previewLength: previewText.length,
        });
      });

      setPreviewState(prev => {
        const entry = prev[popupId] ?? { activeChildId: null, entries: {} };
        return {
          ...prev,
          [popupId]: {
            activeChildId: entry.activeChildId ?? childId,
            entries: {
              ...entry.entries,
              [childId]: {
                status: 'ready',
                content: content ?? contentText ?? null,
                previewText,
                requestedAt: undefined,
              },
            },
          },
        };
      });
    } catch (error: any) {
      if (error?.name === 'AbortError') {
        return;
      }
      getUIResourceManager().enqueueLowPriority(() => {
        debugLog('PopupOverlay', 'preview_fetch_error', {
          popupId,
          childId,
          message: error?.message ?? 'Unknown error',
        });
      });
      setPreviewState(prev => {
        const entry = prev[popupId] ?? { activeChildId: null, entries: {} };
        return {
          ...prev,
          [popupId]: {
            activeChildId: entry.activeChildId ?? childId,
            entries: {
              ...entry.entries,
              [childId]: {
                status: 'error',
                error: error?.message ?? 'Failed to load preview',
                previewText: entry.entries[childId]?.previewText,
                requestedAt: undefined,
              },
            },
          },
        };
      });
    } finally {
      previewControllersRef.current.delete(controllerKey);
    }
  }, []);

  const requestPreview = useCallback((popupId: string, child: PopupChildNode | null) => {
    if (!child) {
      setPreviewState(prev => {
        const entry = prev[popupId];
        if (!entry || entry.activeChildId === null) {
          return prev;
        }
        return {
          ...prev,
          [popupId]: {
            ...entry,
            activeChildId: null,
          },
        };
      });
      return;
    }

    if (!isNoteLikeNode(child)) {
      setPreviewState(prev => {
        const entry = prev[popupId];
        if (!entry || entry.activeChildId === child.id) {
          return prev;
        }
        return {
          ...prev,
          [popupId]: {
            ...entry,
            activeChildId: child.id,
          },
        };
      });
      return;
    }

    const latestEntry = previewStateRef.current[popupId];
    const latestChildEntry = latestEntry?.entries?.[child.id];
    const now = Date.now();
    const loadingTooLong = latestChildEntry?.status === 'loading'
      && typeof latestChildEntry.requestedAt === 'number'
      && now - latestChildEntry.requestedAt > 1500;
    const shouldFetch = !latestChildEntry
      || latestChildEntry.status === 'error'
      || latestChildEntry.status === 'idle'
      || loadingTooLong;

    getUIResourceManager().enqueueLowPriority(() => {
      debugLog('PopupOverlay', 'preview_request', {
        popupId,
        childId: child.id,
        shouldFetch,
        existingStatus: latestChildEntry?.status ?? 'none',
        loadingTooLong,
      });
    });

    setPreviewState(prev => {
      const entry = prev[popupId] ?? { activeChildId: null, entries: {} };
      const prevChild = entry.entries[child.id];
      const updatedEntries = {
        ...entry.entries,
        [child.id]: shouldFetch
          ? {
              status: 'loading',
              content: prevChild?.content,
              previewText: prevChild?.previewText,
              error: undefined,
              requestedAt: now,
            }
          : (prevChild || { status: 'loading' }),
      };

      return {
        ...prev,
        [popupId]: {
          activeChildId: child.id,
          entries: updatedEntries,
        },
      };
    });

    if (shouldFetch) {
      fetchPreview(popupId, child.id);
    } else if (latestChildEntry?.previewText) {
      getUIResourceManager().enqueueLowPriority(() => {
        debugLog('PopupOverlay', 'preview_cache_hit', {
          popupId,
          childId: child.id,
          status: latestChildEntry.status,
        });
      });
    }
  }, [fetchPreview]);

  const renderPopupChildRow = (
    popupId: string,
    {
      previewEntry,
      activePreview,
      isPanning: rowIsPanning,
      onHoverFolder: rowHoverFolder,
      onLeaveFolder: rowLeaveFolder,
    }: {
      previewEntry?: PreviewEntry;
      activePreview?: { status: PreviewStatus; content?: unknown; error?: string };
      isPanning: boolean;
      onHoverFolder?: (folder: any, event: React.MouseEvent, parentPopupId: string, isPersistent?: boolean) => void;
      onLeaveFolder?: (folderId?: string, parentPopoverId?: string) => void;
    }
  ) => (child: PopupChildNode) => {
    const noteLike = isNoteLikeNode(child);
    const folderLike = isFolderNode(child);
    const isActivePreview = noteLike && previewEntry?.activeChildId === child.id;

    const triggerPreview = () => {
      if (rowIsPanning || !noteLike) return;
      requestPreview(popupId, child);
    };

    const handleFolderHover = (event: React.MouseEvent, persistent = false) => {
      if (rowIsPanning || !folderLike) return;
      rowHoverFolder?.(child, event, popupId, persistent);
    };

    const childPreviewEntry = noteLike ? previewEntry?.entries?.[child.id] : undefined;
    const tooltipStatus = childPreviewEntry?.status
      ?? (isActivePreview ? activePreview?.status : undefined)
      ?? 'idle';
    const tooltipError = childPreviewEntry?.error
      ?? (isActivePreview ? activePreview?.error : undefined);
    const previewText = childPreviewEntry?.previewText
      ?? (isActivePreview ? activePreview?.previewText : undefined)
      ?? '';

    let tooltipBody: React.ReactNode;
    if (tooltipStatus === 'loading' && previewText) {
      tooltipBody = (
        <span className="text-gray-100 whitespace-pre-line leading-relaxed">
          {previewText}
          <span className="block pt-1 text-[10px] uppercase tracking-wide text-gray-500">
            Refreshing preview…
          </span>
        </span>
      );
    } else if (tooltipStatus === 'loading') {
      tooltipBody = <span className="text-gray-400">Loading preview…</span>;
    } else if (tooltipStatus === 'error') {
      tooltipBody = <span className="text-red-400">{tooltipError ?? 'Failed to load preview.'}</span>;
    } else if (previewText) {
      tooltipBody = (
        <span className="text-gray-100 whitespace-pre-line leading-relaxed">
          {previewText}
        </span>
      );
    } else if (tooltipStatus === 'ready') {
      tooltipBody = <span className="text-gray-400">No preview content.</span>;
    } else {
      tooltipBody = <span className="text-gray-400">Hover to load preview.</span>;
    }

    const iconVisibilityClass = isActivePreview
      ? 'opacity-100'
      : 'opacity-0 group-hover:opacity-100';

    return (
      <div
        key={child.id}
        className={`group px-3 py-2 cursor-pointer flex items-center justify-between text-sm transition-colors ${
          isActivePreview ? 'bg-gray-700/70 text-white' : 'text-gray-200'
        }`}
        style={{ transition: rowIsPanning ? 'none' : 'background-color 0.2s' }}
        onMouseEnter={(event) => {
          if (noteLike) {
            triggerPreview();
          }
          // Removed folder row hover - only eye icon should trigger folder hover
        }}
        onMouseLeave={() => {
          // Removed folder row leave handler - only eye icon controls this
        }}
        onFocus={() => {
          if (noteLike) {
            triggerPreview();
          }
        }}
      >
        <div className="flex items-center gap-2 flex-1 min-w-0">
          {folderLike ? (
            <Folder className="w-4 h-4 text-blue-400 flex-shrink-0" />
          ) : (
            <FileText className="w-4 h-4 text-gray-400 flex-shrink-0" />
          )}
          <span className="truncate">{child.name}</span>
        </div>
        <div className={`flex items-center gap-1 transition-opacity ${iconVisibilityClass}`}>
          {noteLike && (
            <TooltipProvider delayDuration={150}>
              <Tooltip
                onOpenChange={(open) => {
                  if (open) {
                    triggerPreview();
                  }
                }}
              >
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-label="Preview note"
                    className="p-1 rounded hover:bg-gray-700 text-gray-300"
                    onMouseEnter={triggerPreview}
                    onFocus={triggerPreview}
                  >
                    <Eye className="w-4 h-4" />
                  </button>
                </TooltipTrigger>
                        <TooltipPortal>
                          <TooltipContent
                            side="right"
                            align="center"
                            sideOffset={14}
                            collisionPadding={24}
                            avoidCollisions={true}
                            className="popup-preview-tooltip"
                          >
                            <div className="popup-preview-tooltip__header">
                              <p className="popup-preview-tooltip__title">
                                {child.name || 'Preview'}
                              </p>
                            </div>
                            <div className="popup-preview-tooltip__body">
                              {tooltipBody}
                            </div>
                          </TooltipContent>
                        </TooltipPortal>
              </Tooltip>
            </TooltipProvider>
          )}
          {folderLike && (
                    <TooltipProvider delayDuration={150}>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            aria-label="Open folder"
                            className="p-1 rounded hover:bg-gray-700 text-gray-300"
                            onMouseEnter={(event) => handleFolderHover(event, false)}
                            onFocus={(event) => handleFolderHover(event, false)}
                            onClick={(event) => {
                              event.stopPropagation();
                              handleFolderHover(event, true);
                            }}
                            onMouseLeave={() => rowLeaveFolder?.(child.id, popupId)}
                            onBlur={() => rowLeaveFolder?.(child.id, popupId)}
                          >
                            <Eye className="w-4 h-4" />
                          </button>
                        </TooltipTrigger>
                        <TooltipPortal>
                          <TooltipContent side="right">Open folder</TooltipContent>
                        </TooltipPortal>
                      </Tooltip>
                    </TooltipProvider>
                  )}
                </div>
              </div>
    );
  };

  useEffect(() => {
    const activeIds = new Set<string>();
    popups.forEach((_, id) => activeIds.add(id));
    setPreviewState(prev => {
      let mutated = false;
      const next: Record<string, PreviewEntry> = {};
      Object.entries(prev).forEach(([id, entry]) => {
        if (activeIds.has(id)) {
          next[id] = entry;
        } else {
          mutated = true;
        }
      });
      return mutated ? next : prev;
    });
  }, [popups]);

  useEffect(() => {
    popups.forEach((popup, id) => {
      const entry = previewStateRef.current[id];
      const children = (popup.folder?.children ?? []) as PopupChildNode[];
      const firstNote = children.find(child => isNoteLikeNode(child));

      if (!entry) {
        if (firstNote) {
          requestPreview(id, firstNote);
        }
        return;
      }

      const activeChildId = entry.activeChildId;
      if (activeChildId && children.some(child => child.id === activeChildId && isNoteLikeNode(child))) {
        return;
      }

      if (firstNote) {
        requestPreview(id, firstNote);
      } else if (activeChildId !== null) {
        setPreviewState(prev => {
          const current = prev[id];
          if (!current) return prev;
          return {
            ...prev,
            [id]: {
              ...current,
              activeChildId: null,
            },
          };
        });
      }
    });
  }, [popups, requestPreview]);

  
  // Debug log on mount
  useEffect(() => {
    getUIResourceManager().enqueueLowPriority(() => {
      debugLog('PopupOverlay', 'component_mounted', {
        multiLayerEnabled,
        source: 'permanent_enable',
        popupCount: popups.size,
        timestamp: new Date().toISOString()
      });
    });

    return () => {
      getUIResourceManager().enqueueLowPriority(() => {
        debugLog('PopupOverlay', 'component_unmounted', {
          timestamp: new Date().toISOString()
        });
      });
    };
  }, [popups.size, multiLayerEnabled]);
  
  // Self-contained transform state (committed when pan ends)
  const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 });
  const [isPanning, setIsPanning] = useState(false);
  const isPanningRef = useRef(false);
  // RAF-driven pan refs: avoid React renders on every move
  const transformRef = useRef({ x: 0, y: 0, scale: 1 });
  const rafIdRef = useRef<number | null>(null);
  const lastRafTsRef = useRef(0);
  const [engaged, setEngaged] = useState(false); // hysteresis engaged
  
  // Use LayerProvider to gate interactivity by active layer
  const layerCtx = useLayer();
  const hasSharedCamera = multiLayerEnabled && layerCtx?.layers instanceof Map && layerCtx.layers.size > 0;
  const sharedTransform = hasSharedCamera ? (layerCtx.transforms.popups || IDENTITY_TRANSFORM) : null;
  const activeTransform = sharedTransform ?? transform;
  const isActiveLayer = !!layerCtx && layerCtx.activeLayer === 'popups';
  
  const overlayRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  // Track the on-screen bounds of the canvas container to scope the overlay
  const [overlayBounds, setOverlayBounds] = useState<{ top: number; left: number; width: number; height: number } | null>(null);
  const [pointerGuardOffset, setPointerGuardOffset] = useState(0);
  // Preferred: mount overlay inside the canvas container via React portal
  const [overlayContainer, setOverlayContainer] = useState<HTMLElement | null>(null);
  const [usingFallbackHost, setUsingFallbackHost] = useState(false);
  const [isOverlayHovered, setIsOverlayHovered] = useState(false);
  // LOD: Track which popups are visible in the viewport to limit connection lines
  const visibleIdSetRef = useRef<Set<string>>(new Set());
  const visibilityObserversRef = useRef<Map<string, IntersectionObserver>>(new Map());
  const panStartRef = useRef({ x: 0, y: 0 });
  const lastMouseRef = useRef({ x: 0, y: 0 });
  const pointerIdRef = useRef<number | null>(null);
  const toastTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  // Selection guard refs to prevent text highlighting during drag
  const selectionGuardsRef = useRef<{
    onSelectStart: (e: Event) => void;
    onDragStart: (e: Event) => void;
    prevUserSelect: string;
  } | null>(null);
  
  // Auto-scroll state and refs
  const [autoScroll, setAutoScroll] = useState<AutoScrollState>(() => ({
    isActive: false,
    velocity: { x: 0, y: 0 },
    threshold: AUTO_SCROLL_CONFIG.THRESHOLD,
    minSpeed: AUTO_SCROLL_CONFIG.MIN_SPEED,
    maxSpeed: AUTO_SCROLL_CONFIG.MAX_SPEED
  }));
  const autoScrollRef = useRef<AutoScrollState>(autoScroll);
  const animationFrameRef = useRef<number | null>(null);

  useEffect(() => {
    if (hasSharedCamera && sharedTransform) {
      transformRef.current = { ...sharedTransform };
    }
  }, [hasSharedCamera, sharedTransform]);

  // Inject global CSS once to hard-disable selection when dragging
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const STYLE_ID = 'dragging-no-select-style';
    if (!document.getElementById(STYLE_ID)) {
      const style = document.createElement('style');
      style.id = STYLE_ID;
      style.textContent = `
        html.dragging-no-select, html.dragging-no-select * {
          -webkit-user-select: none !important;
          user-select: none !important;
          -ms-user-select: none !important;
        }
      `;
      document.head.appendChild(style);
    }
  }, []);

  const enableSelectionGuards = useCallback(() => {
    if (typeof document === 'undefined') return;
    if (selectionGuardsRef.current) return; // already enabled
    const onSelectStart = (e: Event) => { e.preventDefault(); };
    const onDragStart = (e: Event) => { e.preventDefault(); };
    selectionGuardsRef.current = {
      onSelectStart,
      onDragStart,
      prevUserSelect: document.body.style.userSelect,
    };
    document.documentElement.classList.add('dragging-no-select');
    document.body.style.userSelect = 'none';
    document.addEventListener('selectstart', onSelectStart, true);
    document.addEventListener('dragstart', onDragStart, true);
    try { window.getSelection()?.removeAllRanges?.(); } catch {}
  }, []);

  const disableSelectionGuards = useCallback(() => {
    if (typeof document === 'undefined') return;
    const g = selectionGuardsRef.current;
    if (!g) return;
    document.removeEventListener('selectstart', g.onSelectStart, true);
    document.removeEventListener('dragstart', g.onDragStart, true);
    document.documentElement.classList.remove('dragging-no-select');
    document.body.style.userSelect = g.prevUserSelect || '';
    selectionGuardsRef.current = null;
  }, []);
  
  
  // Debug log initialization and state tracking
  useEffect(() => {
    getUIResourceManager().enqueueLowPriority(() => {
      debugLog('PopupOverlay', 'initialized', {
        popupCount: popups.size,
        transform: activeTransform,
        multiLayerEnabled,
        isActiveLayer,
        layerCtx: layerCtx?.activeLayer || 'none'
      });
    });
  }, [popups.size, activeTransform, multiLayerEnabled, isActiveLayer, layerCtx?.activeLayer]);
  
  // Avoid per-frame logging during pan to prevent jank/flicker
  // (transform updates every pointer move)
  // Intentionally disabled: 'transform_changed' spam
  // useEffect(() => {
  //   debugLog('PopupOverlay', 'transform_changed', {
  //     transform,
  //     isPanning,
  //     engaged
  //   });
  // }, [transform]);
  
  // Debug log layer changes
  useEffect(() => {
    getUIResourceManager().enqueueLowPriority(() => {
      debugLog('PopupOverlay', 'layer_state', {
        isActiveLayer,
        activeLayer: layerCtx?.activeLayer || 'none',
        popupCount: popups.size,
        canInteract: isActiveLayer && popups.size > 0
      });
    });
  }, [isActiveLayer, layerCtx?.activeLayer, popups.size]);
  
  // Check if the pointer event is on empty space (not on interactive elements)
  const isOverlayEmptySpace = useCallback((e: React.PointerEvent) => {
    const target = e.target as HTMLElement;
    // Check if we're NOT clicking on a popup card or button
    // This allows clicking on any background element including transform containers
    const isOnPopup = !!target.closest('.popup-card');
    const isOnButton = !!target.closest('button');
    
    // Empty space = not on popup card and not on button
    return !isOnPopup && !isOnButton;
  }, []);
  
  // Handle pan start (simplified like notes canvas)
  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    const sidebarEl = document.querySelector('[data-sidebar="sidebar"]') as HTMLElement | null;
    if (sidebarEl) {
      const rect = sidebarEl.getBoundingClientRect();
      if (e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom) {
        debugLog('PopupOverlay', 'pointer_blocked_over_sidebar', {
          clientX: e.clientX,
          clientY: e.clientY,
          sidebarRect: { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom }
        });
        return;
      }
    }

    // Always log that pointer down was received
    console.log('[PopupOverlay] pointerDown:', {
      target: (e.target as HTMLElement).className,
      isEmptySpace: isOverlayEmptySpace(e),
      isActiveLayer,
      popupCount: popups.size,
      layerCtx: layerCtx?.activeLayer || 'none',
      clientX: e.clientX,
      clientY: e.clientY
    });
    
    getUIResourceManager().enqueueLowPriority(() => {
      debugLog('PopupOverlay', 'pointer_down_received', {
        target: (e.target as HTMLElement).className,
        isEmptySpace: isOverlayEmptySpace(e),
        isActiveLayer,
        popupCount: popups.size,
        layerCtx: layerCtx?.activeLayer || 'none'
      });
    });
    
    // Only start panning if clicking on empty space
    if (!isOverlayEmptySpace(e)) {
      getUIResourceManager().enqueueLowPriority(() => {
        debugLog('PopupOverlay', 'pan_blocked_not_empty_space', {
          target: (e.target as HTMLElement).className
        });
      });
      return;
    }
    
    // Require at least one popup present
    const hasPopups = popups.size > 0;
    if (!hasPopups) {
      getUIResourceManager().enqueueLowPriority(() => {
        debugLog('PopupOverlay', 'pan_blocked', { 
          isActiveLayer,
          hasPopups,
          layerCtx: layerCtx?.activeLayer || 'none',
          reason: 'no_popups'
        });
      });
      return;
    }
    // Also require correct active layer to avoid accidental interception
    if (!isActiveLayer) {
      getUIResourceManager().enqueueLowPriority(() => {
        debugLog('PopupOverlay', 'pan_blocked_inactive_layer', {
          isActiveLayer,
          layerCtx: layerCtx?.activeLayer || 'none',
          reason: 'inactive_layer'
        });
      });
      return;
    }
    
    console.log('[PopupOverlay] PAN START!', {
      clientX: e.clientX,
      clientY: e.clientY,
      transform: activeTransform,
      pointerId: e.pointerId
    });
    
    getUIResourceManager().enqueueLowPriority(() => {
      debugLog('PopupOverlay', 'pan_start', { 
        clientX: e.clientX, 
        clientY: e.clientY,
        currentTransform: activeTransform,
        pointerId: e.pointerId,
        isActiveLayer,
        popupCount: popups.size
      });
    });
    
    // Use ref-driven panning to avoid render at t=0
    isPanningRef.current = true;
    setIsPanning(true);
    setEngaged(false); // reset hysteresis
    panStartRef.current = { x: e.clientX, y: e.clientY };
    lastMouseRef.current = { x: e.clientX, y: e.clientY };
    pointerIdRef.current = e.pointerId;
    
    // Capture pointer for robust dragging across children
    // Only capture if this is a real pointer event (not synthetic)
    try {
      if (e.pointerId !== undefined && overlayRef.current) {
        overlayRef.current.setPointerCapture(e.pointerId);
      }
    } catch (err) {
      // Fallback: pointer capture not available or synthetic event
      debugLog('PopupOverlay', 'pointer_capture_failed', { 
        error: err.message,
        pointerId: e.pointerId 
      });
    }
    
    // Optimize for dragging
    // Prevent text selection while dragging
    enableSelectionGuards();
    document.body.style.userSelect = 'none';
    if (hasSharedCamera && layerCtx) {
      layerCtx.setGesture('overlay-pan');
      transformRef.current = { ...activeTransform };
    } else if (containerRef.current) {
      containerRef.current.style.willChange = 'transform';
      containerRef.current.style.backfaceVisibility = 'hidden';
      containerRef.current.style.perspective = '1000px';
      transformRef.current = { ...transform };
      const { x, y, scale } = transformRef.current;
      containerRef.current.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0) scale(${scale})`;
    }
    // Immediate cursor feedback without render
    if (overlayRef.current) overlayRef.current.style.cursor = 'grabbing';
    
    // Only prevent default for actual drag operations
    e.preventDefault();
  }, [
    isOverlayEmptySpace,
    transform,
    sharedTransform,
    activeTransform,
    hasSharedCamera,
    isActiveLayer,
    popups.size,
    layerCtx
  ]);
  
  // Handle pan move (simplified like notes canvas)
  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!isPanningRef.current || pointerIdRef.current === null) {
      debugLog('PopupOverlay', 'pan_move_blocked', {
        isPanning: isPanningRef.current,
        pointerIdRef: pointerIdRef.current,
        reason: !isPanningRef.current ? 'not_panning' : 'no_pointer_id'
      });
      return;
    }
    
    // Don't block on capture - it may not be available for synthetic events
    
    const deltaX = e.clientX - lastMouseRef.current.x;
    const deltaY = e.clientY - lastMouseRef.current.y;
    
    // 3-5px hysteresis to distinguish click vs pan
    if (!engaged) {
      const dx0 = e.clientX - panStartRef.current.x;
      const dy0 = e.clientY - panStartRef.current.y;
      if (Math.hypot(dx0, dy0) < 1) return; // maintain minimal hysteresis to avoid accidental pans
      setEngaged(true);
      getUIResourceManager().enqueueLowPriority(() => {
        debugLog('PopupOverlay', 'pan_engaged', { threshold: Math.hypot(dx0, dy0) });
      });
    }
    
    if (hasSharedCamera && layerCtx) {
      layerCtx.updateTransformByDelta('popups', { dx: deltaX, dy: deltaY });
    } else {
      transformRef.current = {
        ...transformRef.current,
        x: transformRef.current.x + deltaX,
        y: transformRef.current.y + deltaY,
      };
      if (containerRef.current) {
        const { x, y, scale } = transformRef.current;
        containerRef.current.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0) scale(${scale})`;
      }
      if (rafIdRef.current == null) {
        rafIdRef.current = requestAnimationFrame((ts) => {
          rafIdRef.current = null;
          if (ts - lastRafTsRef.current < 16) return; // throttle ~60fps
          lastRafTsRef.current = ts;
          const { x, y, scale } = transformRef.current;
          if (containerRef.current) {
            containerRef.current.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0) scale(${scale})`;
          }
        });
      }
    }
    
    lastMouseRef.current = { x: e.clientX, y: e.clientY };
  }, [isPanning, engaged, popups.size, hasSharedCamera, layerCtx]);
  
  // Handle pan end (simplified)
  const handlePointerEnd = useCallback((e: React.PointerEvent) => {
    if (!isPanningRef.current) return;
    
    getUIResourceManager().enqueueLowPriority(() => {
      debugLog('PopupOverlay', 'pan_end', { 
        totalDelta: {
          x: activeTransform.x,
          y: activeTransform.y
        },
        pointerId: e.pointerId,
        wasEngaged: engaged
      });
    });
    
    // End ref-driven panning
    isPanningRef.current = false;
    setIsPanning(false);
    // Keep state false (we did not set it to true at start) but ensure UI resets
    setEngaged(false);
    
    // Release pointer capture
    if (pointerIdRef.current !== null && overlayRef.current) {
      try {
        overlayRef.current.releasePointerCapture(pointerIdRef.current);
      } catch (err) {
        // Pointer was never captured or already released
        debugLog('PopupOverlay', 'pointer_release_failed', { 
          error: err.message,
          pointerId: pointerIdRef.current 
        });
      }
      pointerIdRef.current = null;
    }
    
    // Reset styles
    document.body.style.userSelect = '';
    if (!hasSharedCamera && containerRef.current) {
      containerRef.current.style.willChange = 'auto';
      containerRef.current.style.backfaceVisibility = '';
      containerRef.current.style.perspective = '';
      containerRef.current.style.transform = '';
    }
    if (overlayRef.current) overlayRef.current.style.cursor = '';
    if (!hasSharedCamera) {
      setTransform(prev => ({ ...prev, ...transformRef.current }));
    }
    if (rafIdRef.current) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
    // Re-enable selection
    disableSelectionGuards();
    if (hasSharedCamera && layerCtx) {
      layerCtx.setGesture('none');
    }
  }, [isPanning, hasSharedCamera, layerCtx, engaged, activeTransform]);
  
  // Note: With pointer capture, we don't need document-level listeners
  // The pointer events will continue to fire on the overlay even when
  // the pointer moves outside or over child elements
  
  // Note: Auto-switch is already handled by the explorer component
  // Removing duplicate auto-switch logic to prevent conflicts
  
  // Show toast notification
  const showToast = (message: string) => {
    // Clear existing timeout
    if (toastTimeoutRef.current) {
      clearTimeout(toastTimeoutRef.current);
    }
    
    // Create toast element
    const toast = document.createElement('div');
    toast.className = 'fixed bottom-4 right-4 bg-gray-800 text-white px-4 py-2 rounded-lg shadow-lg animate-slide-in';
    toast.style.zIndex = String(Z_INDEX.TOAST);
    toast.textContent = message;
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');
    
    document.body.appendChild(toast);
    
    // Animate in
    requestAnimationFrame(() => {
      toast.style.opacity = '1';
      toast.style.transform = 'translateY(0)';
    });
    
    // Remove after delay
    toastTimeoutRef.current = setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
      setTimeout(() => toast.remove(), 300);
    }, 2000);
  };
  
  // Generate connection lines (LOD: use visible popup ids if available)
  const connectionPaths = ConnectionLineAdapter.adaptConnectionLines(
    popups,
    draggingPopup !== null,
    visibleIdSetRef.current.size ? visibleIdSetRef.current : undefined
  );
  
  // Container transform style with translate3d for GPU acceleration
  const containerStyle: React.CSSProperties = {
    // Round to nearest 0.5px to reduce jitter while maintaining smoothness
    transform: `translate3d(${Math.round(activeTransform.x * 2) / 2}px, ${Math.round(activeTransform.y * 2) / 2}px, 0) scale(${activeTransform.scale})`,
    transformOrigin: '0 0',
    // Only apply will-change during active panning to optimize GPU layers
    willChange: isPanning && !hasSharedCamera ? 'transform' : 'auto',
    // Force stable GPU layer to prevent text rasterization issues
    backfaceVisibility: 'hidden',
    transformStyle: 'preserve-3d',
    // Critical: NO transition during drag (main cause of blinking)
    transition: 'none',
    // Ensure we're on a separate compositing layer
    isolation: 'isolate',
    // Force GPU acceleration
    WebkitTransform: `translate3d(${Math.round(activeTransform.x * 2) / 2}px, ${Math.round(activeTransform.y * 2) / 2}px, 0) scale(${activeTransform.scale})`,
    // Prevent font antialiasing changes during transform
    WebkitFontSmoothing: 'antialiased',
    MozOsxFontSmoothing: 'grayscale',
    // Apply subtle opacity during pan to force simpler rendering
    opacity: isPanning && !hasSharedCamera ? 0.999 : 1,
  };

  // Recompute overlay bounds to match the canvas area (avoids hardcoded offsets)
  const recomputeOverlayBounds = useCallback(() => {
    if (typeof window === 'undefined') return;
    const canvasEl = document.getElementById('canvas-container');
    if (canvasEl) {
      const rect = canvasEl.getBoundingClientRect();
      const sidebarEl = document.querySelector('[data-sidebar="sidebar"]') as HTMLElement | null;
      let effectiveLeft = rect.left;
      let effectiveWidth = rect.width;
      let guardOffset = 0;

      if (sidebarEl) {
        const sidebarRect = sidebarEl.getBoundingClientRect();
        const sidebarWidth = sidebarRect.width;
        const isSidebarVisible = sidebarWidth > 0 && sidebarRect.right > rect.left + 1;

        if (isSidebarVisible) {
          const overlap = Math.max(0, sidebarRect.right - rect.left);
          if (overlap > 0) {
            effectiveLeft = rect.left + overlap;
            effectiveWidth = Math.max(0, rect.right - effectiveLeft);
            guardOffset = overlap;
            debugLog('PopupOverlay', 'bounds_sidebar_detected', {
              sidebarWidth,
              sidebarRight: sidebarRect.right,
              canvasLeft: rect.left,
              overlap,
              effectiveLeft,
              effectiveWidth,
            });
          }
        }
      }

      setOverlayBounds({
        top: Math.max(0, rect.top),
        left: Math.max(0, effectiveLeft),
        width: Math.max(0, effectiveWidth),
        height: Math.max(0, rect.height),
      });
      setPointerGuardOffset(guardOffset);
      setOverlayContainer(canvasEl as HTMLElement);
      setUsingFallbackHost(false);
      debugLog('PopupOverlay', 'overlay_bounds_updated', { rect, effectiveLeft, effectiveWidth, guardOffset });
    } else {
      const fallbackHost = ensureFloatingOverlayHost();
      if (fallbackHost) {
        const rect = fallbackHost.getBoundingClientRect();
        setOverlayBounds({
          top: rect.top,
          left: rect.left,
          width: rect.width,
          height: rect.height,
        });
        setPointerGuardOffset(0);
        setOverlayContainer(fallbackHost);
        setUsingFallbackHost(fallbackHost.id === FLOATING_OVERLAY_HOST_ID);
        debugLog('PopupOverlay', 'overlay_bounds_fallback', {
          hostId: fallbackHost.id,
          rect,
        });
      } else {
        setOverlayBounds({ top: 0, left: 0, width: window.innerWidth, height: window.innerHeight });
        setPointerGuardOffset(0);
        setOverlayContainer(null);
        setUsingFallbackHost(false);
      }
    }
  }, []);

  useEffect(() => {
    // Initial compute and on resize
    recomputeOverlayBounds();
    const onResize = () => recomputeOverlayBounds();
    window.addEventListener('resize', onResize);
    const onScroll = () => recomputeOverlayBounds();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', onScroll as any);
    };
  }, [recomputeOverlayBounds, sidebarOpen]); // Add sidebarOpen dependency to recalculate when sidebar toggles

  // Recalculate bounds after sidebar animation completes
  useEffect(() => {
    const sidebarEl = document.querySelector('[data-sidebar="sidebar"]');
    if (!sidebarEl) return;

    const handleTransitionEnd = (e: TransitionEvent) => {
      // Recalculate bounds after sidebar animation completes
      if (e.propertyName === 'transform') {
        // Small delay to ensure getBoundingClientRect returns final values
        setTimeout(() => {
          recomputeOverlayBounds();
          debugLog('PopupOverlay', 'bounds_recalc_after_transition', {
            sidebarOpen,
            timestamp: new Date().toISOString()
          });
        }, 10);
      }
    };

    sidebarEl.addEventListener('transitionend', handleTransitionEnd);
    return () => {
      sidebarEl.removeEventListener('transitionend', handleTransitionEnd);
    };
  }, [recomputeOverlayBounds, sidebarOpen]);

  useEffect(() => {
    debugLog('PopupOverlay', 'transform_applied', {
      x: activeTransform.x,
      y: activeTransform.y,
      scale: activeTransform.scale,
      hasSharedCamera,
      isPanning
    });
  }, [activeTransform.x, activeTransform.y, activeTransform.scale, hasSharedCamera, isPanning]);

  // Setup IntersectionObserver to track which popups are visible (for LOD)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const rootEl = overlayContainer || overlayRef.current || undefined;
    if (!rootEl) return;

    // Clear any previous observers
    visibilityObserversRef.current.forEach((obs) => obs.disconnect());
    visibilityObserversRef.current.clear();
    visibleIdSetRef.current.clear();

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          const el = entry.target as HTMLElement;
          const id = el.getAttribute('data-popup-id');
          if (!id) return;
          if (entry.isIntersecting) {
            visibleIdSetRef.current.add(id);
          } else {
            visibleIdSetRef.current.delete(id);
          }
        });
      },
      { root: rootEl === overlayRef.current ? overlayRef.current : null, threshold: 0 }
    );

    // Observe current rendered popups on next frame
    requestAnimationFrame(() => {
      const nodes = (rootEl as HTMLElement).querySelectorAll('[data-popup-id]');
      nodes.forEach((n) => observer.observe(n));
      visibilityObserversRef.current.set('main', observer);
    });

    // Near-viewport prewarm observer (wider rootMargin)
    const nearObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          const el = entry.target as HTMLElement;
          // Cheap prewarm: read offsetHeight to materialize layout for this node
          // (content-visibility: auto may lazy-layout; this nudges it ahead of time)
          void el.offsetHeight;
        });
      },
      { root: rootEl === overlayRef.current ? overlayRef.current : null, rootMargin: '400px', threshold: 0 }
    );

    requestAnimationFrame(() => {
      const nodes = (rootEl as HTMLElement).querySelectorAll('[data-popup-id]');
      nodes.forEach((n) => nearObserver.observe(n));
      visibilityObserversRef.current.set('near', nearObserver);
    });

    return () => {
      observer.disconnect();
      nearObserver.disconnect();
      visibilityObserversRef.current.delete('main');
      visibilityObserversRef.current.delete('near');
    };
  }, [overlayContainer, popups.size]);

  // Debug log container style
  useEffect(() => {
    debugLog('PopupOverlay', 'container_style', {
      containerStyle,
      hasContainer: !!containerRef.current,
      computedTransform: containerRef.current?.style?.transform || 'none'
    });
  }, [containerStyle]);
  
  // Viewport culling - only render visible popups
  const visiblePopups = useMemo(() => {
    if (typeof window === 'undefined') return Array.from(popups.values())
    
    const viewport = {
      width: window.innerWidth,
      height: window.innerHeight,
    }
    
    return Array.from(popups.values()).filter((popup) => {
      if (!popup.canvasPosition) return false
      
      const screenPos = CoordinateBridge.canvasToScreen(
        popup.canvasPosition || popup.position,
        activeTransform
      )
      
      // Check if popup is within viewport (with some margin)
      const margin = 100
      const popupWidth = 300
      const popupHeight = popup.height || 400
      
      return (
        screenPos.x + popupWidth >= -margin &&
        screenPos.x <= viewport.width + margin &&
        screenPos.y + popupHeight >= -margin &&
        screenPos.y <= viewport.height + margin
      )
    })
  }, [popups, activeTransform])
  
  // Build overlay contents (absolute inside canvas container)
  const overlayInner = (
    <div
      ref={overlayRef}
      id="popup-overlay"
      className={`${usingFallbackHost ? 'fixed' : 'absolute'} inset-0 ${isPanning ? 'popup-overlay-panning' : ''}`}
      data-panning={isPanning.toString()}
      style={{
        zIndex: Z_INDEX.POPUP_OVERLAY,
        overflow: 'hidden',
        pointerEvents: (popups.size > 0) ? 'auto' : 'none',
        touchAction: (popups.size > 0) ? 'none' : 'auto',
        cursor: isPanning ? 'grabbing' : ((popups.size > 0) ? 'grab' : 'default'),
        opacity: (popups.size > 0) ? 1 : 0,
        visibility: (popups.size > 0) ? 'visible' : 'hidden',
        contain: 'layout paint' as const,
        clipPath: !usingFallbackHost && pointerGuardOffset > 0 ? `inset(0 0 0 ${pointerGuardOffset}px)` : 'none',
      }}
      data-layer="popups"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
      onPointerEnter={() => setIsOverlayHovered(true)}
      onPointerLeave={() => setIsOverlayHovered(false)}
    >
      {/* Transform container - applies pan/zoom to all children */}
      <div ref={containerRef} className="absolute inset-0" style={containerStyle}>
        {/* Removed full-viewport background inside transform to prevent repaint flicker */}
        {/* Connection lines (canvas coords) */}
        <svg className="absolute inset-0 pointer-events-none" style={{ overflow: 'visible' }}>
          {connectionPaths.map((path, index) => (
            <path key={index} d={path.d} stroke={path.stroke} strokeWidth={path.strokeWidth} opacity={path.opacity} fill="none" strokeLinecap="round" strokeLinejoin="round" />
          ))}
        </svg>
        {/* Popups (canvas coords) - only render visible ones */}
        {visiblePopups.map((popup) => {
          const previewEntry = previewState[popup.id];
          const activeChildId = previewEntry?.activeChildId ?? null;
          const activePreview = activeChildId && previewEntry?.entries
            ? previewEntry.entries[activeChildId]
            : undefined;

          const renderChildRow = renderPopupChildRow(popup.id, {
            previewEntry,
            activePreview,
            isPanning,
            onHoverFolder,
            onLeaveFolder,
          });

          const position = popup.canvasPosition || popup.position;
          if (!position) return null;
          const zIndex = getPopupZIndex(
            popup.level,
            popup.isDragging || popup.id === draggingPopup,
            true
          );
          const cappedZIndex = Math.min(zIndex, 20000);
          return (
            <div
              key={popup.id}
              id={`popup-${popup.id}`}
              className="popup-card absolute bg-gray-800 border border-gray-700 rounded-lg shadow-xl pointer-events-auto"
              style={{
                left: `${position.x}px`,
                top: `${position.y}px`,
                width: '300px',
                maxHeight: '400px',
                zIndex: cappedZIndex,
                cursor: popup.isDragging ? 'grabbing' : 'default',
                // Slightly reduce opacity during pan to prevent text rendering issues
                opacity: isPanning ? 0.99 : 1,
                // Add GPU optimization to individual popups
                transform: 'translateZ(0)',
                backfaceVisibility: 'hidden' as const,
                willChange: popup.isDragging || isPanning ? 'transform' : 'auto',
              }}
              data-popup-id={popup.id}
              onClick={(e) => e.stopPropagation()}
              onPointerEnter={() => {
                // Pass both the folder ID and the parent popup ID to cancel the close timeout
                if (popup.folder?.id) {
                  onPopupHover?.(popup.folder.id, popup.parentId)
                }
              }}
            >
              {/* Popup Header */}
              <div
                className="px-3 py-2 border-b border-gray-700 flex items-center justify-between cursor-grab active:cursor-grabbing"
                onMouseDown={(e) => onDragStart?.(popup.id, e)}
                style={{ backgroundColor: popup.isDragging ? '#374151' : 'transparent' }}
              >
                <div className="flex items-center gap-2">
                  <Folder className="w-4 h-4 text-blue-400" />
                  <span className="text-sm font-medium text-white truncate">
                    {popup.folder?.name || 'Loading...'}
                  </span>
                </div>
                <button
                  onClick={() => onClosePopup(popup.id)}
                  onMouseDown={(e) => e.stopPropagation()}
                  className="p-0.5 hover:bg-gray-700 rounded pointer-events-auto"
                  aria-label="Close popup"
                >
                  <X className="w-4 h-4 text-gray-400" />
                </button>
              </div>
              {/* Popup Content with virtualization for large lists */}
              <div className="overflow-y-auto" style={{ maxHeight: 'calc(400px - 100px)', contain: 'content', contentVisibility: 'auto' as const }}>
                {popup.isLoading ? (
                  <div className="p-4 text-center text-gray-500 text-sm">Loading...</div>
                ) : popup.folder?.children && popup.folder.children.length > 0 ? (
                  popup.folder.children.length > 200 ? (
                    <VirtualList
                      items={popup.folder.children}
                      itemHeight={36}
                      height={300}
                      overscan={8}
                      renderItem={(child: PopupChildNode) => renderChildRow(child)}
                    />
                  ) : (
                    <div className="py-1">
                      {popup.folder.children.map(renderChildRow)}
                    </div>
                  )
                ) : (
                  <div className="p-4 text-center text-gray-500 text-sm">Empty folder</div>
                )}
              </div>
              {/* Popup Footer */}
              <div className="px-3 py-1.5 border-t border-gray-700 text-xs text-gray-500">
                Level {popup.level} • {popup.folder?.children?.length || 0} items
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );

  useEffect(() => {
    if (!usingFallbackHost || !overlayContainer) {
      return;
    }

    const host = overlayContainer;
    host.style.pointerEvents = popups.size > 0 ? 'auto' : 'none';
    host.style.zIndex = String(Z_INDEX.POPUP_OVERLAY);

    return () => {
      host.style.pointerEvents = 'none';
    };
  }, [overlayContainer, popups.size, usingFallbackHost]);

  // Render strategy:
  // 1. If canvas-container exists, portal into it (scoped to canvas area)
  // 2. Otherwise, render as fixed overlay on document.body (for floating notes widget when no note is open)
  if (typeof window !== 'undefined') {
    if (overlayContainer) {
      // Preferred: portal into canvas container
      return createPortal(overlayInner, overlayContainer);
    } else if (popups.size > 0) {
      // Fallback: render as fixed overlay when canvas doesn't exist but popups do
      // This handles the case where floating notes widget is open but no note is selected
      const fallbackOverlay = (
        <div
          ref={overlayRef}
          id="popup-overlay"
          className={`fixed inset-0 ${isPanning ? 'popup-overlay-panning' : ''}`}
          data-panning={isPanning.toString()}
          style={{
            zIndex: Z_INDEX.POPUP_OVERLAY,
            overflow: 'hidden',
            pointerEvents: (popups.size > 0) ? 'auto' : 'none',
            touchAction: (popups.size > 0) ? 'none' : 'auto',
            cursor: isPanning ? 'grabbing' : ((popups.size > 0) ? 'grab' : 'default'),
            opacity: (popups.size > 0) ? 1 : 0,
            visibility: (popups.size > 0) ? 'visible' : 'hidden',
            contain: 'layout paint' as const,
          }}
          data-layer="popups"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerEnd}
          onPointerCancel={handlePointerEnd}
          onPointerEnter={() => setIsOverlayHovered(true)}
          onPointerLeave={() => setIsOverlayHovered(false)}
        >
          {/* Transform container - applies pan/zoom to all children */}
          <div ref={containerRef} className="absolute inset-0" style={containerStyle}>
            {/* Connection lines (canvas coords) */}
            <svg className="absolute inset-0 pointer-events-none" style={{ overflow: 'visible' }}>
              {connectionPaths.map((path, index) => (
                <path key={index} d={path.d} stroke={path.stroke} strokeWidth={path.strokeWidth} opacity={path.opacity} fill="none" strokeLinecap="round" strokeLinejoin="round" />
              ))}
            </svg>
            {/* Popups (canvas coords) - only render visible ones */}
            {visiblePopups.map((popup) => {
              const previewEntry = previewState[popup.id];
              const activeChildId = previewEntry?.activeChildId ?? null;
              const activePreview = activeChildId && previewEntry?.entries
                ? previewEntry.entries[activeChildId]
                : undefined;

              const renderChildRow = renderPopupChildRow(popup.id, {
                previewEntry,
                activePreview,
                isPanning,
                onHoverFolder,
                onLeaveFolder,
              });

              const position = popup.canvasPosition || popup.position;
              if (!position) return null;
              const zIndex = getPopupZIndex(
                popup.level,
                popup.isDragging || popup.id === draggingPopup,
                true
              );
              const cappedZIndex = Math.min(zIndex, 20000);
              return (
                <div
                  key={popup.id}
                  id={`popup-${popup.id}`}
                  className="popup-card absolute bg-gray-800 border border-gray-700 rounded-lg shadow-xl pointer-events-auto"
                  style={{
                    left: `${position.x}px`,
                    top: `${position.y}px`,
                    width: '300px',
                    maxHeight: '400px',
                    zIndex: cappedZIndex,
                    cursor: popup.isDragging ? 'grabbing' : 'default',
                    opacity: isPanning ? 0.99 : 1,
                    transform: 'translateZ(0)',
                    backfaceVisibility: 'hidden' as const,
                    willChange: popup.isDragging || isPanning ? 'transform' : 'auto',
                  }}
                  data-popup-id={popup.id}
                  onClick={(e) => e.stopPropagation()}
                >
                  {/* Popup Header */}
                  <div
                    className="px-3 py-2 border-b border-gray-700 flex items-center justify-between cursor-grab active:cursor-grabbing"
                    onMouseDown={(e) => onDragStart?.(popup.id, e)}
                    style={{ backgroundColor: popup.isDragging ? '#374151' : 'transparent' }}
                  >
                    <div className="flex items-center gap-2">
                      <Folder className="w-4 h-4 text-blue-400" />
                      <span className="text-sm font-medium text-white truncate">
                        {popup.folder?.name || 'Loading...'}
                      </span>
                    </div>
                    <button
                      onClick={() => onClosePopup(popup.id)}
                      onMouseDown={(e) => e.stopPropagation()}
                      className="p-0.5 hover:bg-gray-700 rounded pointer-events-auto"
                      aria-label="Close popup"
                    >
                      <X className="w-4 h-4 text-gray-400" />
                    </button>
                  </div>
                  {/* Popup Content */}
                  <div className="overflow-y-auto" style={{ maxHeight: 'calc(400px - 100px)', contain: 'content', contentVisibility: 'auto' as const }}>
                    {popup.isLoading ? (
                      <div className="p-4 text-center text-gray-500 text-sm">Loading...</div>
                    ) : popup.folder?.children && popup.folder.children.length > 0 ? (
                      popup.folder.children.length > 200 ? (
                        <VirtualList
                          items={popup.folder.children}
                          itemHeight={36}
                          height={300}
                          overscan={8}
                          renderItem={(child: PopupChildNode) => renderChildRow(child)}
                        />
                      ) : (
                        <div className="py-1">
                          {popup.folder.children.map(renderChildRow)}
                        </div>
                      )
                    ) : (
                      <div className="p-4 text-center text-gray-500 text-sm">Empty folder</div>
                    )}
                  </div>
                  {/* Popup Footer */}
                  <div className="px-3 py-1.5 border-t border-gray-700 text-xs text-gray-500">
                    Level {popup.level} • {popup.folder?.children?.length || 0} items
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      );
      return createPortal(fallbackOverlay, document.body);
    }
  }

  return null;
};

// Export for use in other components
export default PopupOverlay;
