import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import type React from 'react';
import { CoordinateBridge, Transform } from '@/lib/utils/coordinate-bridge';
import {
  DEFAULT_POPUP_HEIGHT,
  DEFAULT_POPUP_WIDTH,
  MAX_POPUP_HEIGHT,
  MAX_POPUP_WIDTH,
  MIN_POPUP_HEIGHT,
  MIN_POPUP_WIDTH,
} from '@/components/canvas/popup-overlay/constants';
import { clamp } from '@/components/canvas/popup-overlay/helpers';
import type { PopupData } from '@/components/canvas/popup-overlay/types';

interface Options {
  popups: Map<string, PopupData>;
  overlayRef: React.RefObject<HTMLDivElement | null>;
  activeTransform: Transform;
  onPopupPositionChange?: PopupOverlayPositionChangeHandler;
  onResizePopup?: PopupOverlayResizeHandler;
  shouldBlockMeasurements: boolean;
  isLocked: boolean;
}

type PopupOverlayPositionChangeHandler = (
  popupId: string,
  payload: {
    screenPosition: { x: number; y: number };
    canvasPosition: { x: number; y: number };
    size?: { width: number; height: number };
  }
) => void;

type PopupOverlayResizeHandler = (
  popupId: string,
  size: { width: number; height: number },
  options?: { source: 'auto' | 'user' }
) => void;

export function usePopupMeasurements({
  popups,
  overlayRef,
  activeTransform,
  onPopupPositionChange,
  onResizePopup,
  shouldBlockMeasurements,
  isLocked,
}: Options) {
  const [isResizing, setIsResizing] = useState(false);
  const measurementQueueRef = useRef<
    Map<
      string,
      {
        screen: { x: number; y: number };
        canvas: { x: number; y: number };
        size?: { width: number; height: number };
      }
    >
  >(new Map());
  const measurementRafIdRef = useRef<number | null>(null);
  const measurementRestartRef = useRef<number | null>(null);
  const resizingStateRef = useRef<{
    popupId: string;
    pointerId: number;
    startX: number;
    startY: number;
    startWidth: number;
    startHeight: number;
    lastWidth: number;
    lastHeight: number;
  } | null>(null);

  const handleResizePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>, popup: PopupData) => {
      if (!onResizePopup || isLocked) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      const startWidth = popup.width ?? DEFAULT_POPUP_WIDTH;
      const startHeight = popup.height ?? DEFAULT_POPUP_HEIGHT;

      resizingStateRef.current = {
        popupId: popup.id,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        startWidth,
        startHeight,
        lastWidth: startWidth,
        lastHeight: startHeight,
      };

      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // noop – pointer capture unavailable
      }

      setIsResizing(true);
    },
    [isLocked, onResizePopup]
  );

  const handleResizePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (isLocked) {
        return;
      }

      const state = resizingStateRef.current;
      if (!state || state.pointerId !== event.pointerId || !onResizePopup) {
        return;
      }

      event.preventDefault();

      const deltaX = event.clientX - state.startX;
      const deltaY = event.clientY - state.startY;
      const nextWidth = clamp(state.startWidth + deltaX, MIN_POPUP_WIDTH, MAX_POPUP_WIDTH);
      const nextHeight = clamp(state.startHeight + deltaY, MIN_POPUP_HEIGHT, MAX_POPUP_HEIGHT);

      if (nextWidth === state.lastWidth && nextHeight === state.lastHeight) {
        return;
      }

      state.lastWidth = nextWidth;
      state.lastHeight = nextHeight;
      onResizePopup(state.popupId, { width: nextWidth, height: nextHeight }, { source: 'user' });
    },
    [isLocked, onResizePopup]
  );

  const handleResizePointerEnd = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const state = resizingStateRef.current;
    if (state && state.pointerId === event.pointerId) {
      const target = event.currentTarget as HTMLElement;
      if (typeof target.releasePointerCapture === 'function') {
        try {
          target.releasePointerCapture(event.pointerId);
        } catch {
          // noop
        }
      }
    }

    resizingStateRef.current = null;
    if (isResizing) {
      setIsResizing(false);
    }
  }, [isResizing]);

  useLayoutEffect(() => {
    const isMeasurementBlocked = shouldBlockMeasurements || isResizing;
    if (!onPopupPositionChange || isLocked) return;
    if (isMeasurementBlocked) {
      if (measurementRafIdRef.current !== null) {
        cancelAnimationFrame(measurementRafIdRef.current);
        measurementRafIdRef.current = null;
      }
      measurementQueueRef.current.clear();
      if (measurementRestartRef.current !== null) {
        clearTimeout(measurementRestartRef.current);
      }
      measurementRestartRef.current = window.setTimeout(() => {
        measurementRestartRef.current = null;
      }, 50);
      return;
    }
    const root = overlayRef.current;
    if (!root) return;
    const autoResizePayload: Array<{ id: string; width: number; height: number }> = [];

    popups.forEach((popupState, popupId) => {
      const element = root.querySelector<HTMLElement>(`[data-popup-id="${popupId}"]`);
      if (!element) return;

      const rect = element.getBoundingClientRect();
      const viewportScreenPosition = { x: rect.left, y: rect.top };
      const canvasPosition =
        popupState.canvasPosition ??
        CoordinateBridge.screenToCanvas(viewportScreenPosition, activeTransform);

      const prevScreen = popupState.position;
      const prevWidth = popupState.width ?? DEFAULT_POPUP_WIDTH;
      const prevHeight = popupState.height ?? DEFAULT_POPUP_HEIGHT;

      const screenChanged =
        !prevScreen ||
        Math.abs(prevScreen.x - viewportScreenPosition.x) > 0.5 ||
        Math.abs(prevScreen.y - viewportScreenPosition.y) > 0.5;

      const widthChanged = Math.abs(prevWidth - rect.width) > 0.5;
      const heightChanged = Math.abs(prevHeight - rect.height) > 0.5;

      if (screenChanged || widthChanged || heightChanged) {
        measurementQueueRef.current.set(popupId, {
          screen: viewportScreenPosition,
          canvas: popupState.canvasPosition || canvasPosition,
          size: widthChanged || heightChanged ? { width: rect.width, height: rect.height } : undefined,
        });
      }

      const shouldAutoResize =
        !!onResizePopup && !popupState.isLoading && popupState.sizeMode !== 'user';

      if (shouldAutoResize) {
        let intrinsicHeight = rect.height;
        const contentElement = element.querySelector<HTMLElement>('[data-popup-content]');
        if (contentElement) {
          const contentRect = contentElement.getBoundingClientRect();
          const chromeHeight = Math.max(0, rect.height - contentRect.height);
          const contentScrollHeight = contentElement.scrollHeight;
          intrinsicHeight = chromeHeight + contentScrollHeight;
        } else {
          intrinsicHeight = element.scrollHeight || rect.height;
        }
        const desiredHeight = clamp(intrinsicHeight, MIN_POPUP_HEIGHT, MAX_POPUP_HEIGHT);
        const previousHeight = popupState.height ?? DEFAULT_POPUP_HEIGHT;
        const heightDelta = Math.abs(previousHeight - desiredHeight);
        if (popupState.sizeMode !== 'auto' || heightDelta > 1) {
          const currentWidth = popupState.width ?? rect.width ?? DEFAULT_POPUP_WIDTH;
          autoResizePayload.push({
            id: popupId,
            width: clamp(currentWidth, MIN_POPUP_WIDTH, MAX_POPUP_WIDTH),
            height: desiredHeight,
          });
        }
      }
    });

    if (measurementRafIdRef.current !== null) {
      cancelAnimationFrame(measurementRafIdRef.current);
      measurementRafIdRef.current = null;
    }

    if (measurementQueueRef.current.size > 0) {
      measurementRafIdRef.current = requestAnimationFrame(() => {
        measurementQueueRef.current.forEach((payload, popupId) => {
          const updatePayload: {
            screenPosition: { x: number; y: number };
            canvasPosition: { x: number; y: number };
            size?: { width: number; height: number };
          } = {
            screenPosition: payload.screen,
            canvasPosition: payload.canvas,
          };
          if (payload.size) {
            updatePayload.size = payload.size;
          }
          onPopupPositionChange(popupId, updatePayload);
        });
        measurementQueueRef.current.clear();
        measurementRafIdRef.current = null;
      });
    }

    if (autoResizePayload.length > 0 && onResizePopup) {
      autoResizePayload.forEach(({ id, width, height }) => {
        onResizePopup(id, { width, height }, { source: 'auto' });
      });
    }

    return () => {
      if (measurementRafIdRef.current !== null) {
        cancelAnimationFrame(measurementRafIdRef.current);
        measurementRafIdRef.current = null;
      }
      measurementQueueRef.current.clear();
    };
  }, [
    popups,
    activeTransform,
    onPopupPositionChange,
    shouldBlockMeasurements,
    isResizing,
    onResizePopup,
    overlayRef,
    isLocked,
  ]);

  return {
    isResizing,
    handleResizePointerDown,
    handleResizePointerMove,
    handleResizePointerEnd,
  };
}
