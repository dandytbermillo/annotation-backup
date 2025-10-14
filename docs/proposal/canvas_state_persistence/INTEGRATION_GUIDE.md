# Canvas State Persistence - Integration Guide

This guide shows how to integrate the canvas state persistence system into your application.

## Prerequisites

1. Run database migrations:
   ```bash
   # Apply panel persistence columns
   psql $DATABASE_URL -f migrations/030_add_canvas_persistence_columns.up.sql

   # Apply camera state table
   psql $DATABASE_URL -f migrations/031_add_canvas_camera_state.up.sql
   ```

2. Verify migrations:
   ```sql
   -- Check panels table has new columns
   SELECT column_name, data_type
   FROM information_schema.columns
   WHERE table_name = 'panels'
   AND column_name IN ('position_x_world', 'position_y_world', 'width_world', 'height_world', 'z_index', 'revision_token');

   -- Check canvas_camera_state table exists
   SELECT table_name
   FROM information_schema.tables
   WHERE table_name = 'canvas_camera_state';
   ```

## Integration Steps

### 1. Add Hydration to Canvas Component

In your main canvas component (e.g., `components/canvas/canvas-container.tsx`):

```typescript
import { useCanvasHydration } from '@/lib/hooks/use-canvas-hydration'
import { useCameraPersistence } from '@/lib/hooks/use-camera-persistence'
import { usePanelPersistence } from '@/lib/hooks/use-panel-persistence'

function CanvasContainer({ noteId, userId }: { noteId: string; userId?: string }) {
  const { dataStore, branchesMap, layerManager } = useCanvas()

  // Hydrate on mount
  const { loading, error, success, panelsLoaded } = useCanvasHydration({
    noteId,
    userId,
    dataStore,
    branchesMap,
    layerManager,
    enabled: true
  })

  // Enable camera persistence
  useCameraPersistence({
    noteId,
    userId,
    debounceMs: 500,
    enabled: true
  })

  // Show loading state
  if (loading) {
    return <div>Loading canvas state...</div>
  }

  if (error) {
    console.error('Hydration error:', error)
    // Continue with default state
  }

  // Render canvas
  return <Canvas noteId={noteId} />
}
```

### 2. Integrate Panel Persistence in Drag Handler

In `components/canvas/canvas-panel.tsx`, modify the drag_end handler:

```typescript
import { usePanelPersistence } from '@/lib/hooks/use-panel-persistence'

function CanvasPanel({ panelId, noteId, ...props }) {
  const { dataStore, branchesMap, layerManager } = useCanvas()

  const { persistPanelUpdate } = usePanelPersistence({
    dataStore,
    branchesMap,
    layerManager,
    noteId,
    userId: undefined // or pass actual userId for multi-user
  })

  // In your drag_end handler (around line 1900):
  const handleDragEnd = async (e: MouseEvent) => {
    // ... existing drag end logic ...

    // Get final position from DOM
    const finalX = parseInt(panel.style.left, 10)
    const finalY = parseInt(panel.style.top, 10)

    // Persist with world-space conversion
    await persistPanelUpdate({
      panelId,
      position: { x: finalX, y: finalY },
      // size: { width, height }, // optional
      // zIndex: newZIndex // optional
    })

    // ... rest of existing logic ...
  }
}
```

### 3. Initialize Offline Queue

Add to your app initialization (e.g., `app/layout.tsx` or `_app.tsx`):

```typescript
import { canvasOfflineQueue } from '@/lib/canvas/canvas-offline-queue'

useEffect(() => {
  // Initialize offline queue on app mount
  canvasOfflineQueue.init().catch(err => {
    console.error('Failed to initialize offline queue:', err)
  })

  return () => {
    // Cleanup on unmount
    canvasOfflineQueue.stopQueueProcessor()
  }
}, [])
```

### 4. Handle Panel Creation

When creating new panels:

```typescript
const { persistPanelCreate } = usePanelPersistence({ ... })

// After creating panel in UI
await persistPanelCreate({
  panelId: newPanel.id,
  type: 'editor', // or 'branch', 'context', etc.
  position: { x: screenX, y: screenY },
  size: { width: 400, height: 300 },
  zIndex: 0,
  state: 'active'
})
```

### 5. Handle Panel Deletion

When deleting panels:

```typescript
const { persistPanelDelete } = usePanelPersistence({ ... })

// After removing panel from UI
await persistPanelDelete(panelId)
```

## API Endpoints

### Panel Layout Endpoints

- `GET /api/canvas/layout/:noteId` - Fetch all panels for a note
- `PATCH /api/canvas/layout/:noteId` - Batch update panel positions
- `POST /api/canvas/panels` - Create new panel
- `DELETE /api/canvas/panels/:panelId` - Delete panel

### Camera State Endpoints

- `GET /api/canvas/camera/:noteId?userId=<uuid>` - Fetch camera state
- `PATCH /api/canvas/camera/:noteId` - Update camera state

## Testing

### Manual Testing

1. **Panel Persistence Test**:
   ```
   - Open a note with panels
   - Drag panels to new positions
   - Wait 500ms (debounce delay)
   - Refresh page
   - Verify panels are in correct positions
   ```

2. **Camera Persistence Test**:
   ```
   - Pan and zoom the canvas
   - Wait 500ms
   - Refresh page
   - Verify camera returns to same position and zoom
   ```

3. **Offline Queue Test**:
   ```
   - Disconnect network
   - Drag panels
   - Reconnect network
   - Verify updates are replayed from queue
   ```

4. **Conflict Resolution Test**:
   ```
   - Open same note in two tabs
   - Drag same panel in both tabs (quickly, within 100ms)
   - Verify latest update wins
   - Check IndexedDB queue for conflict resolution
   ```

### Database Verification

Check persisted data in database:

```sql
-- View persisted panel positions (world-space coordinates)
SELECT
  id,
  note_id,
  type,
  position_x_world,
  position_y_world,
  width_world,
  height_world,
  z_index,
  revision_token,
  updated_at
FROM panels
WHERE note_id = '<your-note-id>'
ORDER BY z_index ASC;

-- View camera state
SELECT
  note_id,
  user_id,
  camera_x,
  camera_y,
  zoom_level,
  updated_at
FROM canvas_camera_state
WHERE note_id = '<your-note-id>';
```

### IndexedDB Inspection

Check offline queue in browser DevTools:

1. Open DevTools → Application → IndexedDB
2. Find `canvas_offline_queue` database
3. Check `operations` store for pending operations
4. Verify operations have correct structure:
   ```js
   {
     id: "uuid",
     type: "panel_update" | "panel_create" | "panel_delete" | "camera_update",
     noteId: "uuid",
     timestamp: 1234567890,
     retryCount: 0,
     status: "pending",
     data: { ... }
   }
   ```

## Coordinate System Reference

- **World-space**: Zoom-invariant coordinates stored in database
  - `position_x_world`, `position_y_world`
  - `width_world`, `height_world`

- **Screen-space**: Viewport-relative coordinates for rendering
  - `panel.style.left`, `panel.style.top`
  - Affected by camera translation and zoom

- **Conversion formulas**:
  ```
  world = screen / zoom - camera
  screen = (world + camera) * zoom
  ```

## Troubleshooting

### Panels not persisting
1. Check browser console for API errors
2. Verify migrations ran successfully
3. Check DATABASE_URL is set correctly
4. Inspect network tab for failed API calls

### Camera not restoring
1. Check camera endpoint returns correct data
2. Verify camera state is being updated (check database)
3. Ensure `useCameraPersistence` hook is mounted

### Offline queue not processing
1. Check IndexedDB is available (not in private mode)
2. Verify `canvasOfflineQueue.init()` was called
3. Check browser console for queue errors
4. Manually flush: `canvasOfflineQueue.flush()`

### Coordinate mismatches
1. Verify camera state is loaded before panels
2. Check zoom level is being applied correctly
3. Use `verifyCoordinateRoundTrip()` utility to test formulas
4. Ensure world-space is stored, not screen-space

## Performance Considerations

- **Debouncing**: Camera updates debounced to 500ms (configurable)
- **Throttling**: Consider throttling drag updates if many panels
- **Batch Updates**: Use `persistBatchUpdates()` for bulk operations
- **IndexedDB**: Better performance than localStorage for large queues
- **Conflict Resolution**: Runs before queue flush to deduplicate operations

## Rollback

If you need to rollback the migrations:

```bash
# Rollback camera state table
psql $DATABASE_URL -f migrations/031_add_canvas_camera_state.down.sql

# Rollback panel persistence columns
psql $DATABASE_URL -f migrations/030_add_canvas_persistence_columns.down.sql
```

**Warning**: Rollback will delete all persisted camera states and drop the new panel coordinate columns. Backup your database first!

## Next Steps

1. **Phase 6**: Verify coordinate formulas against actual canvas rendering
2. **Phase 9**: Run comprehensive system tests
3. **Future**: Add conflict resolution UI for revision conflicts
4. **Future**: Add batch export/import for canvas layouts
5. **Future**: Add canvas layout templates

## Support

For issues or questions:
- Check implementation plan: `docs/proposal/canvas_state_persistence/implementation.md`
- Review coordinate utilities: `lib/canvas/coordinate-utils.ts`
- Check offline queue logs in browser console
- Inspect database state with SQL queries above
