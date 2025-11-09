import { useCallback, useEffect, useMemo, useState } from 'react';
import type React from 'react';
import { CoordinateBridge, type Transform } from '@/lib/utils/coordinate-bridge';
import { ensureFloatingOverlayHost } from '@/lib/utils/overlay-host';
import { DEFAULT_POPUP_HEIGHT, DEFAULT_POPUP_WIDTH } from '../constants';
import type { PopupData } from '../types';
import type { LayerContextValue } from '@/components/canvas/layer-provider';

interface UseOverlayViewportOptions {
  popups: Map<string, PopupData>;
  overlayFullSpanEnabled: boolean;
  debugLog: (...args: any[]) => Promise<void>;
  sidebarOpen?: boolean;
  activeTransform: Transform;
  hasSharedCamera: boolean;
  applyExternalTransform: (next: Transform) => void;
  layerCtx: LayerContextValue | null;
  sidebarRectRef: React.MutableRefObject<DOMRect | null>;
}

interface UseOverlayViewportResult {
  overlayBounds: { top: number; left: number; width: number; height: number } | null;
  pointerGuardOffset: number;
  visiblePopups: PopupData[];
  cascadeChildCountMap: Map<string, number>;
  viewportSize: { width: number; height: number };
  handleMinimapNavigate: (coords: { x: number; y: number }) => void;
  recomputeOverlayBounds: () => void;
}

export function useOverlayViewport({
  popups,
  overlayFullSpanEnabled,
  debugLog,
  sidebarOpen,
  activeTransform,
  hasSharedCamera,
  applyExternalTransform,
  layerCtx,
  sidebarRectRef,
}: UseOverlayViewportOptions): UseOverlayViewportResult {
  const [overlayBounds, setOverlayBounds] = useState<{
    top: number;
    left: number;
    width: number;
    height: number;
  } | null>(null);
  const [pointerGuardOffset, setPointerGuardOffset] = useState(0);

  const recomputeOverlayBounds = useCallback(() => {
    if (typeof window === 'undefined') return;
    const canvasEl = document.getElementById('canvas-container');
    const sidebarEl = document.querySelector('[data-sidebar=\"sidebar\"]') as HTMLElement | null;
    const sidebarRect = sidebarEl?.getBoundingClientRect() ?? null;
    sidebarRectRef.current = sidebarRect;

    if (canvasEl) {
      const rect = canvasEl.getBoundingClientRect();
      let guardOffset = 0;

      if (sidebarRect) {
        const sidebarWidth = sidebarRect.width;
        const isSidebarVisible = sidebarWidth > 0 && sidebarRect.right > rect.left + 1;
        if (isSidebarVisible) {
          guardOffset = Math.max(0, sidebarRect.right - rect.left);
          if (guardOffset > 0) {
            debugLog('PopupOverlay', 'bounds_sidebar_detected', {
              sidebarWidth,
              sidebarRight: sidebarRect.right,
              canvasLeft: rect.left,
              guardOffset,
            });
          }
        }
      }

      const baseBounds = {
        top: Math.max(0, rect.top),
        left: Math.max(0, rect.left),
        width: Math.max(0, rect.width),
        height: Math.max(0, rect.height),
      };

      let resolvedBounds = baseBounds;
      if (!overlayFullSpanEnabled && guardOffset > 0) {
        const effectiveLeft = rect.left + guardOffset;
        resolvedBounds = {
          top: baseBounds.top,
          left: Math.max(0, effectiveLeft),
          width: Math.max(0, rect.right - effectiveLeft),
          height: baseBounds.height,
        };
      }

      setOverlayBounds(resolvedBounds);
      setPointerGuardOffset(guardOffset);
      debugLog(
        'PopupOverlay',
        overlayFullSpanEnabled ? 'overlay_bounds_full_span' : 'overlay_bounds_updated',
        {
          rect,
          guardOffset,
          sidebarPresent: !!sidebarRect,
          overlayBounds: resolvedBounds,
          overlayFullSpanEnabled,
        }
      );
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
        debugLog('PopupOverlay', 'overlay_bounds_fallback', {
          hostId: fallbackHost.id,
          rect,
        });
      } else {
        setOverlayBounds({ top: 0, left: 0, width: window.innerWidth, height: window.innerHeight });
        setPointerGuardOffset(0);
      }
    }
  }, [debugLog, overlayFullSpanEnabled, sidebarRectRef]);

  useEffect(() => {
    recomputeOverlayBounds();
    const onResize = () => recomputeOverlayBounds();
    const onScroll = () => recomputeOverlayBounds();
    window.addEventListener('resize', onResize);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', onScroll as any);
    };
  }, [recomputeOverlayBounds]);

  useEffect(() => {
    const sidebarEl = document.querySelector('[data-sidebar=\"sidebar\"]');
    if (!sidebarEl) return;

    const handleTransitionEnd = (event: Event) => {
      const transitionEvent = event as TransitionEvent;
      if (transitionEvent.propertyName === 'transform') {
        setTimeout(() => {
          recomputeOverlayBounds();
          debugLog('PopupOverlay', 'bounds_recalc_after_transition', {
            sidebarOpen,
            timestamp: new Date().toISOString(),
          });
        }, 10);
      }
    };

    sidebarEl.addEventListener('transitionend', handleTransitionEnd);
    return () => {
      sidebarEl.removeEventListener('transitionend', handleTransitionEnd);
    };
  }, [debugLog, recomputeOverlayBounds, sidebarOpen]);

  const visiblePopups = useMemo(() => {
    const margin = 200;
    const viewport = CoordinateBridge.getViewportBounds(margin);

    return Array.from(popups.values()).filter((popup) => {
      if (!popup.canvasPosition) return false;

      const screenPos = CoordinateBridge.canvasToScreen(
        popup.canvasPosition || popup.position,
        activeTransform
      );

      const popupWidth = popup.width ?? DEFAULT_POPUP_WIDTH;
      const popupHeight = popup.height ?? DEFAULT_POPUP_HEIGHT;

      return (
        screenPos.x + popupWidth >= viewport.x &&
        screenPos.x <= viewport.x + viewport.width &&
        screenPos.y + popupHeight >= viewport.y &&
        screenPos.y <= viewport.y + viewport.height
      );
    });
  }, [popups, activeTransform]);

  const cascadeChildCountMap = useMemo(() => {
    const counts = new Map<string, number>();
    popups.forEach((popup) => {
      const parentId = (popup as any).parentPopupId ?? popup.parentId;
      if (!parentId) return;
      counts.set(parentId, (counts.get(parentId) ?? 0) + 1);
    });
    return counts;
  }, [popups]);

  const viewportSize = useMemo(() => {
    if (overlayBounds) {
      return { width: overlayBounds.width, height: overlayBounds.height };
    }
    if (typeof window !== 'undefined') {
      return { width: window.innerWidth, height: window.innerHeight };
    }
    return { width: 1920, height: 1080 };
  }, [overlayBounds]);

  const handleMinimapNavigate = useCallback(
    ({ x, y }: { x: number; y: number }) => {
      const scale = activeTransform.scale || 1;
      const nextTransform = {
        scale,
        x: viewportSize.width / 2 - x * scale,
        y: viewportSize.height / 2 - y * scale,
      };
      if (hasSharedCamera && layerCtx) {
        layerCtx.updateTransform('popups', {
          x: nextTransform.x - activeTransform.x,
          y: nextTransform.y - activeTransform.y,
        });
      } else {
        applyExternalTransform(nextTransform);
      }
    },
    [activeTransform, applyExternalTransform, hasSharedCamera, layerCtx, viewportSize]
  );

  return {
    overlayBounds,
    pointerGuardOffset,
    visiblePopups,
    cascadeChildCountMap,
    viewportSize,
    handleMinimapNavigate,
    recomputeOverlayBounds,
  };
}
