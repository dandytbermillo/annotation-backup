# Auto-Scroll Edge Scrolling Implementation Plan
**Date**: 2025-09-14  
**Feature**: Auto-scroll when dragging popups to viewport edges  
**Target Component**: PopupOverlay (`components/canvas/popup-overlay.tsx`)

## Executive Summary
Implement automatic canvas panning when dragging popup windows near the viewport edges, allowing users to drag popups beyond the current visible area seamlessly. This feature is based on the proven implementation from `infinite-canvas-main`.

## 1. Feature Requirements

### Functional Requirements
- **FR1**: Canvas auto-scrolls when dragging a popup within 80px of viewport edge
- **FR2**: Scroll speed proportional to distance from edge (closer = faster)
- **FR3**: Diagonal scrolling support (corners trigger both X and Y scroll)
- **FR4**: Smooth animation using requestAnimationFrame
- **FR5**: Immediate stop when mouse leaves hot zone or drag ends
- **FR6**: Works during both popup dragging and canvas panning

### Non-Functional Requirements
- **NFR1**: No performance degradation (60fps maintained)
- **NFR2**: No interference with existing pan/zoom functionality
- **NFR3**: Configurable threshold and speed values
- **NFR4**: Works across all browsers and Electron

## 2. Technical Architecture

### 2.1 State Structure
```typescript
// Add to PopupOverlay component
interface AutoScrollState {
  isActive: boolean;
  velocity: { x: number; y: number };
  threshold: number;  // Default: 80px
  speed: number;      // Default: 5px/frame
  maxSpeed: number;   // Default: 15px/frame
}
```

### 2.2 Component Integration Points

#### Location: `components/canvas/popup-overlay.tsx`

**New State Variables** (around line 65):
```typescript
const [autoScroll, setAutoScroll] = useState<AutoScrollState>({
  isActive: false,
  velocity: { x: 0, y: 0 },
  threshold: 80,
  speed: 5,
  maxSpeed: 15
});

const autoScrollRef = useRef<AutoScrollState>(autoScroll);
const animationFrameRef = useRef<number | null>(null);
```

## 3. Implementation Details

### 3.1 Edge Detection Function
```typescript
const checkAutoScroll = useCallback((clientX: number, clientY: number) => {
  // Only activate during popup dragging
  const draggingPopupId = draggingPopup;
  if (!draggingPopupId) {
    if (autoScrollRef.current.isActive) {
      setAutoScroll(prev => ({ ...prev, isActive: false, velocity: { x: 0, y: 0 } }));
    }
    return;
  }

  const viewport = overlayRef.current?.getBoundingClientRect();
  if (!viewport) return;

  const { threshold, speed, maxSpeed } = autoScrollRef.current;
  let scrollX = 0;
  let scrollY = 0;

  // Calculate distance from edges
  const distFromLeft = clientX - viewport.left;
  const distFromRight = viewport.right - clientX;
  const distFromTop = clientY - viewport.top;
  const distFromBottom = viewport.bottom - clientY;

  // Progressive speed based on distance from edge
  if (distFromLeft < threshold && distFromLeft >= 0) {
    // Closer to edge = faster scroll
    const ratio = 1 - (distFromLeft / threshold);
    scrollX = speed + (maxSpeed - speed) * ratio;
  } else if (distFromRight < threshold && distFromRight >= 0) {
    const ratio = 1 - (distFromRight / threshold);
    scrollX = -(speed + (maxSpeed - speed) * ratio);
  }

  if (distFromTop < threshold && distFromTop >= 0) {
    const ratio = 1 - (distFromTop / threshold);
    scrollY = speed + (maxSpeed - speed) * ratio;
  } else if (distFromBottom < threshold && distFromBottom >= 0) {
    const ratio = 1 - (distFromBottom / threshold);
    scrollY = -(speed + (maxSpeed - speed) * ratio);
  }

  // Update auto-scroll state
  if (scrollX !== 0 || scrollY !== 0) {
    const newVelocity = { x: scrollX, y: scrollY };
    autoScrollRef.current = {
      ...autoScrollRef.current,
      isActive: true,
      velocity: newVelocity
    };
    setAutoScroll(prev => ({
      ...prev,
      isActive: true,
      velocity: newVelocity
    }));
  } else if (autoScrollRef.current.isActive) {
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
}, [draggingPopup]);
```

### 3.2 Animation Loop
```typescript
// Auto-scroll animation effect
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
    setTransform(prev => {
      const scale = prev.scale || 1;
      return {
        ...prev,
        x: prev.x + autoScroll.velocity.x / scale,
        y: prev.y + autoScroll.velocity.y / scale
      };
    });

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
}, [autoScroll.isActive, autoScroll.velocity]);
```

### 3.3 Integration with Drag Events

#### Modify Existing onDragStart Handler
Add tracking for which popup is being dragged:
```typescript
// In notes-explorer-phase1.tsx or wherever popup drag is handled
const handlePopupDragStart = (popupId: string, event: React.MouseEvent) => {
  setDraggingPopup(popupId);
  // ... existing drag logic
};
```

#### Add to Existing Mouse Move Handler
```typescript
// During popup drag (in handlePointerMove or equivalent)
const handleDragMove = (event: MouseEvent) => {
  // ... existing drag logic
  
  // Check for auto-scroll
  checkAutoScroll(event.clientX, event.clientY);
};
```

#### Update Drag End Handler
```typescript
const handleDragEnd = () => {
  // ... existing logic
  
  // Stop auto-scroll
  setAutoScroll(prev => ({
    ...prev,
    isActive: false,
    velocity: { x: 0, y: 0 }
  }));
  
  // Clear animation frame
  if (animationFrameRef.current) {
    cancelAnimationFrame(animationFrameRef.current);
    animationFrameRef.current = null;
  }
};
```

## 4. Visual Indicators (Optional Enhancement)

### 4.1 Edge Glow Effect
```css
/* Add to popup-overlay.css */
.popup-overlay-autoscroll-active::before {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: linear-gradient(
    to right,
    rgba(59, 130, 246, 0.1) 0%,
    transparent 80px,
    transparent calc(100% - 80px),
    rgba(59, 130, 246, 0.1) 100%
  );
  opacity: 0;
  transition: opacity 0.2s;
}

.popup-overlay-autoscroll-active[data-scroll-x="true"]::before {
  opacity: 1;
}
```

### 4.2 Scroll Direction Indicators
```typescript
// Add visual feedback for active scroll direction
const getScrollIndicatorClass = () => {
  const classes = [];
  if (autoScroll.velocity.x > 0) classes.push('scrolling-right');
  if (autoScroll.velocity.x < 0) classes.push('scrolling-left');
  if (autoScroll.velocity.y > 0) classes.push('scrolling-down');
  if (autoScroll.velocity.y < 0) classes.push('scrolling-up');
  return classes.join(' ');
};
```

## 5. Configuration & Settings

### 5.1 User Preferences
```typescript
// Add to feature flags or settings
interface AutoScrollSettings {
  enabled: boolean;
  threshold: number;    // 20-150px range
  minSpeed: number;     // 1-10px/frame
  maxSpeed: number;     // 5-30px/frame
  acceleration: 'linear' | 'exponential' | 'ease';
}
```

### 5.2 Debug Mode
```typescript
// Debug visualization
const DEBUG_AUTOSCROLL = process.env.NODE_ENV === 'development';

if (DEBUG_AUTOSCROLL && autoScroll.isActive) {
  console.log('[AutoScroll]', {
    velocity: autoScroll.velocity,
    threshold: autoScroll.threshold,
    active: autoScroll.isActive
  });
}
```

## 6. Testing Strategy

### 6.1 Unit Tests
```typescript
// __tests__/autoscroll.test.ts
describe('AutoScroll Edge Detection', () => {
  test('activates when dragging within threshold', () => {
    // Test edge detection logic
  });
  
  test('calculates correct velocity based on distance', () => {
    // Test progressive speed calculation
  });
  
  test('supports diagonal scrolling', () => {
    // Test corner activation
  });
});
```

### 6.2 Integration Tests
1. Drag popup to each edge → verify scroll activates
2. Drag popup to corner → verify diagonal scroll
3. Release drag → verify scroll stops immediately
4. Drag popup quickly across edge → verify smooth transition

### 6.3 Performance Tests
- Maintain 60fps during auto-scroll
- No memory leaks from RAF
- Smooth scroll with 10+ popups visible

## 7. Implementation Steps

### Phase 1: Core Functionality (2-3 hours)
1. Add AutoScrollState interface and state variables
2. Implement checkAutoScroll function
3. Add animation loop with requestAnimationFrame
4. Integrate with existing drag handlers

### Phase 2: Testing & Refinement (1-2 hours)
1. Test all edge cases
2. Tune threshold and speed values
3. Add debug logging
4. Fix any conflicts with existing pan/zoom

### Phase 3: Polish & Enhancement (1 hour)
1. Add visual indicators (optional)
2. Add configuration options
3. Performance optimization
4. Documentation

## 8. Rollback Plan
If issues arise:
1. Feature flag: `ui.autoScrollEnabled = false`
2. Remove autoScroll state and effects
3. Keep existing drag functionality intact

## 9. Success Metrics
- **Performance**: 60fps maintained during scroll
- **UX**: Users can drag popups to any canvas location
- **Reliability**: No crashes or stuck scroll states
- **Adoption**: Feature used by >50% of users

## 10. Code Location Summary

### Files to Modify:
1. **`components/canvas/popup-overlay.tsx`**
   - Add AutoScrollState (line ~65)
   - Add checkAutoScroll function (line ~330)
   - Add animation effect (line ~470)
   - Integrate with drag handlers

2. **`components/notes-explorer-phase1.tsx`**
   - Pass draggingPopup state to PopupOverlay
   - Handle drag events with auto-scroll check

3. **`styles/popup-overlay.css`**
   - Add visual indicators (optional)

### New Files:
- `lib/utils/auto-scroll.ts` - Reusable auto-scroll utilities (optional)
- `__tests__/auto-scroll.test.ts` - Test suite

## 11. Example Usage
```typescript
// User drags popup toward right edge
// → checkAutoScroll detects mouse at x: viewport.width - 50px
// → Calculates velocity.x = -10 (scroll left)
// → RAF loop updates transform.x by -10px each frame
// → Canvas pans left, revealing more space
// → User continues dragging popup to new area
// → User releases mouse
// → Auto-scroll stops immediately
```

## 12. Acceptance Criteria
- [ ] Auto-scroll activates within 80px of any edge
- [ ] Scroll speed increases closer to edge
- [ ] Diagonal scrolling works at corners
- [ ] Smooth 60fps animation
- [ ] Stops immediately on mouse release
- [ ] No conflicts with existing pan/zoom
- [ ] Works in both Web and Electron
- [ ] Configurable threshold and speed

---

**Note**: This implementation is based on the proven pattern from `infinite-canvas-main` but adapted specifically for the popup overlay system. The key difference is that we're scrolling the popup canvas transform rather than the main canvas state.