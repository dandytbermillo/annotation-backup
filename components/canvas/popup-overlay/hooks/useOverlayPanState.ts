import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import type React from 'react';
import type { Transform } from '@/lib/utils/coordinate-bridge';
import type { LayerContextValue } from '@/components/canvas/layer-provider';
import { getUIResourceManager } from '@/lib/ui/resource-manager';
import { IDENTITY_TRANSFORM } from '../constants';

type PointerLogger = (...args: any[]) => Promise<void>;

interface UseOverlayPanStateParams {
  overlayRef: React.RefObject<HTMLDivElement | null>;
  containerRef: React.RefObject<HTMLDivElement | null>;
  sidebarRectRef: React.MutableRefObject<DOMRect | null>;
  multiLayerEnabled: boolean;
  layerCtx: LayerContextValue | null;
  isLocked: boolean;
  popupsCount: number;
  isOverlayEmptySpace: (event: React.PointerEvent) => boolean;
  overlayFullSpanEnabled: boolean;
  tracePointerLog: PointerLogger;
}

interface UseOverlayPanStateResult {
  activeTransform: Transform;
  hasSharedCamera: boolean;
  isActiveLayer: boolean;
  isPanning: boolean;
  handlePointerDown: (event: React.PointerEvent) => void;
  handlePointerMove: (event: React.PointerEvent) => void;
  handlePointerUp: (event: React.PointerEvent) => void;
  applyExternalTransform: (transform: Transform) => void;
}

export function useOverlayPanState({
  overlayRef,
  containerRef,
  sidebarRectRef,
  multiLayerEnabled,
  layerCtx,
  isLocked,
  popupsCount,
  isOverlayEmptySpace,
  overlayFullSpanEnabled,
  tracePointerLog,
}: UseOverlayPanStateParams): UseOverlayPanStateResult {
  const [transform, setTransform] = useState<Transform>(IDENTITY_TRANSFORM);
  const [isPanning, setIsPanning] = useState(false);
  const [engaged, setEngaged] = useState(false);
  const transformRef = useRef<Transform>(IDENTITY_TRANSFORM);
  const isPanningRef = useRef(false);
  const panStartRef = useRef({ x: 0, y: 0 });
  const lastMouseRef = useRef({ x: 0, y: 0 });
  const pointerIdRef = useRef<number | null>(null);
  const rafIdRef = useRef<number | null>(null);
  const lastRafTsRef = useRef(0);
  const selectionGuardsRef = useRef<{
    onSelectStart: (event: Event) => void;
    onDragStart: (event: Event) => void;
    prevUserSelect: string;
  } | null>(null);

  const hasSharedCamera =
    multiLayerEnabled && layerCtx?.layers instanceof Map && layerCtx.layers.size > 0;
  const sharedTransform = hasSharedCamera
    ? layerCtx?.transforms.popups ?? IDENTITY_TRANSFORM
    : null;
  const activeTransform = sharedTransform ?? transform;
  const isActiveLayer = !!layerCtx && layerCtx.activeLayer === 'popups';

  useEffect(() => {
    if (hasSharedCamera && sharedTransform) {
      transformRef.current = { ...sharedTransform };
    }
  }, [hasSharedCamera, sharedTransform]);

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
    if (selectionGuardsRef.current) return;
    const onSelectStart = (event: Event) => { event.preventDefault(); };
    const onDragStart = (event: Event) => { event.preventDefault(); };
    selectionGuardsRef.current = {
      onSelectStart,
      onDragStart,
      prevUserSelect: document.body.style.userSelect,
    };
    document.documentElement.classList.add('dragging-no-select');
    document.body.style.userSelect = 'none';
    document.addEventListener('selectstart', onSelectStart, true);
    document.addEventListener('dragstart', onDragStart, true);
    try {
      window.getSelection()?.removeAllRanges?.();
    } catch {
      // ignore selection removal failures
    }
  }, []);

  const disableSelectionGuards = useCallback(() => {
    if (typeof document === 'undefined') return;
    const guards = selectionGuardsRef.current;
    if (!guards) return;
    document.removeEventListener('selectstart', guards.onSelectStart, true);
    document.removeEventListener('dragstart', guards.onDragStart, true);
    document.documentElement.classList.remove('dragging-no-select');
    document.body.style.userSelect = guards.prevUserSelect || '';
    selectionGuardsRef.current = null;
  }, []);

  const isPointerOverSidebar = useMemo(
    () => (clientX: number, clientY: number) => {
      if (!overlayFullSpanEnabled) {
        return false;
      }
      const rect = sidebarRectRef.current;
      if (!rect) return false;
      return (
        clientX >= rect.left &&
        clientX <= rect.right &&
        clientY >= rect.top &&
        clientY <= rect.bottom
      );
    },
    [overlayFullSpanEnabled, sidebarRectRef]
  );

  const applyExternalTransform = useCallback((nextTransform: Transform) => {
    transformRef.current = nextTransform;
    setTransform(nextTransform);
  }, []);

  const handlePointerDown = useCallback(
    (event: React.PointerEvent) => {
      if (isPointerOverSidebar(event.clientX, event.clientY)) {
        tracePointerLog('PopupOverlay', 'pointer_blocked_over_sidebar', {
          clientX: event.clientX,
          clientY: event.clientY,
          sidebarRect: sidebarRectRef.current
            ? {
                left: sidebarRectRef.current.left,
                right: sidebarRectRef.current.right,
                top: sidebarRectRef.current.top,
                bottom: sidebarRectRef.current.bottom,
              }
            : null,
        });
        return;
      }

      if (isLocked) {
        tracePointerLog('PopupOverlay', 'pan_blocked_locked_state', {
          popupCount: popupsCount,
          activeLayer: layerCtx?.activeLayer || 'none',
        });
        return;
      }

      void tracePointerLog({
        component: 'PopupOverlay',
        action: 'pointer_down_event',
        metadata: {
          target: (event.target as HTMLElement).className,
          isEmptySpace: isOverlayEmptySpace(event),
          isActiveLayer,
          popupCount: popupsCount,
          layerCtx: layerCtx?.activeLayer || 'none',
          clientX: event.clientX,
          clientY: event.clientY,
        },
      });

      getUIResourceManager().enqueueLowPriority(() => {
        tracePointerLog('PopupOverlay', 'pointer_down_received', {
          target: (event.target as HTMLElement).className,
          isEmptySpace: isOverlayEmptySpace(event),
          isActiveLayer,
          popupCount: popupsCount,
          layerCtx: layerCtx?.activeLayer || 'none',
        });
      });

      if (!isOverlayEmptySpace(event)) {
        getUIResourceManager().enqueueLowPriority(() => {
          tracePointerLog('PopupOverlay', 'pan_blocked_not_empty_space', {
            target: (event.target as HTMLElement).className,
          });
        });
        return;
      }

      const hasPopups = popupsCount > 0;
      if (!hasPopups) {
        getUIResourceManager().enqueueLowPriority(() => {
          tracePointerLog('PopupOverlay', 'pan_blocked', {
            isActiveLayer,
            hasPopups,
            layerCtx: layerCtx?.activeLayer || 'none',
            reason: 'no_popups',
          });
        });
        return;
      }

      if (!isActiveLayer) {
        getUIResourceManager().enqueueLowPriority(() => {
          tracePointerLog('PopupOverlay', 'pan_blocked_inactive_layer', {
            isActiveLayer,
            layerCtx: layerCtx?.activeLayer || 'none',
            reason: 'inactive_layer',
          });
        });
        return;
      }

      void tracePointerLog({
        component: 'PopupOverlay',
        action: 'pan_start_event',
        metadata: {
          clientX: event.clientX,
          clientY: event.clientY,
          transform: activeTransform,
          pointerId: event.pointerId,
        },
      });

      getUIResourceManager().enqueueLowPriority(() => {
        tracePointerLog('PopupOverlay', 'pan_start', {
          clientX: event.clientX,
          clientY: event.clientY,
          currentTransform: activeTransform,
          pointerId: event.pointerId,
          isActiveLayer,
          popupCount: popupsCount,
        });
      });

      isPanningRef.current = true;
      setIsPanning(true);
      setEngaged(false);
      panStartRef.current = { x: event.clientX, y: event.clientY };
      lastMouseRef.current = { x: event.clientX, y: event.clientY };
      pointerIdRef.current = event.pointerId;

      try {
        if (event.pointerId !== undefined && overlayRef.current) {
          overlayRef.current.setPointerCapture(event.pointerId);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        tracePointerLog('PopupOverlay', 'pointer_capture_failed', {
          error: message,
          pointerId: event.pointerId,
        });
      }

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

      if (overlayRef.current) {
        overlayRef.current.style.cursor = 'grabbing';
      }

      event.preventDefault();
    },
    [
      activeTransform,
      hasSharedCamera,
      isActiveLayer,
      isLocked,
      isOverlayEmptySpace,
      isPointerOverSidebar,
      layerCtx,
      overlayRef,
      containerRef,
      popupsCount,
      tracePointerLog,
      transform,
      enableSelectionGuards,
    ]
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent) => {
      if (!isPanningRef.current || pointerIdRef.current === null) {
        tracePointerLog('PopupOverlay', 'pan_move_blocked', {
          isPanning: isPanningRef.current,
          pointerIdRef: pointerIdRef.current,
          reason: !isPanningRef.current ? 'not_panning' : 'no_pointer_id',
        });
        return;
      }

      const deltaX = event.clientX - lastMouseRef.current.x;
      const deltaY = event.clientY - lastMouseRef.current.y;

      if (!engaged) {
        const dx0 = event.clientX - panStartRef.current.x;
        const dy0 = event.clientY - panStartRef.current.y;
        if (Math.hypot(dx0, dy0) < 1) return;
        setEngaged(true);
        getUIResourceManager().enqueueLowPriority(() => {
          tracePointerLog('PopupOverlay', 'pan_engaged', { threshold: Math.hypot(dx0, dy0) });
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
          rafIdRef.current = requestAnimationFrame((timestamp) => {
            rafIdRef.current = null;
            if (timestamp - lastRafTsRef.current < 16) return;
            lastRafTsRef.current = timestamp;
            const { x, y, scale } = transformRef.current;
            if (containerRef.current) {
              containerRef.current.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0) scale(${scale})`;
            }
          });
        }
      }

      lastMouseRef.current = { x: event.clientX, y: event.clientY };
    },
    [engaged, hasSharedCamera, layerCtx, tracePointerLog]
  );

  const handlePointerUp = useCallback(
    (event: React.PointerEvent) => {
      if (!isPanningRef.current) return;

      getUIResourceManager().enqueueLowPriority(() => {
        tracePointerLog('PopupOverlay', 'pan_end', {
          totalDelta: {
            x: activeTransform.x,
            y: activeTransform.y,
          },
          pointerId: event.pointerId,
          wasEngaged: engaged,
        });
      });

      isPanningRef.current = false;
      setIsPanning(false);
      setEngaged(false);

      if (pointerIdRef.current !== null && overlayRef.current) {
        try {
          overlayRef.current.releasePointerCapture(pointerIdRef.current);
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown error';
          tracePointerLog('PopupOverlay', 'pointer_release_failed', {
            error: message,
            pointerId: pointerIdRef.current,
          });
        }
        overlayRef.current.style.cursor = '';
        pointerIdRef.current = null;
      }

      document.body.style.userSelect = '';
      if (!hasSharedCamera && containerRef.current) {
        containerRef.current.style.willChange = 'auto';
        containerRef.current.style.backfaceVisibility = '';
        containerRef.current.style.perspective = '';
        containerRef.current.style.transform = '';
      }

      if (!hasSharedCamera) {
        setTransform((prev) => ({ ...prev, ...transformRef.current }));
      }
      if (rafIdRef.current) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
      disableSelectionGuards();
      if (hasSharedCamera && layerCtx) {
        layerCtx.setGesture('none');
      }
    },
    [activeTransform, disableSelectionGuards, engaged, hasSharedCamera, layerCtx, tracePointerLog, overlayRef]
  );

  return {
    activeTransform,
    hasSharedCamera,
    isActiveLayer,
    isPanning,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    applyExternalTransform,
  };
}
