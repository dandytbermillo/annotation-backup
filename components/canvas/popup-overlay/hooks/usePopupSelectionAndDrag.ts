import { useCallback, useEffect, useRef, useState } from 'react';
import type React from 'react';
import { buildMultilinePreview } from '@/lib/utils/branch-preview';
import { getUIResourceManager } from '@/lib/ui/resource-manager';
import { PREVIEW_HOVER_DELAY_MS } from '@/lib/constants/ui-timings';
import { isNoteLikeNode } from '../helpers';
import type { PopupChildNode, PopupData, PreviewChildEntry, PreviewEntry } from '../types';

const TOOLTIP_PREVIEW_MAX_LENGTH = Number.MAX_SAFE_INTEGER;

interface PreviewTooltipState {
  noteId: string;
  content: string;
  position: { x: number; y: number };
  status: 'loading' | 'ready' | 'error';
}

export interface UsePopupSelectionAndDragOptions {
  popups: Map<string, PopupData>;
  onBulkMove?: (itemIds: string[], targetFolderId: string, sourcePopupId: string) => Promise<void>;
  onDeleteSelected?: (popupId: string, selectedIds: Set<string>) => void;
  fetchWithKnowledgeBase: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  debugLog: (...args: any[]) => Promise<void>;
  debugLoggingEnabled: boolean;
}

export interface UsePopupSelectionAndDragResult {
  previewState: Record<string, PreviewEntry>;
  requestPreview: (popupId: string, child: PopupChildNode | null) => void;
  popupSelections: Map<string, Set<string>>;
  handleItemSelect: (
    popupId: string,
    childId: string,
    children: PopupChildNode[],
    event: React.MouseEvent
  ) => void;
  handleClearSelection: (popupId: string) => void;
  handleDeleteSelected: (popupId: string) => void;
  setSelectionForPopup: (popupId: string, selectedIds: Iterable<string>) => void;
  setLastSelectedIdForPopup: (popupId: string, childId: string | null) => void;
  hoverHighlightedPopup: string | null;
  setHoverHighlightedPopup: React.Dispatch<React.SetStateAction<string | null>>;
  hoverHighlightTimeoutRef: React.MutableRefObject<NodeJS.Timeout | null>;
  draggedItems: Set<string>;
  dropTargetId: string | null;
  invalidDropTargetId: string | null;
  isPopupDropTarget: string | null;
  handleDragStart: (popupId: string, childId: string, event: React.DragEvent) => void;
  handleDragOver: (childId: string, isFolder: boolean, event: React.DragEvent) => void;
  handleDragLeave: (event: React.DragEvent) => void;
  handleDragEnd: () => void;
  handleDrop: (targetFolderId: string, event: React.DragEvent) => Promise<void>;
  handlePopupDragOver: (popupId: string, folderId: string, event: React.DragEvent) => void;
  handlePopupDragLeave: (popupId: string, event: React.DragEvent) => void;
  handlePopupDrop: (folderId: string, popupId: string, event: React.DragEvent) => Promise<void>;
  activePreviewTooltip: PreviewTooltipState | null;
  handlePreviewTooltipHover: (noteId: string, event: React.MouseEvent) => Promise<void>;
  handlePreviewTooltipLeave: () => void;
  handlePreviewTooltipEnter: () => void;
  handlePreviewTooltipMouseLeave: () => void;
  dismissPreviewTooltip: () => void;
}

export function usePopupSelectionAndDrag({
  popups,
  onBulkMove,
  onDeleteSelected,
  fetchWithKnowledgeBase,
  debugLog,
  debugLoggingEnabled,
}: UsePopupSelectionAndDragOptions): UsePopupSelectionAndDragResult {
  const [previewState, setPreviewState] = useState<Record<string, PreviewEntry>>({});
  const previewStateRef = useRef(previewState);
  const previewControllersRef = useRef<Map<string, AbortController>>(new Map());

  useEffect(() => {
    previewStateRef.current = previewState;
  }, [previewState]);

  useEffect(() => {
    return () => {
      previewControllersRef.current.forEach((controller) => {
        try {
          controller.abort();
        } catch {}
      });
      previewControllersRef.current.clear();
    };
  }, []);

  const [activePreviewTooltip, setActivePreviewTooltip] = useState<PreviewTooltipState | null>(null);
  const previewTooltipTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const previewTooltipCloseTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isHoveringPreviewTooltipRef = useRef(false);

  const [popupSelections, setPopupSelections] = useState<Map<string, Set<string>>>(new Map());
  const [lastSelectedIds, setLastSelectedIds] = useState<Map<string, string>>(new Map());

  const [hoverHighlightedPopup, setHoverHighlightedPopup] = useState<string | null>(null);
  const hoverHighlightTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    return () => {
      if (hoverHighlightTimeoutRef.current) {
        clearTimeout(hoverHighlightTimeoutRef.current);
      }
    };
  }, []);

  const [draggedItems, setDraggedItems] = useState<Set<string>>(new Set());
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const [invalidDropTargetId, setInvalidDropTargetId] = useState<string | null>(null);
  const [dragSourcePopupId, setDragSourcePopupId] = useState<string | null>(null);
  const [dragSourceFolderId, setDragSourceFolderId] = useState<string | null>(null);
  const [isPopupDropTarget, setIsPopupDropTarget] = useState<string | null>(null);

  const setSelectionForPopup = useCallback((popupId: string, selectedIds: Iterable<string>) => {
    setPopupSelections((prev) => {
      const next = new Map(prev);
      const selection = new Set(selectedIds);
      if (selection.size > 0) {
        next.set(popupId, selection);
      } else {
        next.delete(popupId);
      }
      return next;
    });
  }, []);

  const setLastSelectedIdForPopup = useCallback((popupId: string, childId: string | null) => {
    setLastSelectedIds((prev) => {
      const next = new Map(prev);
      if (childId) {
        next.set(popupId, childId);
      } else {
        next.delete(popupId);
      }
      return next;
    });
  }, []);

  const fetchPreview = useCallback(
    async (popupId: string, childId: string) => {
      const controllerKey = `${popupId}:${childId}`;
      const existingController = previewControllersRef.current.get(controllerKey);
      if (existingController) {
        try {
          existingController.abort();
        } catch {}
      }

      const controller = new AbortController();
      previewControllersRef.current.set(controllerKey, controller);

      try {
        const response = await fetchWithKnowledgeBase(`/api/items/${childId}`, {
          method: 'GET',
          headers: { Accept: 'application/json' },
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
        const previewText = buildMultilinePreview(
          content,
          contentText || '',
          TOOLTIP_PREVIEW_MAX_LENGTH
        );

        if (debugLoggingEnabled) {
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
        }

        setPreviewState((prev) => {
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
        if (debugLoggingEnabled) {
          getUIResourceManager().enqueueLowPriority(() => {
            debugLog('PopupOverlay', 'preview_fetch_error', {
              popupId,
              childId,
              message: error?.message ?? 'Unknown error',
            });
          });
        }
        setPreviewState((prev) => {
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
    },
    [debugLog, debugLoggingEnabled, fetchWithKnowledgeBase]
  );

  const requestPreview = useCallback(
    (popupId: string, child: PopupChildNode | null) => {
      if (!child) {
        setPreviewState((prev) => {
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
        setPreviewState((prev) => {
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
      const loadingTooLong =
        latestChildEntry?.status === 'loading' &&
        typeof latestChildEntry.requestedAt === 'number' &&
        now - latestChildEntry.requestedAt > 1500;

      const shouldFetch =
        !latestChildEntry ||
        latestChildEntry.status === 'error' ||
        latestChildEntry.status === 'idle' ||
        loadingTooLong;

      if (debugLoggingEnabled) {
        getUIResourceManager().enqueueLowPriority(() => {
          debugLog('PopupOverlay', 'preview_request', {
            popupId,
            childId: child.id,
            shouldFetch,
            existingStatus: latestChildEntry?.status ?? 'none',
            loadingTooLong,
          });
        });
      }

      setPreviewState((prev) => {
        const previousEntry: PreviewEntry =
          prev[popupId] ?? { activeChildId: null, entries: {} as Record<string, PreviewChildEntry> };
        const prevChild: PreviewChildEntry | undefined = previousEntry.entries[child.id];

        const nextChildEntry: PreviewChildEntry = shouldFetch
          ? {
              status: 'loading',
              content: prevChild?.content,
              previewText: prevChild?.previewText,
              error: undefined,
              requestedAt: now,
            }
          : prevChild ?? { status: 'loading', content: undefined, previewText: undefined };

        return {
          ...prev,
          [popupId]: {
            activeChildId: child.id,
            entries: {
              ...previousEntry.entries,
              [child.id]: nextChildEntry,
            },
          },
        };
      });

      if (shouldFetch) {
        fetchPreview(popupId, child.id);
      } else if (latestChildEntry?.previewText && debugLoggingEnabled) {
        getUIResourceManager().enqueueLowPriority(() => {
          debugLog('PopupOverlay', 'preview_cache_hit', {
            popupId,
            childId: child.id,
            status: latestChildEntry.status,
          });
        });
      }
    },
    [debugLog, debugLoggingEnabled, fetchPreview]
  );

  const handlePreviewTooltipHover = useCallback(
    async (noteId: string, event: React.MouseEvent) => {
      if (previewTooltipTimeoutRef.current) {
        clearTimeout(previewTooltipTimeoutRef.current);
      }
      if (previewTooltipCloseTimeoutRef.current) {
        clearTimeout(previewTooltipCloseTimeoutRef.current);
      }

      isHoveringPreviewTooltipRef.current = false;

      const rect = event.currentTarget.getBoundingClientRect();
      const position = {
        x: rect.right + 10,
        y: rect.top,
      };

      previewTooltipTimeoutRef.current = setTimeout(async () => {
        setActivePreviewTooltip({
          noteId,
          content: '',
          position,
          status: 'loading',
        });

        try {
          const response = await fetchWithKnowledgeBase(`/api/items/${noteId}`);
          if (!response.ok) {
            throw new Error('Failed to fetch note');
          }

          const data = await response.json();
          const content = data?.item?.content;
          const contentText = data?.item?.contentText;

          const previewText = buildMultilinePreview(
            content,
            contentText || '',
            Number.MAX_SAFE_INTEGER
          );

          setActivePreviewTooltip({
            noteId,
            content: previewText || 'No content yet',
            position,
            status: 'ready',
          });
        } catch (error) {
          console.error('[PopupOverlay] Failed to fetch preview:', error);
          setActivePreviewTooltip({
            noteId,
            content: 'Failed to load preview',
            position,
            status: 'error',
          });
        }
      }, 500);
    },
    [fetchWithKnowledgeBase]
  );

  const handlePreviewTooltipLeave = useCallback(() => {
    if (previewTooltipTimeoutRef.current) {
      clearTimeout(previewTooltipTimeoutRef.current);
    }

    previewTooltipCloseTimeoutRef.current = setTimeout(() => {
      if (!isHoveringPreviewTooltipRef.current) {
        setActivePreviewTooltip(null);
      }
    }, PREVIEW_HOVER_DELAY_MS);
  }, []);

  const handlePreviewTooltipEnter = useCallback(() => {
    isHoveringPreviewTooltipRef.current = true;
    if (previewTooltipCloseTimeoutRef.current) {
      clearTimeout(previewTooltipCloseTimeoutRef.current);
    }
  }, []);

  const handlePreviewTooltipMouseLeave = useCallback(() => {
    isHoveringPreviewTooltipRef.current = false;

    previewTooltipCloseTimeoutRef.current = setTimeout(() => {
      setActivePreviewTooltip(null);
    }, PREVIEW_HOVER_DELAY_MS);
  }, []);

  const dismissPreviewTooltip = useCallback(() => {
    setActivePreviewTooltip(null);
  }, []);

  const handleItemSelect = useCallback(
    (
      popupId: string,
      childId: string,
      children: PopupChildNode[],
      event: React.MouseEvent
    ) => {
      const isMultiSelect = event.metaKey || event.ctrlKey;
      const isShiftSelect = event.shiftKey;

      if (isMultiSelect) {
        setPopupSelections((prev) => {
          const next = new Map(prev);
          const currentSelection = new Set(prev.get(popupId) || []);

          if (currentSelection.has(childId)) {
            currentSelection.delete(childId);
          } else {
            currentSelection.add(childId);
          }

          next.set(popupId, currentSelection);
          return next;
        });

        setLastSelectedIdForPopup(popupId, childId);
      } else if (isShiftSelect) {
        const lastId = lastSelectedIds.get(popupId);
        if (!lastId) {
          setSelectionForPopup(popupId, [childId]);
          setLastSelectedIdForPopup(popupId, childId);
          return;
        }

        const startIndex = children.findIndex((c) => c.id === lastId);
        const endIndex = children.findIndex((c) => c.id === childId);

        if (startIndex === -1 || endIndex === -1) {
          setSelectionForPopup(popupId, [childId]);
          return;
        }

        const minIndex = Math.min(startIndex, endIndex);
        const maxIndex = Math.max(startIndex, endIndex);
        const rangeIds = children.slice(minIndex, maxIndex + 1).map((c) => c.id);
        setSelectionForPopup(popupId, rangeIds);
      } else {
        setSelectionForPopup(popupId, [childId]);
        setLastSelectedIdForPopup(popupId, childId);
      }
    },
    [lastSelectedIds, setLastSelectedIdForPopup, setSelectionForPopup]
  );

  const handleClearSelection = useCallback(
    (popupId: string) => {
      setSelectionForPopup(popupId, []);
      setLastSelectedIdForPopup(popupId, null);
    },
    [setLastSelectedIdForPopup, setSelectionForPopup]
  );

  const handleDeleteSelected = useCallback(
    (popupId: string) => {
      const selectedIds = popupSelections.get(popupId);
      if (!selectedIds || selectedIds.size === 0) return;

      const count = selectedIds.size;
      const confirmMsg = `Delete ${count} ${count === 1 ? 'item' : 'items'}?`;

      if (confirm(confirmMsg)) {
        onDeleteSelected?.(popupId, selectedIds);
        handleClearSelection(popupId);
      }
    },
    [handleClearSelection, onDeleteSelected, popupSelections]
  );

  const handleDragStart = useCallback(
    (popupId: string, childId: string, event: React.DragEvent) => {
      const selectedInPopup = popupSelections.get(popupId) || new Set();
      const itemsToDrag = selectedInPopup.has(childId) ? selectedInPopup : new Set([childId]);

      setDraggedItems(itemsToDrag);
      setDragSourcePopupId(popupId);
      setDragSourceFolderId(childId);

      if (event.dataTransfer) {
        event.dataTransfer.setData('text/plain', childId);
        event.dataTransfer.setData('application/popup-ids', JSON.stringify(Array.from(itemsToDrag)));
        event.dataTransfer.effectAllowed = 'move';
      }

      const popup = popups.get(popupId);
      if (popup && itemsToDrag.size > 1) {
        const dragPreview = document.createElement('div');
        dragPreview.className = 'drag-preview';
        dragPreview.textContent = `${itemsToDrag.size} items`;
        dragPreview.style.position = 'absolute';
        dragPreview.style.top = '-1000px';
        document.body.appendChild(dragPreview);
        event.dataTransfer?.setDragImage(dragPreview, 0, 0);
        setTimeout(() => document.body.removeChild(dragPreview), 0);
      }
    },
    [popupSelections, popups]
  );

  const handleDragOver = useCallback(
    (childId: string, isFolder: boolean, event: React.DragEvent) => {
      if (!isFolder) return;

      event.preventDefault();

      const isInvalid = draggedItems.has(childId) || childId === dragSourceFolderId;

      if (isInvalid) {
        event.dataTransfer.dropEffect = 'none';
        setInvalidDropTargetId(childId);
        setDropTargetId(null);
      } else {
        event.dataTransfer.dropEffect = 'move';
        setDropTargetId(childId);
        setInvalidDropTargetId(null);
      }
    },
    [dragSourceFolderId, draggedItems]
  );

  const handleDragLeave = useCallback((event: React.DragEvent) => {
    const related = event.relatedTarget as HTMLElement;
    if (!related || !related.closest('[data-drop-zone]')) {
      setDropTargetId(null);
      setInvalidDropTargetId(null);
    }
  }, []);

  const handleDragEnd = useCallback(() => {
    setDraggedItems(new Set());
    setDropTargetId(null);
    setInvalidDropTargetId(null);
    setDragSourcePopupId(null);
    setDragSourceFolderId(null);
    setIsPopupDropTarget(null);
  }, []);

  const handleDrop = useCallback(
    async (targetFolderId: string, event: React.DragEvent) => {
      event.preventDefault();
      event.stopPropagation();

      const itemIds = Array.from(draggedItems);
      if (itemIds.length === 0) return;

      if (itemIds.includes(targetFolderId)) {
        setDropTargetId(null);
        return;
      }

      let targetPopupId: string | null = null;
      popups.forEach((popup, popupId) => {
        if ((popup as any).folderId === targetFolderId) {
          targetPopupId = popupId;
        }
      });

      if (onBulkMove && dragSourcePopupId) {
        await onBulkMove(itemIds, targetFolderId, dragSourcePopupId);
      }

      setPopupSelections((prev) => {
        const next = new Map(prev);
        if (dragSourcePopupId) {
          next.delete(dragSourcePopupId);
        }
        if (targetPopupId) {
          next.set(targetPopupId, new Set(itemIds));
        }
        return next;
      });

      handleDragEnd();
    },
    [dragSourcePopupId, draggedItems, handleDragEnd, onBulkMove, popups]
  );

  const handlePopupDragOver = useCallback(
    (popupId: string, folderId: string, event: React.DragEvent) => {
      if (draggedItems.size === 0) return;

      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      setIsPopupDropTarget(popupId);
    },
    [draggedItems]
  );

  const handlePopupDragLeave = useCallback((popupId: string, event: React.DragEvent) => {
    const related = event.relatedTarget as HTMLElement;
    if (!related || !related.closest(`[data-popup-id="${popupId}"]`)) {
      setIsPopupDropTarget(null);
    }
  }, []);

  const handlePopupDrop = useCallback(
    async (folderId: string, popupId: string, event: React.DragEvent) => {
      event.preventDefault();
      event.stopPropagation();

      const itemIds = Array.from(draggedItems);
      if (itemIds.length === 0) return;

      if (itemIds.includes(folderId)) {
        setIsPopupDropTarget(null);
        return;
      }

      if (onBulkMove && dragSourcePopupId) {
        await onBulkMove(itemIds, folderId, dragSourcePopupId);
      }

      setPopupSelections((prev) => {
        const next = new Map(prev);
        if (dragSourcePopupId) {
          next.delete(dragSourcePopupId);
        }
        next.set(popupId, new Set(itemIds));
        return next;
      });

      setIsPopupDropTarget(null);
      handleDragEnd();
    },
    [dragSourcePopupId, draggedItems, handleDragEnd, onBulkMove]
  );

  useEffect(() => {
    const activeIds = new Set<string>();
    popups.forEach((_, id) => activeIds.add(id));
    setPreviewState((prev) => {
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
    const activeIds = new Set<string>();
    popups.forEach((_, id) => activeIds.add(id));

    setPopupSelections((prev) => {
      let mutated = false;
      const next = new Map<string, Set<string>>();
      prev.forEach((selection, id) => {
        if (activeIds.has(id)) {
          next.set(id, selection);
        } else {
          mutated = true;
        }
      });
      return mutated ? next : prev;
    });

    setLastSelectedIds((prev) => {
      let mutated = false;
      const next = new Map<string, string>();
      prev.forEach((lastId, popupId) => {
        if (activeIds.has(popupId)) {
          next.set(popupId, lastId);
        } else {
          mutated = true;
        }
      });
      return mutated ? next : prev;
    });

    if (dragSourcePopupId && !activeIds.has(dragSourcePopupId)) {
      setDraggedItems(new Set());
      setDropTargetId(null);
      setInvalidDropTargetId(null);
      setDragSourcePopupId(null);
      setDragSourceFolderId(null);
      setIsPopupDropTarget(null);
    }
  }, [dragSourcePopupId, popups]);

  useEffect(() => {
    popups.forEach((popup, id) => {
      const entry = previewStateRef.current[id];
      const children = (popup.folder?.children ?? []) as PopupChildNode[];

      if (!entry) {
        return;
      }

      const activeChildId = entry.activeChildId;
      if (activeChildId && children.some((child) => child.id === activeChildId && isNoteLikeNode(child))) {
        return;
      }

      if (activeChildId !== null) {
        setPreviewState((prev) => {
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
  }, [popups]);

  return {
    previewState,
    requestPreview,
    popupSelections,
    handleItemSelect,
    handleClearSelection,
    handleDeleteSelected,
    setSelectionForPopup,
    setLastSelectedIdForPopup,
    hoverHighlightedPopup,
    setHoverHighlightedPopup,
    hoverHighlightTimeoutRef,
    draggedItems,
    dropTargetId,
    invalidDropTargetId,
    isPopupDropTarget,
    handleDragStart,
    handleDragOver,
    handleDragLeave,
    handleDragEnd,
    handleDrop,
    handlePopupDragOver,
    handlePopupDragLeave,
    handlePopupDrop,
    activePreviewTooltip,
    handlePreviewTooltipHover,
    handlePreviewTooltipLeave,
    handlePreviewTooltipEnter,
    handlePreviewTooltipMouseLeave,
    dismissPreviewTooltip,
  };
}
