/**
 * CoordinateBridge - Single source of truth for coordinate transformations
 * 
 * Handles all conversions between screen space (browser pixels) and 
 * canvas space (world coordinates) to prevent double scaling and drift.
 */

// Types
export interface Point {
  x: number;
  y: number;
}

export interface Transform {
  x: number;
  y: number;
  scale: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Coordinate transformation utilities
 * All methods are static to ensure consistent usage across the codebase
 */
export class CoordinateBridge {
  private static migrationMode: 'screen' | 'canvas' | 'hybrid' = 'hybrid';
  
  /**
   * Convert screen coordinates to canvas coordinates
   * Removes translation and scales down by the transform scale
   */
  static screenToCanvas(point: Point, transform: Transform): Point {
    return {
      x: (point.x - transform.x) / transform.scale,
      y: (point.y - transform.y) / transform.scale,
    };
  }
  
  /**
   * Convert canvas coordinates to screen coordinates
   * Applies scale first, then translates
   */
  static canvasToScreen(point: Point, transform: Transform): Point {
    return {
      x: point.x * transform.scale + transform.x,
      y: point.y * transform.scale + transform.y,
    };
  }
  
  /**
   * Convert canvas to screen position only (no scale)
   * Used to avoid double scaling - position only, scale applied via CSS transform
   */
  static canvasToScreenPosition(point: Point, transform: Transform): Point {
    // Position only - scale will be applied via CSS transform
    return {
      x: point.x + transform.x,
      y: point.y + transform.y,
    };
  }
  
  /**
   * Convert a screen rect to canvas rect
   */
  static screenRectToCanvas(rect: Rect, transform: Transform): Rect {
    const topLeft = this.screenToCanvas({ x: rect.x, y: rect.y }, transform);
    return {
      x: topLeft.x,
      y: topLeft.y,
      width: rect.width / transform.scale,
      height: rect.height / transform.scale,
    };
  }
  
  /**
   * Convert a canvas rect to screen rect
   */
  static canvasRectToScreen(rect: Rect, transform: Transform): Rect {
    const topLeft = this.canvasToScreen({ x: rect.x, y: rect.y }, transform);
    return {
      x: topLeft.x,
      y: topLeft.y,
      width: rect.width * transform.scale,
      height: rect.height * transform.scale,
    };
  }
  
  /**
   * Generate container transform style for overlay root
   * Single transform applied at container level
   */
  static containerTransformStyle(transform: Transform): React.CSSProperties {
    return {
      transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
      transformOrigin: '0 0',
    };
  }
  
  /**
   * Migrate position from screen to canvas coordinates
   * Returns both for hybrid mode support
   */
  static migratePosition(
    screenPos: Point,
    layerTransform: Transform
  ): { canvas: Point; screen: Point } {
    const canvas = this.screenToCanvas(screenPos, layerTransform);
    return { canvas, screen: screenPos };
  }
  
  /**
   * Preserve relative positions during transform changes
   * Used when migrating from screen to canvas coordinates
   */
  static preserveRelativePositions<T extends { position: Point }>(
    items: Map<string, T>,
    oldTransform: Transform,
    newTransform: Transform
  ): Map<string, T & { canvasPosition: Point }> {
    const updated = new Map<string, T & { canvasPosition: Point }>();
    
    items.forEach((item, id) => {
      const canvasPos = this.screenToCanvas(item.position, oldTransform);
      const newScreenPos = this.canvasToScreenPosition(canvasPos, newTransform);
      
      updated.set(id, {
        ...item,
        canvasPosition: canvasPos,
        position: newScreenPos, // Position only, no scale
      });
    });
    
    return updated;
  }
  
  /**
   * Check if a point is within the viewport
   */
  static isInViewport(
    screenPos: Point,
    itemSize: { width: number; height: number },
    viewport?: Rect
  ): boolean {
    const vp = viewport || {
      x: 0,
      y: 0,
      width: window.innerWidth,
      height: window.innerHeight,
    };
    
    return !(
      screenPos.x + itemSize.width < vp.x ||
      screenPos.x > vp.x + vp.width ||
      screenPos.y + itemSize.height < vp.y ||
      screenPos.y > vp.y + vp.height
    );
  }
  
  /**
   * Calculate viewport bounds with optional margin
   */
  static getViewportBounds(margin: number = 0): Rect {
    if (typeof window === 'undefined') {
      return { x: -margin, y: -margin, width: 1920 + margin * 2, height: 1080 + margin * 2 };
    }
    
    return {
      x: -margin,
      y: -margin,
      width: window.innerWidth + margin * 2,
      height: window.innerHeight + margin * 2,
    };
  }
  
  /**
   * Set migration mode for gradual transition
   */
  static setMigrationMode(mode: 'screen' | 'canvas' | 'hybrid'): void {
    this.migrationMode = mode;
  }
  
  /**
   * Get current migration mode
   */
  static getMigrationMode(): string {
    return this.migrationMode;
  }
}