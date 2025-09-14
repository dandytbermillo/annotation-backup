# Auto-Scroll Edge Scrolling Implementation Plan (REVISED)
**Date**: 2025-09-14  
**Version**: 2.0 (Revised after technical review)  
**Feature**: Auto-scroll when dragging popups to viewport edges  
**Target Component**: PopupOverlay (`components/canvas/popup-overlay.tsx`)

## Executive Summary
Implement automatic canvas panning when dragging popup windows near the viewport edges. This revised plan incorporates corrections for viewport detection, conflict prevention, and proper integration flow.

## 1. Configuration Constants
```typescript
// Define all configuration in one place
const AUTO_SCROLL_CONFIG = {
  THRESHOLD: 80,        // Distance from edge to trigger (px)
  MIN_SPEED: 5,        // Minimum scroll speed (px/frame)
  MAX_SPEED: 15,       // Maximum scroll speed (px/frame)
  ACCELERATION: 'ease-out', // Speed curve
  DEBUG: process.env.NODE_ENV === 'development'
} as const;
```

## 2. State Structure

### 2.1 AutoScroll State
```typescript
interface AutoScrollState {
  isActive: boolean;
  velocity: { x: number; y: number };
  threshold: number;
  minSpeed: number;
  maxSpeed: number;
}
```

### 2.2 Component State (Add to PopupOverlay)
```typescript
// Around line 65, after transform state
const [autoScroll, setAutoScroll] = useState<AutoScrollState>({
  isActive: false,
  velocity: { x: 0, y: 0 },
  threshold: AUTO_SCROLL_CONFIG.THRESHOLD,
  minSpeed: AUTO_SCROLL_CONFIG.MIN_SPEED,
  maxSpeed: AUTO_SCROLL_CONFIG.MAX_SPEED
});

const autoScrollRef = useRef<AutoScrollState>(autoScroll);
const animationFrameRef = useRef<number | null>(null);
```

## 3. Core Implementation

### 3.1 Viewport Detection Helper
```typescript
// Helper to get correct viewport bounds for both portal and fixed modes
const getViewportBounds = useCallback((): DOMRect | null => {
  // Portal mode - use container bounds
  if (overlayContainer) {
    return overlayContainer.getBoundingClientRect();
  }
  
  // Fixed mode - use computed bounds
  if (overlayBounds) {
    return new DOMRect(
      overlayBounds.left,
      overlayBounds.top,
      overlayBounds.width,
      overlayBounds.height
    );
  }
  
  // Fallback to overlay element
  return overlayRef.current?.getBoundingClientRect() || null;
}, [overlayContainer, overlayBounds]);
```

### 3.2 Edge Detection Function
```typescript
const checkAutoScroll = useCallback((clientX: number, clientY: number) => {
  // Prevent auto-scroll during canvas pan or when no popup is being dragged
  if (!draggingPopup || isPanning) {
    if (autoScrollRef.current.isActive) {
      autoScrollRef.current = {
        ...autoScrollRef.current,
        isActive: false,
        velocity: { x: 0, y: 0 }
      };
      setAutoScroll(prev => ({ 
        ...prev, 
        isActive: false, 
        velocity: { x: 0, y: 0 } 
      }));
    }
    return;
  }

  const viewport = getViewportBounds();
  if (!viewport) return;

  const { threshold, minSpeed, maxSpeed } = autoScrollRef.current;
  let scrollX = 0;
  let scrollY = 0;

  // Calculate distance from edges
  const distFromLeft = clientX - viewport.left;
  const distFromRight = viewport.right - clientX;
  const distFromTop = clientY - viewport.top;
  const distFromBottom = viewport.bottom - clientY;

  // Progressive speed based on distance from edge (ease-out curve)
  const calculateSpeed = (distance: number): number => {
    if (distance >= threshold || distance < 0) return 0;
    const ratio = 1 - (distance / threshold);
    // Ease-out curve for smoother acceleration
    const eased = 1 - Math.pow(1 - ratio, 3);
    return minSpeed + (maxSpeed - minSpeed) * eased;
  };

  // Horizontal scrolling
  if (distFromLeft < threshold && distFromLeft >= 0) {
    scrollX = calculateSpeed(distFromLeft);
  } else if (distFromRight < threshold && distFromRight >= 0) {
    scrollX = -calculateSpeed(distFromRight);
  }

  // Vertical scrolling
  if (distFromTop < threshold && distFromTop >= 0) {
    scrollY = calculateSpeed(distFromTop);
  } else if (distFromBottom < threshold && distFromBottom >= 0) {
    scrollY = -calculateSpeed(distFromBottom);
  }

  // Update auto-scroll state
  const isActive = scrollX !== 0 || scrollY !== 0;
  const velocity = { x: scrollX, y: scrollY };
  
  if (isActive !== autoScrollRef.current.isActive || 
      velocity.x !== autoScrollRef.current.velocity.x ||
      velocity.y !== autoScrollRef.current.velocity.y) {
    
    autoScrollRef.current = {
      ...autoScrollRef.current,
      isActive,
      velocity
    };
    
    setAutoScroll(prev => ({
      ...prev,
      isActive,
      velocity
    }));
  }

  // Debug visualization
  if (AUTO_SCROLL_CONFIG.DEBUG && isActive) {
    console.log('[AutoScroll]', {
      velocity,
      distances: { left: distFromLeft, right: distFromRight, top: distFromTop, bottom: distFromBottom },
      threshold
    });
  }
}, [draggingPopup, isPanning, getViewportBounds]);
```

### 3.3 Mouse Tracking During Drag
```typescript
// Track mouse position when popup is being dragged
useEffect(() => {
  if (!draggingPopup) return;
  
  const handleMouseMove = (e: MouseEvent) => {
    checkAutoScroll(e.clientX, e.clientY);
  };
  
  // Use capture phase to ensure we get events before they're stopped
  document.addEventListener('mousemove', handleMouseMove, true);
  
  return () => {
    document.removeEventListener('mousemove', handleMouseMove, true);
  };
}, [draggingPopup, checkAutoScroll]);
```

### 3.4 Animation Loop
```typescript
// Auto-scroll animation effect
useEffect(() => {
  // Keep ref in sync
  autoScrollRef.current = autoScroll;
}, [autoScroll]);

useEffect(() => {
  if (!autoScroll.isActive) {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    return;
  }

  const animate = () => {
    // Update transform for canvas panning
    // No division by scale - transform is already in screen coordinates
    setTransform(prev => ({
      ...prev,
      x: prev.x + autoScrollRef.current.velocity.x,
      y: prev.y + autoScrollRef.current.velocity.y
    }));

    // Continue animation if still active
    if (autoScrollRef.current.isActive) {
      animationFrameRef.current = requestAnimationFrame(animate);
    }
  };

  animationFrameRef.current = requestAnimationFrame(animate);

  return () => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
  };
}, [autoScroll.isActive]);
```

### 3.5 Cleanup on Drag End
```typescript
// Add to existing handlePointerEnd or create new effect
useEffect(() => {
  if (draggingPopup) return;
  
  // Stop auto-scroll when drag ends
  if (autoScrollRef.current.isActive) {
    setAutoScroll(prev => ({
      ...prev,
      isActive: false,
      velocity: { x: 0, y: 0 }
    }));
  }
  
  // Clear animation frame
  if (animationFrameRef.current) {
    cancelAnimationFrame(animationFrameRef.current);
    animationFrameRef.current = null;
  }
}, [draggingPopup]);
```

## 4. Visual Feedback (Optional)

### 4.1 Debug Overlay
```typescript
// Add inside the overlay render, after the transform container
{AUTO_SCROLL_CONFIG.DEBUG && autoScroll.isActive && (
  <div className="absolute inset-0 pointer-events-none" style={{ zIndex: 9999 }}>
    {/* Top edge indicator */}
    <div 
      className="absolute top-0 left-0 right-0 bg-blue-500 transition-opacity"
      style={{ 
        height: `${autoScroll.threshold}px`,
        opacity: autoScroll.velocity.y > 0 ? 0.2 : 0.05
      }}
    />
    {/* Bottom edge indicator */}
    <div 
      className="absolute bottom-0 left-0 right-0 bg-blue-500 transition-opacity"
      style={{ 
        height: `${autoScroll.threshold}px`,
        opacity: autoScroll.velocity.y < 0 ? 0.2 : 0.05
      }}
    />
    {/* Left edge indicator */}
    <div 
      className="absolute top-0 left-0 bottom-0 bg-blue-500 transition-opacity"
      style={{ 
        width: `${autoScroll.threshold}px`,
        opacity: autoScroll.velocity.x > 0 ? 0.2 : 0.05
      }}
    />
    {/* Right edge indicator */}
    <div 
      className="absolute top-0 right-0 bottom-0 bg-blue-500 transition-opacity"
      style={{ 
        width: `${autoScroll.threshold}px`,
        opacity: autoScroll.velocity.x < 0 ? 0.2 : 0.05
      }}
    />
    {/* Velocity indicator */}
    <div className="absolute top-4 left-4 text-xs text-white bg-black bg-opacity-50 p-2 rounded">
      Velocity: ({autoScroll.velocity.x.toFixed(1)}, {autoScroll.velocity.y.toFixed(1)})
    </div>
  </div>
)}
```

### 4.2 CSS Classes for Edge Glow
```css
/* Add to popup-overlay.css */
.popup-overlay-autoscroll-left {
  box-shadow: inset 80px 0 40px -40px rgba(59, 130, 246, 0.2);
}

.popup-overlay-autoscroll-right {
  box-shadow: inset -80px 0 40px -40px rgba(59, 130, 246, 0.2);
}

.popup-overlay-autoscroll-top {
  box-shadow: inset 0 80px 40px -40px rgba(59, 130, 246, 0.2);
}

.popup-overlay-autoscroll-bottom {
  box-shadow: inset 0 -80px 40px -40px rgba(59, 130, 246, 0.2);
}
```

## 5. Integration with Parent Component

### 5.1 Data Flow
1. **notes-explorer-phase1.tsx** handles popup drag events
2. Sets `draggingPopup` state when drag starts
3. Passes `draggingPopup` prop to PopupOverlay (already implemented ✅)
4. PopupOverlay tracks mouse and auto-scrolls during drag

### 5.2 No Additional Props Needed
The existing `draggingPopup` prop is sufficient. PopupOverlay will internally track mouse position.

## 6. Edge Cases Handled

### 6.1 Portal vs Fixed Positioning
✅ `getViewportBounds()` handles both rendering modes

### 6.2 Canvas Panning Conflict
✅ Auto-scroll disabled when `isPanning === true`

### 6.3 Sidebar Overlap
✅ Uses existing `overlayBounds` which already accounts for sidebar

### 6.4 Multiple Popup Selection
✅ Only works when single popup is being dragged (draggingPopup is a single ID)

### 6.5 Rapid Enable/Disable
✅ Uses refs to avoid stale closures in RAF loop

## 7. Performance Optimizations

### 7.1 Throttled Mouse Tracking (Optional)
```typescript
import { throttle } from 'lodash';

const throttledCheckAutoScroll = useMemo(
  () => throttle(checkAutoScroll, 16), // 60fps
  [checkAutoScroll]
);
```

### 7.2 Conditional Rendering
Only render debug overlays when needed to avoid unnecessary DOM updates.

## 8. Testing Checklist

### Manual Testing
- [ ] Drag popup to left edge → canvas scrolls right
- [ ] Drag popup to right edge → canvas scrolls left
- [ ] Drag popup to top edge → canvas scrolls down
- [ ] Drag popup to bottom edge → canvas scrolls up
- [ ] Drag popup to corner → diagonal scroll
- [ ] Release mouse → scroll stops immediately
- [ ] Drag popup quickly across edge → smooth transition
- [ ] Pan canvas (empty space) → no auto-scroll
- [ ] Works in portal mode (inside canvas container)
- [ ] Works in fixed mode (overlay positioning)

### Automated Testing
```typescript
describe('PopupOverlay AutoScroll', () => {
  it('activates when dragging popup within threshold', () => {
    // Simulate drag near edge
    // Verify autoScroll.isActive === true
  });
  
  it('calculates progressive speed correctly', () => {
    // Test speed calculation at various distances
  });
  
  it('stops when isPanning is true', () => {
    // Set isPanning = true
    // Verify auto-scroll doesn't activate
  });
  
  it('cleans up animation frame on unmount', () => {
    // Unmount component during active scroll
    // Verify no memory leaks
  });
});
```

## 9. Implementation Timeline

### Phase 1: Core (2 hours)
1. Add AutoScrollState and constants
2. Implement getViewportBounds helper
3. Add checkAutoScroll function
4. Set up animation loop

### Phase 2: Integration (1 hour)
1. Add mouse tracking effect
2. Test with existing drag system
3. Verify no conflicts with panning

### Phase 3: Polish (1 hour)
1. Add debug visualization
2. Fine-tune speed curves
3. Add CSS effects
4. Documentation

## 10. Rollback Strategy
```typescript
// Feature flag in constants
const ENABLE_AUTOSCROLL = process.env.NEXT_PUBLIC_ENABLE_AUTOSCROLL !== 'false';

// Wrap all auto-scroll logic
if (ENABLE_AUTOSCROLL) {
  // Auto-scroll implementation
}
```

## 11. Success Metrics
- 60fps maintained during scroll
- No conflicts with existing features
- Intuitive feel (user testing)
- Zero crashes/stuck states

## 12. Final Notes
This revised implementation addresses all identified issues:
- ✅ Handles both portal and fixed positioning modes
- ✅ Prevents conflicts with canvas panning
- ✅ Correct transform updates (no scale division)
- ✅ Proper mouse tracking during drag
- ✅ Comprehensive edge case handling

The implementation is ready for development.