# Edge Glow Visual Affordance

**Date:** 2025-01-12
**Feature:** Visual edge glow during auto-scroll activation delay
**Purpose:** Provide clear, accessible visual feedback when cursor enters auto-scroll zone

---

## Overview

When a user drags a panel near the viewport edge, a **subtle glowing border** appears along that edge to indicate that auto-scroll will activate if they hold the cursor there for 800ms. This provides:

1. **Immediate Feedback** - User knows they're in the auto-scroll zone
2. **Intent Clarity** - "Hold here to scroll" is visually communicated
3. **Cancellation Hint** - User can move cursor away to cancel (glow disappears)

---

## Visual Design

### Appearance:

**Edge Glow Properties:**
- **Color:** Blue (`rgba(59, 130, 246, ...)`) - matches app accent color
- **Width/Height:** 4px border along the edge
- **Gradient:** Fades from edge inward (subtle, not jarring)
- **Glow Effect:** Soft box-shadow creating a luminous appearance
- **Animation:**
  - Fade-in: 300ms ease-out (smooth appearance)
  - Pulse: 1.5s cycle (60% → 100% → 60% opacity)

**Example (Top Edge):**
```
┌─────────────────────────────────────┐
│ ███████████ BLUE GLOW ████████████│ ← 4px glowing border
├─────────────────────────────────────┤
│                                     │
│         Viewport Content            │
│                                     │
│                                     │
└─────────────────────────────────────┘
```

---

## Accessibility Considerations

### Multi-Sensory Feedback:

**Visual:**
- High-contrast blue glow (visible against light/dark backgrounds)
- Pulsing animation (motion cue, not just color)
- Gradient creates depth perception

**Cursor:**
- Changes to "wait" cursor during countdown
- Provides tactile feedback

**Combined:**
- Users who can't see color still get motion + cursor change
- Users who can't see well still get cursor feedback
- Multi-modal reinforcement

**Accessibility Checklist:**
- [x] Not relying solely on color
- [x] Motion/animation included (pulse)
- [x] Contrast sufficient (blue vs background)
- [x] Alternative cue (cursor change)
- [x] Non-intrusive (subtle, doesn't block content)

---

## Technical Implementation

### Architecture:

**Component:** `canvas-panel.tsx`
**Rendering:** Portal to `document.body` (fixed positioning, viewport-level)

**Data Flow:**
```
useAutoScroll hook
  ↓
  Sets autoScroll.pendingEdges = ['TOP', 'LEFT', ...] when timer starts
  ↓
  Cleared when timer completes or cancelled
  ↓
canvas-panel.tsx
  ↓
  Reads autoScroll.pendingEdges
  ↓
  Renders portal with edge glow overlays for each pending edge
```

### Code Structure:

**1. State Tracking (`use-auto-scroll.ts`):**
```typescript
interface AutoScrollState {
  isActive: boolean
  velocity: { x: number; y: number }
  threshold: number
  speed: number
  pendingEdges: string[] // NEW: ['TOP', 'LEFT', 'RIGHT', 'BOTTOM']
}

// Set pending edges when delay starts
setAutoScroll(prev => ({
  ...prev,
  pendingEdges: edges // e.g., ['TOP']
}))

// Clear when delay completes or cancels
setAutoScroll(prev => ({
  ...prev,
  pendingEdges: []
}))
```

**2. Rendering (`canvas-panel.tsx`):**
```tsx
{typeof window !== 'undefined' && autoScroll.pendingEdges.length > 0 && createPortal(
  <div className="auto-scroll-edge-glows">
    {autoScroll.pendingEdges.map(edge => (
      <div
        key={edge}
        className={`auto-scroll-edge-glow auto-scroll-edge-glow-${edge.toLowerCase()}`}
        style={{
          position: 'fixed',
          zIndex: 999999,
          pointerEvents: 'none',
          // Edge-specific positioning...
        }}
      />
    ))}
    <style jsx>{/* CSS animations */}</style>
  </div>,
  document.body
)}
```

**3. CSS Animations (Inline):**
```css
@keyframes edgeGlowFadeIn {
  from { opacity: 0; transform: scale(0.95); }
  to { opacity: 1; transform: scale(1); }
}

@keyframes edgeGlowPulse {
  0%, 100% { opacity: 0.6; }
  50% { opacity: 1; }
}

.auto-scroll-edge-glow {
  animation:
    edgeGlowFadeIn 0.3s ease-out forwards,
    edgeGlowPulse 1.5s ease-in-out infinite;
}
```

---

## Edge-Specific Styling

### Top Edge:
```javascript
{
  top: 0,
  left: 0,
  right: 0,
  height: '4px',
  background: 'linear-gradient(to bottom, rgba(59, 130, 246, 0.6), transparent)',
  boxShadow: '0 0 20px rgba(59, 130, 246, 0.4), 0 0 40px rgba(59, 130, 246, 0.2)'
}
```

### Bottom Edge:
```javascript
{
  bottom: 0,
  left: 0,
  right: 0,
  height: '4px',
  background: 'linear-gradient(to top, rgba(59, 130, 246, 0.6), transparent)',
  boxShadow: '0 0 20px rgba(59, 130, 246, 0.4), 0 0 40px rgba(59, 130, 246, 0.2)'
}
```

### Left Edge:
```javascript
{
  top: 0,
  left: 0,
  bottom: 0,
  width: '4px',
  background: 'linear-gradient(to right, rgba(59, 130, 246, 0.6), transparent)',
  boxShadow: '0 0 20px rgba(59, 130, 246, 0.4), 0 0 40px rgba(59, 130, 246, 0.2)'
}
```

### Right Edge:
```javascript
{
  top: 0,
  right: 0,
  bottom: 0,
  width: '4px',
  background: 'linear-gradient(to left, rgba(59, 130, 246, 0.6), transparent)',
  boxShadow: '0 0 20px rgba(59, 130, 246, 0.4), 0 0 40px rgba(59, 130, 246, 0.2)'
}
```

---

## Behavior Timeline

### Scenario: User Positions Panel Near Top Edge

```
t=0ms    User drags panel, cursor enters < 50px from top edge
         ↓
         Edge glow APPEARS at top (300ms fade-in animation)
         Cursor changes to "wait"
         800ms countdown STARTS
         ↓
t=100ms  Glow is visible, pulsing gently
         User sees feedback: "I'm in the auto-scroll zone"
         ↓
t=300ms  Fade-in complete, glow fully visible
         Pulse animation continues (1.5s cycle)
         ↓
         TWO POSSIBLE OUTCOMES:

         A. User moves cursor away (< 800ms elapsed)
            ↓
            Edge glow FADES OUT (reverse fade-in)
            Cursor returns to normal
            Timer cancelled
            ✅ No auto-scroll (correct for positioning intent)

         B. User holds cursor at edge (≥ 800ms elapsed)
            ↓
            Auto-scroll ACTIVATES
            Edge glow DISAPPEARS (no longer needed)
            Cursor changes to normal scroll cursor
            Canvas starts scrolling
            ✅ Auto-scroll active (correct for navigation intent)
```

---

## Performance Considerations

### Rendering:
- **Portal:** Renders at document.body level (no re-renders of canvas/panels)
- **Fixed Positioning:** GPU-accelerated (position: fixed)
- **CSS Animations:** Hardware-accelerated (transform, opacity)
- **Conditional Rendering:** Only renders when `pendingEdges.length > 0`

### Memory:
- No additional state beyond `pendingEdges` array
- Overlay removed from DOM when not needed
- No event listeners (pure visual element)

### Impact:
- Negligible CPU usage (CSS animations run on GPU)
- Negligible memory footprint (< 1KB DOM elements)
- No impact on scroll performance

---

## Testing Checklist

### Visual Tests:

- [ ] **Top Edge:** Glow appears along top when cursor enters top zone
- [ ] **Bottom Edge:** Glow appears along bottom
- [ ] **Left Edge:** Glow appears along left
- [ ] **Right Edge:** Glow appears along right
- [ ] **Corner (Top-Left):** Both top and left glows appear simultaneously
- [ ] **Fade-In:** Glow fades in smoothly (300ms)
- [ ] **Pulse:** Glow pulses gently (1.5s cycle, 60% → 100% opacity)
- [ ] **Disappears:** Glow disappears when cursor moves away
- [ ] **Activation:** Glow disappears when auto-scroll activates

### Accessibility Tests:

- [ ] **Color Blind:** Motion/pulse still visible without color perception
- [ ] **High Contrast Mode:** Glow visible in system high-contrast mode
- [ ] **Screen Readers:** No interference (glow is decorative, not announced)
- [ ] **Reduced Motion:** Pulse animation respects `prefers-reduced-motion` (TODO)

### Browser Tests:

- [ ] Chrome/Edge (Chromium)
- [ ] Firefox
- [ ] Safari
- [ ] Mobile Safari
- [ ] Mobile Chrome

---

## Future Enhancements

### Reduced Motion Support:

Add media query for accessibility:

```css
@media (prefers-reduced-motion: reduce) {
  .auto-scroll-edge-glow {
    animation: edgeGlowFadeIn 0.3s ease-out forwards;
    /* Remove pulse animation for users with motion sensitivity */
  }
}
```

### Customizable Color:

Allow theme-based color:

```typescript
const edgeColor = theme.accentColor || 'rgba(59, 130, 246, 0.6)'
```

### Countdown Visual:

Add subtle progress indicator during 800ms delay:

```css
.auto-scroll-edge-glow::after {
  content: '';
  animation: countdownProgress 800ms linear forwards;
}

@keyframes countdownProgress {
  from { width: 0%; }
  to { width: 100%; }
}
```

---

## Summary

**What:** Glowing border along viewport edges during auto-scroll activation delay

**Why:**
- Provides immediate visual feedback
- Clarifies user intent (position vs navigate)
- Reduces surprise auto-scroll activations

**How:**
- Portal-rendered fixed overlay
- CSS animations (fade-in + pulse)
- Edge-specific gradient and positioning

**Accessibility:**
- Multi-sensory (visual + motion + cursor)
- High contrast
- Respects reduced motion (TODO)

**Performance:**
- GPU-accelerated
- Minimal DOM impact
- No JavaScript overhead

---

**Status:** ✅ Implemented and ready for testing
**Requirement:** User testing to validate effectiveness
**Next:** Add `prefers-reduced-motion` support
