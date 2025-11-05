import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type React from 'react';
import { Transform } from '@/lib/utils/coordinate-bridge';
import { getUIResourceManager } from '@/lib/ui/resource-manager';
import { debugLog } from '@/lib/utils/debug-logger';
import type { LayerContextValue } from '@/components/canvas/layer-provider';
import {
  IDENTITY_TRANSFORM,
} from '@/components/canvas/popup-overlay/constants';
import type { PopupData } from '@/components/canvas/popup-overlay/types';

interface UseOverlayPanStateOptions {
  overlayRef: React.RefObject<HTMLDivElement>;
  containerRef: React.RefObject<HTMLDivElement>;
  popups: Map<string, PopupData>;
  isOverlayEmptySpace: (e: React.PointerEvent) => boolean;
  multiLayerEnabled: boolean;
  layerCtx: LayerContextValue | null;
  isLocked: boolean;
  debugLoggingEnabled: boolean;
}

interface UseOverlayPanStateResult {
  activeTransform: Transform;
  containerStyle: React.CSSProperties;
  handlePointerDown: (e: React.PointerEvent) => void;
  handlePointerMove: (e: React.PointerEvent) => void;
  handlePointerEnd: (e: React.PointerEvent) => void;
  hasSharedCamera: boolean;
  isActiveLayer: boolean;
  isPanning: boolean;
}

export function useOverlayPanState({
  overlayRef,
  containerRef,
  popups,
  isOverlayEmptySpace,
  multiLayerEnabled,
  layerCtx,
  isLocked,
  debugLoggingEnabled,
}: UseOverlayPanStateOptions): UseOverlayPanStateResult {
  const [transform, setTransform] = useState<Transform>(IDENTITY_TRANSFORM);
  const [isPanning, setIsPanning] = useState(false);
  const isPanningRef = useRef(false);
  const transformRef = useRef<Transform>(IDENTITY_TRANSFORM);
  const rafIdRef = useRef<number | null>(null);
  const lastRafTsRef = useRef(0);
  const [engaged, setEngaged] = useState(false);
  const panStartRef = useRef({ x: 0, y: 0 });
  const lastMouseRef = useRef({ x: 0, y: 0 });
  const pointerIdRef = useRef<number | null>(null);

  const hasSharedCamera =
    multiLayerEnabled && layerCtx?.layers instanceof Map && layerCtx.layers.size > 0;
  const sharedTransform = hasSharedCamera ? layerCtx?.transforms.popups || IDENTITY_TRANSFORM : null;
  const activeTransform = sharedTransform ?? transform;
  const isActiveLayer = !!layerCtx && layerCtx.activeLayer === 'popups';

  useEffect(() => {
    if (hasSharedCamera && sharedTransform) {
      transformRef.current = { ...sharedTransform };
    }
  }, [hasSharedCamera, sharedTransform]);

  const selectionGuardsRef = useRef<{
    onSelectStart: (e: Event) => void;
    onDragStart: (e: Event) => void;
    prevUserSelect: string;
  } | null>(null);

  const enableSelectionGuards = useCallback(() => {
    if (typeof document === 'undefined') return;
    if (selectionGuardsRef.current) return;
    const onSelectStart = (e: Event) => e.preventDefault();
    const onDragStart = (e: Event) => e.preventDefault();
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
      // ignore
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

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      const sidebarEl = document.querySelector('[data-sidebar="sidebar"]') as HTMLElement | null;
      if (sidebarEl) {
        const rect = sidebarEl.getBoundingClientRect();
        if (
          e.clientX >= rect.left &&
          e.clientX <= rect.right &&
          e.clientY >= rect.top &&
          e.clientY <= rect.bottom
        ) {
          debugLog('PopupOverlay', 'pointer_blocked_over_sidebar', {
            clientX: e.clientX,
            clientY: e.clientY,
            sidebarRect: { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom },
          });
          return;
        }
      }

      if (isLocked) {
        debugLog('PopupOverlay', 'pan_blocked_locked_state', {
          popupCount: popups.size,
          activeLayer: layerCtx?.activeLayer || 'none',
        });
        return;
      }

      console.log('[PopupOverlay] pointerDown:', {
        target: (e.target as HTMLElement).className,
        isEmptySpace: isOverlayEmptySpace(e),
        isActiveLayer,
        popupCount: popups.size,
        layerCtx: layerCtx?.activeLayer || 'none',
        clientX: e.clientX,
        clientY: e.clientY,
      });

      getUIResourceManager().enqueueLowPriority(() => {
        debugLog('PopupOverlay', 'pointer_down_received', {
          target: (e.target as HTMLElement).className,
          isEmptySpace: isOverlayEmptySpace(e),
          isActiveLayer,
          popupCount: popups.size,
          layerCtx: layerCtx?.activeLayer || 'none',
        });
      });

      if (!isOverlayEmptySpace(e)) {
        getUIResourceManager().enqueueLowPriority(() => {
          debugLog('PopupOverlay', 'pan_blocked_not_empty_space', {
            target: (e.target as HTMLElement).className,
          });
        });
        return;
      }

      const hasPopups = popups.size > 0;
      if (!hasPopups) {
        getUIResourceManager().enqueueLowPriority(() => {
          debugLog('PopupOverlay', 'pan_blocked', {
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
          debugLog('PopupOverlay', 'pan_blocked_inactive_layer', {
            isActiveLayer,
            layerCtx: layerCtx?.activeLayer || 'none',
            reason: 'inactive_layer',
          });
        });
        return;
      }

      console.log('[PopupOverlay] PAN START!', {
        clientX: e.clientX,
        clientY: e.clientY,
        transform: activeTransform,
        pointerId: e.pointerId,
      });

      getUIResourceManager().enqueueLowPriority(() => {
        debugLog('PopupOverlay', 'pan_start', {
          clientX: e.clientX,
          clientY: e.clientY,
          currentTransform: activeTransform,
          pointerId: e.pointerId,
          isActiveLayer,
          popupCount: popups.size,
        });
      });

      isPanningRef.current = true;
      setIsPanning(true);
      setEngaged(false);
      panStartRef.current = { x: e.clientX, y: e.clientY };
      lastMouseRef.current = { x: e.clientX, y: e.clientY };
      pointerIdRef.current = e.pointerId;

      try {
        if (e.pointerId !== undefined && overlayRef.current) {
          overlayRef.current.setPointerCapture(e.pointerId);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        debugLog('PopupOverlay', 'pointer_capture_failed', {
          error: message,
          pointerId: e.pointerId,
        });
      }

      enableSelectionGuards();
      document.body.style.userSelect = 'none';
      if (hasSharedCamera && layerCtx) {
        layerCtx.setGesture('overlay-pan');
        transformRef.current = { ...activeTransform };
      } else if (containerRef.current) {
        const { x, y, scale } = transform;
        containerRef.current.style.willChange = 'transform';
        containerRef.current.style.backfaceVisibility = 'hidden';
        containerRef.current.style.perspective = '1000px';
        transformRef.current = { x, y, scale };
        containerRef.current.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(
          y
        )}px, 0) scale(${scale})`;
      }
      if (overlayRef.current) overlayRef.current.style.cursor = 'grabbing';

      e.preventDefault();
    },
    [
      activeTransform,
      containerRef,
      enableSelectionGuards,
      hasSharedCamera,
      isActiveLayer,
      isLocked,
      isOverlayEmptySpace,
      layerCtx,
      overlayRef,
      popups.size,
      transform,
    ]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!isPanningRef.current || pointerIdRef.current === null) {
        debugLog('PopupOverlay', 'pan_move_blocked', {
          isPanning: isPanningRef.current,
          pointerIdRef: pointerIdRef.current,
          reason: !isPanningRef.current ? 'not_panning' : 'no_pointer_id',
        });
        return;
      }

      const deltaX = e.clientX - lastMouseRef.current.x;
      const deltaY = e.clientY - lastMouseRef.current.y;

      if (!engaged) {
        const dx0 = e.clientX - panStartRef.current.x;
        const dy0 = e.clientY - panStartRef.current.y;
        if (Math.hypot(dx0, dy0) < 1) return;
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
          containerRef.current.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(
            y
          )}px, 0) scale(${scale})`;
        }
        if (rafIdRef.current == null) {
          rafIdRef.current = requestAnimationFrame((ts) => {
            rafIdRef.current = null;
            if (ts - lastRafTsRef.current < 16) return;
            lastRafTsRef.current = ts;
            const { x, y, scale } = transformRef.current;
            if (containerRef.current) {
              containerRef.current.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(
                y
              )}px, 0) scale(${scale})`;
            }
          });
        }
      }

      lastMouseRef.current = { x: e.clientX, y: e.clientY };
    },
    [containerRef, engaged, hasSharedCamera, layerCtx]
  );

  const handlePointerEnd = useCallback(
    (e: React.PointerEvent) => {
      if (!isPanningRef.current) return;

      getUIResourceManager().enqueueLowPriority(() => {
        debugLog('PopupOverlay', 'pan_end', {
          totalDelta: {
            x: activeTransform.x,
            y: activeTransform.y,
          },
          pointerId: e.pointerId,
          wasEngaged: engaged,
        });
      });

      isPanningRef.current = false;
      setIsPanning(false);
      setEngaged(false);

      if (pointerIdRef.current !== null && overlayRef.current) {
        try {
          overlayRef.current.releasePointerCapture(pointerIdRef.current);
        } catch {
          // ignore
        }
      }
      pointerIdRef.current = null;
      disableSelectionGuards();

      if (hasSharedCamera && layerCtx) {
        layerCtx.setGesture('none');
      } else if (containerRef.current) {
        containerRef.current.style.willChange = 'auto';
      }

      if (!hasSharedCamera) {
        setTransform((prev) => ({ ...prev, ...transformRef.current }));
      }
      if (overlayRef.current) overlayRef.current.style.cursor = '';

      if (rafIdRef.current) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
    },
    [
      activeTransform.x,
      activeTransform.y,
      containerRef,
      disableSelectionGuards,
      engaged,
      hasSharedCamera,
      layerCtx,
      overlayRef,
    ]
  );

  useEffect(() => {
    if (!debugLoggingEnabled) return;
    getUIResourceManager().enqueueLowPriority(() => {
      debugLog('PopupOverlay', 'layer_state', {
        isActiveLayer,
        activeLayer: layerCtx?.activeLayer || 'none',
        popupCount: popups.size,
        canInteract: isActiveLayer && popups.size > 0,
      });
    });
  }, [debugLoggingEnabled, isActiveLayer, layerCtx?.activeLayer, popups.size]);

  const containerStyle: React.CSSProperties = useMemo(() => {
    const roundedX = Math.round(activeTransform.x * 2) / 2;
    const roundedY = Math.round(activeTransform.y * 2) / 2;
    return {
      transform: `translate3d(${roundedX}px, ${roundedY}px, 0) scale(${activeTransform.scale})`,
      transformOrigin: '0 0',
      willChange: isPanning && !hasSharedCamera ? 'transform' : 'auto',
      backfaceVisibility: 'hidden',
      transformStyle: 'preserve-3d',
      transition: 'none',
      isolation: 'isolate',
      WebkitTransform: `translate3d(${roundedX}px, ${roundedY}px, 0) scale(${activeTransform.scale})`,
      WebkitFontSmoothing: 'antialiased',
      MozOsxFontSmoothing: 'grayscale',
      opacity: isPanning && !hasSharedCamera ? 0.999 : 1,
    };
  }, [activeTransform, hasSharedCamera, isPanning]);

  return {
    activeTransform,
    containerStyle,
    handlePointerDown,
    handlePointerMove,
    handlePointerEnd,
    hasSharedCamera,
    isActiveLayer,
    isPanning,
  };
}
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
