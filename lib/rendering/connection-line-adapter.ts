/**
 * ConnectionLineAdapter - Handles rendering of connection lines between popups
 * 
 * Adapts existing bezier curve calculations for multi-layer canvas
 * Uses canvas coordinates to prevent scaling issues
 */

import { Point } from '@/lib/utils/coordinate-bridge';

// Interface for popup state with canvas position
export interface PopupState {
  id: string;
  parentId?: string;
  canvasPosition?: Point;
  position?: Point; // Legacy screen position
  isDragging?: boolean;
  folder?: any;
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
  
  /**
   * Get popup position (canvas or screen)
   * Returns the CENTER point of the popup for reference
   */
  private static getPopupPosition(popup: PopupState): Point | null {
    if (!popup.canvasPosition) {
      return null;
    }

    // Popup dimensions (from popup-overlay.tsx)
    const POPUP_WIDTH = 300;
    const POPUP_HEIGHT = 200; // Approximate center point (max is 400, but most are smaller)

    return {
      x: popup.canvasPosition.x,
      y: popup.canvasPosition.y,
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
    const parentPos = this.getPopupPosition(parent);
    const childPos = this.getPopupPosition(child);

    if (!parentPos || !childPos) return null;

    const POPUP_WIDTH = 300;
    const POPUP_HEIGHT = 200;

    // Calculate relative position
    const dx = childPos.x - parentPos.x;
    const dy = childPos.y - parentPos.y;

    let start: Point;
    let end: Point;

    // Determine which edges to use based on relative position
    // Prioritize horizontal connections (left/right) over vertical (top/bottom)
    if (Math.abs(dx) > Math.abs(dy)) {
      // Horizontal connection (child is mostly to the left or right)
      if (dx > 0) {
        // Child is to the RIGHT of parent
        start = {
          x: parentPos.x + POPUP_WIDTH,    // Exit from right edge
          y: parentPos.y + POPUP_HEIGHT / 2
        };
        end = {
          x: childPos.x,                    // Enter from left edge
          y: childPos.y + POPUP_HEIGHT / 2
        };
      } else {
        // Child is to the LEFT of parent
        start = {
          x: parentPos.x,                   // Exit from left edge
          y: parentPos.y + POPUP_HEIGHT / 2
        };
        end = {
          x: childPos.x + POPUP_WIDTH,      // Enter from right edge
          y: childPos.y + POPUP_HEIGHT / 2
        };
      }
    } else {
      // Vertical connection (child is mostly above or below)
      if (dy > 0) {
        // Child is BELOW parent
        start = {
          x: parentPos.x + POPUP_WIDTH / 2,
          y: parentPos.y + POPUP_HEIGHT      // Exit from bottom edge
        };
        end = {
          x: childPos.x + POPUP_WIDTH / 2,
          y: childPos.y                       // Enter from top edge
        };
      } else {
        // Child is ABOVE parent
        start = {
          x: parentPos.x + POPUP_WIDTH / 2,
          y: parentPos.y                      // Exit from top edge
        };
        end = {
          x: childPos.x + POPUP_WIDTH / 2,
          y: childPos.y + POPUP_HEIGHT        // Enter from bottom edge
        };
      }
    }

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
    
    const popupWidth = 300;
    const popupHeight = 400; // Approximate height
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
