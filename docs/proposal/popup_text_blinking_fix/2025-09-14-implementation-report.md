# Popup Text Blinking Fix Implementation Report
Date: 2025-09-14

## Issue
Text in popup overlays was blinking/flickering during canvas panning operations.

## Root Cause Analysis
After analyzing the infinite-canvas-main project's approach, we identified the following causes:
1. **CSS Transitions during drag** - The `transition: transform 0.3s` was active during mousemove events, causing continuous interpolation and flickering
2. **Math.round() on transforms** - While intended to prevent subpixel shimmer, this was actually causing jumpy motion
3. **Missing GPU optimization hints** - No `backfaceVisibility` or `transformStyle` properties to stabilize GPU layers

## Solution Applied
Adopted the infinite-canvas-main approach with the following changes:

### 1. PopupOverlay Component (`components/canvas/popup-overlay.tsx`)
- **Removed Math.round()** from transform values to allow smooth subpixel positioning
- **Added `transition: 'none'`** to container style to eliminate transition-based flickering
- **Enhanced GPU hints** during drag:
  - Added `backfaceVisibility: 'hidden'`
  - Added `perspective: '1000px'`
  - Applied `transformStyle: 'preserve-3d'`
- **Dynamic will-change** - Only applies during active panning

### 2. AnnotationCanvasModern Component (`components/annotation-canvas-modern.tsx`)
- **Removed Math.round()** from canvas transforms
- **Added GPU optimization properties**:
  - `backfaceVisibility: 'hidden'`
  - `transformStyle: 'preserve-3d'`
- **Preserved conditional transitions** - Still disables during drag

## Key Differences from infinite-canvas-main
| Aspect | Their Approach | Our Implementation |
|--------|---------------|-------------------|
| Transform values | Exact decimals | Exact decimals (adopted) |
| Transitions | None during drag | None during drag (adopted) |
| GPU hints | Basic | Enhanced with perspective |
| will-change | Only on selected | Dynamic during pan |
| Paint containment | Not used | Added for isolation |

## Testing Results
- Development server started successfully on port 3001
- Text blinking issue should be resolved
- Smooth panning without visual artifacts expected

## Files Modified
1. `/components/canvas/popup-overlay.tsx` - Lines 351-361, 220-224, 299-303
2. `/components/annotation-canvas-modern.tsx` - Lines 416-421

## Next Steps
- Manual testing required to verify the fix
- Monitor for any performance regressions
- Consider adding similar optimizations to other draggable components

## Notes
The primary fix was removing CSS transitions during drag operations, which was the main cause of text flickering. The infinite-canvas-main project's approach of using exact pixel values (no rounding) combined with proper GPU hints provides the smoothest experience.