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
      
      // Use canvas positions if available, fallback to screen positions
      const startPos = this.getPopupPosition(parent);
      const endPos = this.getPopupPosition(popup);
      
      if (!startPos || !endPos) return;
      
      // Calculate bezier path
      const pathString = this.calculateBezierPath(
        startPos,
        endPos,
        Boolean(popup.isDragging || parent.isDragging)
      );
      
      // Determine styling based on motion state
      // While global motion (isDragging) is true, prefer lighter, cheaper strokes.
      // If a specific popup is being dragged, slightly emphasize that link.
      const popupActive = Boolean(popup.isDragging || parent.isDragging);
      if (isDragging) {
        paths.push({
          d: pathString,
          stroke: 'rgba(59, 130, 246, 0.65)',
          strokeWidth: 1.25,
          opacity: 0.85,
        });
      } else if (popupActive) {
        paths.push({
          d: pathString,
          stroke: 'rgba(59, 130, 246, 1)',
          strokeWidth: 3,
          opacity: 1,
        });
      } else {
        paths.push({
          d: pathString,
          stroke: 'rgba(59, 130, 246, 0.75)',
          strokeWidth: 2,
          opacity: 0.9,
        });
      }
    });
    
    return paths;
  }
  
  /**
   * Get popup position (canvas or screen)
   */
  private static getPopupPosition(popup: PopupState): Point | null {
    // Prefer canvas position for multi-layer mode
    if (!popup.canvasPosition) {
      return null;
    }

    return {
      x: popup.canvasPosition.x + 150,
      y: popup.canvasPosition.y + 40,
    };
  }
  
  /**
   * Calculate bezier curve path between two points
   */
  private static calculateBezierPath(
    start: Point,
    end: Point,
    isDragging: boolean
  ): string {
    // Adjust end point to top of child popup
    const adjustedEnd = {
      x: end.x,
      y: end.y - 40, // Connect to top of child
    };
    
    // Calculate control points for smooth curve
    const dx = adjustedEnd.x - start.x;
    const dy = adjustedEnd.y - start.y;
    
    // Determine curve style based on relative positions
    if (Math.abs(dx) < 50 && dy > 0) {
      // Vertical connection - straight line
      return `M ${start.x} ${start.y} L ${adjustedEnd.x} ${adjustedEnd.y}`;
    }
    
    // Bezier curve for diagonal connections
    const controlPointOffset = Math.min(Math.abs(dx) * 0.5, 100);
    const midY = (start.y + adjustedEnd.y) / 2;
    
    // Create smooth S-curve
    const cp1 = {
      x: start.x + (dx > 0 ? controlPointOffset : -controlPointOffset),
      y: start.y,
    };
    
    const cp2 = {
      x: adjustedEnd.x - (dx > 0 ? controlPointOffset : -controlPointOffset),
      y: adjustedEnd.y,
    };
    
    return `M ${start.x} ${start.y} C ${cp1.x} ${cp1.y}, ${cp2.x} ${cp2.y}, ${adjustedEnd.x} ${adjustedEnd.y}`;
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
