# UI Workflows and Interaction Patterns

## Popup System Workflow

### Overview
The popup system provides a cascading, multi-level preview interface for browsing folder contents without navigating away from the current view. Popups can be triggered via hover (temporary) or click (persistent).

### Trigger Mechanisms

#### 1. **Hover Trigger (Temporary Popup)**
- **Activation**: Mouse enters the eye (👁) icon on a folder
- **Behavior**: 
  - Popup appears after 100ms delay (prevents accidental triggers)
  - Shows folder contents in a floating panel
  - Position intelligently adjusted to fit screen boundaries
- **Deactivation**: 
  - Popup disappears 300ms after mouse leaves the eye icon
  - Allows time for user to move cursor to the popup itself
  - If cursor enters popup, it remains visible

#### 2. **Click Trigger (Persistent Popup)**
- **Activation**: Click the eye (👁) icon on a folder
- **Behavior**:
  - Popup appears immediately and stays open
  - Marked with `isPersistent: true` flag internally
  - Will not auto-hide on mouse leave
  - Can be dragged to reposition
- **Deactivation**:
  - Click the eye icon again (toggle behavior)
  - Click the X button on the popup
  - Use "Close All" action

### Popup States

```
IDLE → HOVER_PENDING → VISIBLE_TEMPORARY → HIDDEN
     ↘                ↗
       VISIBLE_PERSISTENT
```

#### State Descriptions:
- **IDLE**: No popup active for this folder
- **HOVER_PENDING**: Mouse entered eye icon, waiting 100ms before showing
- **VISIBLE_TEMPORARY**: Popup shown via hover, will auto-hide
- **VISIBLE_PERSISTENT**: Popup shown via click, stays until manually closed
- **HIDDEN**: Popup closed, returns to IDLE

### Cascading Behavior

#### Multi-Level Support
- Each popup can spawn child popups
- Child popups appear offset to the right by default
- Maximum cascade depth prevents screen overflow
- Parent-child relationships tracked for connection lines

#### Smart Positioning
```javascript
// Position calculation priority:
1. Try right side of parent (cascade)
2. If no space, try left side
3. If still no space, overlap with offset
4. Always keep within viewport bounds
```

### Interaction Rules

#### Mouse Interactions
| Action | Temporary Popup | Persistent Popup |
|--------|----------------|------------------|
| Hover eye icon | Shows popup | No effect if already open |
| Leave eye icon | Hides after 300ms | No effect |
| Click eye icon | Converts to persistent | Closes (toggle) |
| Enter popup area | Keeps visible | Keeps visible |
| Leave popup area | Hides after delay | Stays visible |
| Drag popup | Not draggable | Draggable |

#### Keyboard Shortcuts
- `Escape`: Close focused popup
- `Shift + Escape`: Close all popups
- `Space` (on folder): Toggle popup

### Visual Feedback

#### Popup Appearance
- **Shadow**: Elevated shadow indicates floating state
- **Border**: Subtle border for definition
- **Header**: Shows folder name and navigation breadcrumb
- **Connection Lines**: Bezier curves connect parent-child popups

#### State Indicators
- **Loading State**: Spinner while fetching folder contents
- **Empty State**: "No items" message for empty folders
- **Error State**: Red border with error message

### Performance Considerations

#### Lazy Loading
- Folder contents loaded on-demand
- Cached after first load
- Child folders not pre-fetched

#### Cleanup
- Timeouts cleared on component unmount
- Event listeners properly removed
- Memory-efficient Map structure for popup storage

### Code Implementation

#### Key Functions
```typescript
// Show popup on hover (temporary)
handleFolderHover(folder, event, parentId, false)

// Show popup on click (persistent)
handleFolderHover(folder, event, parentId, true)

// Hide non-persistent popups
handleFolderHoverLeave(folderId)

// Close specific popup
closePopover(popoverId)

// Close all popups
closeAllPopovers()
```

#### Data Structure
```typescript
interface PopupState {
  id: string
  folder: TreeNode | null
  position: { x: number, y: number }
  isLoading: boolean
  parentId?: string
  level: number
  isPersistent?: boolean  // Key flag for behavior
  isDragging?: boolean
  height?: number
}
```

### Best Practices

1. **Prevent Flickering**: Use delays to smooth transitions
2. **Smart Positioning**: Always check viewport boundaries
3. **Clear Visual Hierarchy**: Use z-index layering appropriately
4. **Responsive to User Intent**: Differentiate hover vs click intent
5. **Memory Management**: Clean up unused popups and timeouts

### Accessibility

- **ARIA Labels**: Proper labeling for screen readers
- **Keyboard Navigation**: Full keyboard support
- **Focus Management**: Logical focus flow through popups
- **Escape Routes**: Multiple ways to close popups

---

## Notes Explorer Sidebar Workflow

### Trigger Mechanisms

#### Sidebar Toggle Button
- **Location**: Center-left edge of screen
- **Appearance**: "N" button in a tab-like design
- **Behavior**:
  - Hover: Opens sidebar immediately
  - Click: Opens sidebar (same as hover)
  - Auto-hide: Sidebar closes 800ms after mouse leaves

#### Sidebar States
```
CLOSED → OPENING → OPEN → CLOSING → CLOSED
```

### Interaction Flow
1. User hovers/clicks "N" button → Sidebar slides in from left
2. Mouse enters sidebar → Stays open (cancels any hide timer)
3. Mouse leaves sidebar → Starts 800ms timer
4. Timer expires → Sidebar slides out
5. Mouse re-enters before timer → Cancels hide, stays open

### Visual Feedback
- **Slide Animation**: 300ms smooth transition
- **Button Hover**: Slight width expansion on hover
- **Text Scale**: "N" grows slightly on hover

---

## Control Panel Workflow

### Layout Structure
- **Fixed Metrics Bar**: Always visible at top
  - FPS, Memory, Components, Panels, Isolated, Zoom
- **Tab Navigation**: Canvas, Isolation, State
- **Tab Content**: Specific controls per tab

### Visibility
- **Development Only**: Only shows in development mode
- **Position**: Top-right corner, 600px wide
- **Toggle**: Settings button or keyboard shortcut

---

## Component Isolation Workflow

### Automatic Isolation
1. **Performance Monitoring**: FPS tracked continuously
2. **Threshold Detection**: FPS < 30 for 4 consecutive windows
3. **Candidate Selection**: Choose heaviest component
4. **Isolation**: Replace component with placeholder
5. **Auto-restore**: After 10 seconds

### Manual Isolation
1. **Lock Button**: Click lock icon on component/panel
2. **Visual Change**: Red border, "ISOLATED" badge
3. **Placeholder**: Shows restoration button
4. **Unlock**: Click unlock icon to restore

### States
```
NORMAL → EVALUATING → ISOLATED → RESTORING → NORMAL
```

---

## Canvas Navigation Workflow

### Zoom Controls

#### Mouse Wheel Zoom (Modified Behavior)
- **Required Modifier**: Must hold `Shift` key while scrolling
- **Reason**: Prevents accidental zooming during normal scrolling
- **Visual Hint**: Header shows "Hold Shift + Scroll to zoom"
- **Zoom Behavior**:
  - `Shift + Scroll Up`: Zoom in (1.1x multiplier)
  - `Shift + Scroll Down`: Zoom out (0.9x multiplier)
  - `Scroll without Shift`: Normal page scroll (if applicable)

#### Alternative Zoom Methods
- **Control Panel Buttons**: Click Zoom In/Out in control panel
- **Keyboard Shortcuts**: 
  - `Ctrl/Cmd + Plus`: Zoom in
  - `Ctrl/Cmd + Minus`: Zoom out
  - `Ctrl/Cmd + 0`: Reset zoom to 100%

### Pan Controls
- **Click and Drag**: Click on empty canvas area and drag to pan
- **Touch Support**: Two-finger drag on trackpad
- **Reset View**: Button in control panel returns to default position

---

## Best Practices Summary

1. **Immediate Feedback**: Visual response within 100ms
2. **Predictable Behavior**: Consistent hover/click patterns
3. **Clear Affordances**: Visual hints for interactive elements
4. **Graceful Degradation**: Fallbacks for errors/edge cases
5. **Performance First**: Lazy loading, cleanup, optimization
6. **Prevent Accidents**: Require modifier keys for destructive/disruptive actions