'use client';

import React, { useMemo, useCallback, useRef } from 'react';
import type { PopupData } from './popupOverlay/types';
import type { Transform } from '@/lib/utils/coordinate-bridge';

interface OverlayMinimapProps {
  popups: Map<string, PopupData>;
  transform: Transform;
  viewport: { width: number; height: number };
  onNavigate: (target: { x: number; y: number }) => void;
}

type MinimapNode = {
  id: string;
  x: number;
  y: number;
  level: number;
  color?: string | null;
};

const MINIMAP_WIDTH = 240;
const MINIMAP_HEIGHT = 160;
const MINIMAP_PADDING = 14;

export const OverlayMinimap: React.FC<OverlayMinimapProps> = ({
  popups,
  transform,
  viewport,
  onNavigate,
}) => {
  const pointerActiveRef = useRef(false);

  const nodes = useMemo<MinimapNode[]>(() => {
    const list: MinimapNode[] = [];
    popups.forEach((popup) => {
      const position = popup.canvasPosition || popup.position;
      if (!position) return;
      list.push({
        id: popup.id,
        x: position.x,
        y: position.y,
        level: popup.level || 0,
        color: popup.folder?.color ?? null,
      });
    });
    return list;
  }, [popups]);

  const worldViewport = useMemo(() => {
    const scale = transform.scale || 1;
    return {
      x: -transform.x / scale,
      y: -transform.y / scale,
      width: viewport.width / scale,
      height: viewport.height / scale,
    };
  }, [transform, viewport]);

  const bounds = useMemo(() => {
    let minX = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;

    nodes.forEach((node) => {
      minX = Math.min(minX, node.x);
      maxX = Math.max(maxX, node.x);
      minY = Math.min(minY, node.y);
      maxY = Math.max(maxY, node.y);
    });

    minX = Math.min(minX, worldViewport.x);
    maxX = Math.max(maxX, worldViewport.x + worldViewport.width);
    minY = Math.min(minY, worldViewport.y);
    maxY = Math.max(maxY, worldViewport.y + worldViewport.height);

    if (!Number.isFinite(minX) || !Number.isFinite(maxX) || nodes.length === 0) {
      const padding = 200;
      return {
        minX: worldViewport.x - padding,
        maxX: worldViewport.x + worldViewport.width + padding,
        minY: worldViewport.y - padding,
        maxY: worldViewport.y + worldViewport.height + padding,
      };
    }

    const padding = 100;
    return {
      minX: minX - padding,
      maxX: maxX + padding,
      minY: minY - padding,
      maxY: maxY + padding,
    };
  }, [nodes, worldViewport]);

  const scale = useMemo(() => {
    const contentWidth = Math.max(1, bounds.maxX - bounds.minX);
    const contentHeight = Math.max(1, bounds.maxY - bounds.minY);
    const availableWidth = MINIMAP_WIDTH - MINIMAP_PADDING * 2;
    const availableHeight = MINIMAP_HEIGHT - MINIMAP_PADDING * 2;
    return Math.min(availableWidth / contentWidth, availableHeight / contentHeight);
  }, [bounds]);

  const worldToMinimap = useCallback(
    (worldX: number, worldY: number) => ({
      x: (worldX - bounds.minX) * scale + MINIMAP_PADDING,
      y: (worldY - bounds.minY) * scale + MINIMAP_PADDING,
    }),
    [bounds, scale]
  );

  const minimapViewport = useMemo(() => {
    const topLeft = worldToMinimap(worldViewport.x, worldViewport.y);
    return {
      x: topLeft.x,
      y: topLeft.y,
      width: worldViewport.width * scale,
      height: worldViewport.height * scale,
    };
  }, [worldViewport, worldToMinimap, scale]);

  const handleNavigateFromEvent = useCallback(
    (event: React.PointerEvent<SVGSVGElement>) => {
      const rect = event.currentTarget.getBoundingClientRect();
      const localX = event.clientX - rect.left;
      const localY = event.clientY - rect.top;
      const worldX = (localX - MINIMAP_PADDING) / scale + bounds.minX;
      const worldY = (localY - MINIMAP_PADDING) / scale + bounds.minY;
      onNavigate({ x: worldX, y: worldY });
    },
    [bounds, onNavigate, scale]
  );

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<SVGSVGElement>) => {
      event.stopPropagation();
      event.preventDefault();
      pointerActiveRef.current = true;
      handleNavigateFromEvent(event);
    },
    [handleNavigateFromEvent]
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<SVGSVGElement>) => {
      if (!pointerActiveRef.current) return;
      event.stopPropagation();
      event.preventDefault();
      handleNavigateFromEvent(event);
    },
    [handleNavigateFromEvent]
  );

  const handlePointerUp = useCallback((event: React.PointerEvent<SVGSVGElement>) => {
    event.stopPropagation();
    event.preventDefault();
    pointerActiveRef.current = false;
  }, []);

  const handlePointerLeave = useCallback((event: React.PointerEvent<SVGSVGElement>) => {
    event.stopPropagation();
    pointerActiveRef.current = false;
  }, []);

  const circleRadius = 4;

  const hasNodes = nodes.length > 0;

  return (
    <div className="overlay-minimap" aria-label="Overlay minimap">
      <div className="overlay-minimap__label">Workspace Map</div>
      <svg
        role="presentation"
        width={MINIMAP_WIDTH}
        height={MINIMAP_HEIGHT}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerLeave}
      >
        <rect
          x={0}
          y={0}
          width={MINIMAP_WIDTH}
          height={MINIMAP_HEIGHT}
          className="overlay-minimap__background"
        />
        {hasNodes ? (
          nodes.map((node) => {
            const position = worldToMinimap(node.x, node.y);
            const hue = ((node.level || 0) * 37) % 360;
            const fill = node.color || `hsl(${hue}, 70%, 65%)`;
            return (
              <circle
                key={node.id}
                cx={position.x}
                cy={position.y}
                r={circleRadius}
                fill={fill}
                opacity={0.85}
                className="overlay-minimap__node"
              />
            );
          })
        ) : (
          <text
            x="50%"
            y="50%"
            textAnchor="middle"
            dominantBaseline="middle"
            fontSize="12"
            fill="rgba(148, 163, 184, 0.8)"
          >
            No popups yet
          </text>
        )}
        <rect
          x={minimapViewport.x}
          y={minimapViewport.y}
          width={Math.max(10, minimapViewport.width)}
          height={Math.max(10, minimapViewport.height)}
          className="overlay-minimap__viewport"
        />
      </svg>
    </div>
  );
};
