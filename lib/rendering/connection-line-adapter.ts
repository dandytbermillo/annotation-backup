/**
 * ConnectionLineAdapter - Handles rendering of connection lines between popups
 * 
 * Adapts existing bezier curve calculations for multi-layer canvas
 * Uses canvas coordinates to prevent scaling issues
 */

import { Point } from '@/lib/utils/coordinate-bridge';

const DEFAULT_POPUP_WIDTH = 300;
const DEFAULT_POPUP_HEIGHT = 400;

// Interface for popup state with canvas position
export interface PopupState {
  id: string;
  parentId?: string;
  canvasPosition?: Point;
  position?: Point; // Legacy screen position
  isDragging?: boolean;
  folder?: any;
  width?: number;
  height?: number;
}

// Path data for SVG rendering
export interface PathData {
  d: string;
  stroke: string;
  strokeWidth: number;
  opacity: number;
}

/**
 * Adapter for connection line rendering
 */
export class ConnectionLineAdapter {
  private static currentMode: 'legacy' | 'layered' = 'layered';
  
  /**
   * Generate path data for connection lines between popups
   * Uses canvas coordinates under container transform
   */
  static adaptConnectionLines(
    popups: Map<string, PopupState>,
    isDragging: boolean, // motion active (pan or drag) -> use lighter stroke
    visibleIds?: Set<string>
  ): PathData[] {
    const paths: PathData[] = [];
    
    popups.forEach((popup) => {
      // LOD: if a visibility set is provided, only draw lines for visible nodes
      if (visibleIds && !visibleIds.has(popup.id)) return;
      if (!popup.parentId) return;

      const parent = popups.get(popup.parentId);
      if (!parent) return;
      if (visibleIds && !visibleIds.has(parent.id)) return;

      // Smart connection: choose best edges based on relative positions
      const connectionPoints = this.getSmartConnectionPoints(parent, popup);
      if (!connectionPoints) return;

      // Calculate bezier path
      const pathString = this.calculateBezierPath(
        connectionPoints.start,
        connectionPoints.end
      );
      
      // Widget Studio styling - subtle, clean
      // Light gray base color with slight emphasis on active connections
      const popupActive = Boolean(popup.isDragging || parent.isDragging);
      if (isDragging) {
        // During drag: lightest weight for performance
        paths.push({
          d: pathString,
          stroke: 'rgba(148, 163, 184, 0.5)', // Slate-400 at 50%
          strokeWidth: 1.5,
          opacity: 0.7,
        });
      } else if (popupActive) {
        // Active connection: slightly emphasized
        paths.push({
          d: pathString,
          stroke: 'rgba(148, 163, 184, 0.9)', // Slate-400 at 90%
          strokeWidth: 2.5,
          opacity: 1,
        });
      } else {
        // Default: subtle Widget Studio style
        paths.push({
          d: pathString,
          stroke: 'rgba(148, 163, 184, 0.6)', // Slate-400 at 60%
          strokeWidth: 2,
          opacity: 0.8,
        });
      }
    });
    
    return paths;
  }
  
  private static getPopupRect(popup: PopupState): { x: number; y: number; width: number; height: number } | null {
    if (!popup.canvasPosition) return null;
    const width = Number.isFinite(popup.width) ? (popup.width as number) : DEFAULT_POPUP_WIDTH;
    const height = Number.isFinite(popup.height) ? (popup.height as number) : DEFAULT_POPUP_HEIGHT;
    return {
      x: popup.canvasPosition.x,
      y: popup.canvasPosition.y,
      width,
      height,
    };
  }

  private static getRectCenter(rect: { x: number; y: number; width: number; height: number }): Point {
    return {
      x: rect.x + rect.width / 2,
      y: rect.y + rect.height / 2,
    };
  }

  private static getEdgeIntersection(
    rect: { x: number; y: number; width: number; height: number },
    target: Point
  ): Point {
    const center = this.getRectCenter(rect);
    const dx = target.x - center.x;
    const dy = target.y - center.y;

    if (dx === 0 && dy === 0) {
      return center;
    }

    const absDx = Math.abs(dx);
    const absDy = Math.abs(dy);
    const halfWidth = rect.width / 2;
    const halfHeight = rect.height / 2;

    if (absDx * halfHeight > absDy * halfWidth) {
      // Intersects left/right edge first
      const scale = absDx === 0 ? 0 : halfWidth / absDx;
      return {
        x: center.x + Math.sign(dx) * halfWidth,
        y: center.y + dy * scale,
      };
    }

    // Intersects top/bottom edge first
    const scale = absDy === 0 ? 0 : halfHeight / absDy;
    return {
      x: center.x + dx * scale,
      y: center.y + Math.sign(dy) * halfHeight,
    };
  }

  /**
   * Get smart connection points based on relative positions
   * Returns { start, end } where start is the exit point from parent
   * and end is the entry point to child
   */
  private static getSmartConnectionPoints(
    parent: PopupState,
    child: PopupState
  ): { start: Point; end: Point } | null {
    const parentRect = this.getPopupRect(parent);
    const childRect = this.getPopupRect(child);

    if (!parentRect || !childRect) return null;

    const parentCenter = this.getRectCenter(parentRect);
    const childCenter = this.getRectCenter(childRect);

    const start = this.getEdgeIntersection(parentRect, childCenter);
    const end = this.getEdgeIntersection(childRect, parentCenter);

    return { start, end };
  }
  
  /**
   * Calculate bezier curve path between two points
   * Widget Studio style: smooth S-curves with smart direction handling
   */
  private static calculateBezierPath(
    start: Point,
    end: Point
  ): string {
    const dx = end.x - start.x;
    const dy = end.y - start.y;

    // Determine if this is a horizontal or vertical connection
    const isHorizontal = Math.abs(dx) > Math.abs(dy);

    let cp1: Point;
    let cp2: Point;

    if (isHorizontal) {
      // Horizontal S-curve (left-right or right-left)
      // Control points extend horizontally with 40% offset
      const controlPointOffset = Math.abs(dx) * 0.4;

      cp1 = {
        x: start.x + (dx > 0 ? controlPointOffset : -controlPointOffset),
        y: start.y,
      };

      cp2 = {
        x: end.x - (dx > 0 ? controlPointOffset : -controlPointOffset),
        y: end.y,
      };
    } else {
      // Vertical S-curve (top-bottom or bottom-top)
      // Control points extend vertically with 40% offset
      const controlPointOffset = Math.abs(dy) * 0.4;

      cp1 = {
        x: start.x,
        y: start.y + (dy > 0 ? controlPointOffset : -controlPointOffset),
      };

      cp2 = {
        x: end.x,
        y: end.y - (dy > 0 ? controlPointOffset : -controlPointOffset),
      };
    }

    return `M ${start.x},${start.y} C ${cp1.x},${cp1.y} ${cp2.x},${cp2.y} ${end.x},${end.y}`;
  }
  
  /**
   * Set rendering mode
   */
  static setMode(mode: 'legacy' | 'layered'): void {
    this.currentMode = mode;
  }
  
  /**
   * Get current rendering mode
   */
  static getMode(): string {
    return this.currentMode;
  }
  
  /**
   * Calculate connection point for a popup
   * Returns the point where lines should connect
   */
  static getConnectionPoint(
    popup: PopupState,
    edge: 'top' | 'bottom' | 'left' | 'right' = 'bottom'
  ): Point | null {
    const pos = popup.canvasPosition || popup.position;
    if (!pos) return null;
    
    const popupWidth = Number.isFinite(popup.width) ? (popup.width as number) : DEFAULT_POPUP_WIDTH;
    const popupHeight = Number.isFinite(popup.height) ? (popup.height as number) : DEFAULT_POPUP_HEIGHT;
    const headerHeight = 40;
    
    switch (edge) {
      case 'top':
        return { x: pos.x + popupWidth / 2, y: pos.y };
      case 'bottom':
        return { x: pos.x + popupWidth / 2, y: pos.y + headerHeight };
      case 'left':
        return { x: pos.x, y: pos.y + headerHeight / 2 };
      case 'right':
        return { x: pos.x + popupWidth, y: pos.y + headerHeight / 2 };
      default:
        return { x: pos.x + popupWidth / 2, y: pos.y + headerHeight };
    }
  }
  
  /**
   * Generate arrow marker for connection lines (optional enhancement)
   */
  static getArrowMarker(): string {
    return `
      <defs>
        <marker
          id="connection-arrow"
          markerWidth="10"
          markerHeight="10"
          refX="8"
          refY="3"
          orient="auto"
          markerUnits="strokeWidth"
        >
          <path
            d="M0,0 L0,6 L9,3 z"
            fill="rgba(59, 130, 246, 0.6)"
          />
        </marker>
      </defs>
    `;
  }
}
