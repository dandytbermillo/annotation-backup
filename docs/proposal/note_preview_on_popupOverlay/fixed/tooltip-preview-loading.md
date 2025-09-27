# Tooltip Preview Stuck in Loading State – Fix Summary

## Root Cause
- The fetch lifecycle in `components/canvas/popup-overlay.tsx` aborted state updates when the component re-mounted (React Strict Mode/dev hot reload), leaving `previewState` entries permanently in `status: "loading"`.
- Guards (`if (!entry || !entry.entries[childId]) return prev;`) and `isMountedRef` checks prevented success handlers from writing the fetched preview back into state, so the tooltip never saw `previewText` → always showed “Loading preview…”.
- Because the stale “loading” entry short-circuited subsequent requests (`shouldFetch: false`), preview never recovered without a page reload.

## Fix / Solution
1. **Abort-safe Fetch Lifecycle** (in `popup-overlay.tsx`):
   - Track an `AbortController` per `popupId:childId`, canceling any in-flight fetch before starting a new one and clearing controllers on unmount.
   - Remove the `isMountedRef` bail-out; rely on abort to stop updates when appropriate.
   - Let success/error handlers create/update entries even if they were missing, resetting `requestedAt` so the tooltip leaves the loading state.
2. **Tooltip Styling & Portal**:
   - Portal the preview tooltip using Radix `TooltipPortal` (exported from `components/ui/tooltip.tsx)‹` so it renders outside the overlay container.
   - Add `popup-preview-tooltip` styles to make the tooltip float beside the popup with a scrollable body, mirroring annotation tooltip behavior.

After these changes, the tooltip transitions to “ready” with the fetched snippet, and `debug_logs` show `preview_fetch_success` after each `preview_request`.

## Affected Files
- `components/canvas/popup-overlay.tsx`
- `components/ui/tooltip.tsx`
- `styles/popup-overlay.css`

## Code Snippets

### Fetch Lifecycle & State Update (`components/canvas/popup-overlay.tsx`)
```tsx
const previewStateRef = useRef(previewState);
const previewControllersRef = useRef<Map<string, AbortController>>(new Map());
...
useEffect(() => {
  return () => {
    previewControllersRef.current.forEach(ctrl => { try { ctrl.abort(); } catch {} });
    previewControllersRef.current.clear();
  };
}, []);

const fetchPreview = useCallback(async (popupId: string, childId: string) => {
  const controllerKey = `${popupId}:${childId}`;
  const existing = previewControllersRef.current.get(controllerKey);
  if (existing) {
    try { existing.abort(); } catch {}
  }
  const controller = new AbortController();
  previewControllersRef.current.set(controllerKey, controller);

  try {
    const response = await fetch(`/api/items/${childId}`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      credentials: 'same-origin',
      cache: 'no-store',
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Request failed with status ${response.status}`);

    const data = await response.json();
    const content = data?.item?.content ?? null;
    const contentText = data?.item?.contentText ?? '';
    const previewText = buildBranchPreview(content, contentText || '', TOOLTIP_PREVIEW_MAX_LENGTH);

    getUIResourceManager().enqueueLowPriority(() => {
      debugLog('PopupOverlay', 'preview_fetch_success', {
        popupId,
        childId,
        hasContent: Boolean(content),
        hasContentText: Boolean(contentText && contentText.trim().length),
        contentType: typeof content,
        previewLength: previewText.length,
      });
    });

    setPreviewState(prev => {
      const entry = prev[popupId] ?? { activeChildId: null, entries: {} };
      return {
        ...prev,
        [popupId]: {
          activeChildId: entry.activeChildId ?? childId,
          entries: {
            ...entry.entries,
            [childId]: {
              status: 'ready',
              content: content ?? contentText ?? null,
              previewText,
              requestedAt: undefined,
            },
          },
        },
      };
    });
  } catch (error: any) {
    if (error?.name === 'AbortError') return;
    getUIResourceManager().enqueueLowPriority(() => {
      debugLog('PopupOverlay', 'preview_fetch_error', {
        popupId,
        childId,
        message: error?.message ?? 'Unknown error',
      });
    });
    setPreviewState(prev => {
      const entry = prev[popupId] ?? { activeChildId: null, entries: {} };
      return {
        ...prev,
        [popupId]: {
          activeChildId: entry.activeChildId ?? childId,
          entries: {
            ...entry.entries,
            [childId]: {
              status: 'error',
              error: error?.message ?? 'Failed to load preview',
              previewText: entry.entries[childId]?.previewText,
              requestedAt: undefined,
            },
          },
        },
      };
    });
  } finally {
    previewControllersRef.current.delete(controllerKey);
  }
}, []);
```

### Portalized Tooltip (`components/canvas/popup-overlay.tsx`)
```tsx
<TooltipProvider delayDuration={150}>
  <Tooltip>
    <TooltipTrigger asChild>
      <button ...>
        <Eye className="w-4 h-4" />
      </button>
    </TooltipTrigger>
    <TooltipPortal>
      <TooltipContent
        side="right"
        align="center"
        sideOffset={14}
        collisionPadding={24}
        avoidCollisions
        className="popup-preview-tooltip"
      >
        <div className="popup-preview-tooltip__header">
          <p className="popup-preview-tooltip__title">{child.name || 'Preview'}</p>
        </div>
        <div className="popup-preview-tooltip__body">
          {tooltipBody}
        </div>
      </TooltipContent>
    </TooltipPortal>
  </Tooltip>
</TooltipProvider>
```

### Tooltip Styles (`styles/popup-overlay.css`)
```css
.popup-preview-tooltip {
  background: rgba(15, 23, 42, 0.97);
  border: 1px solid rgba(71, 85, 105, 0.65);
  border-radius: 10px;
  box-shadow: 0 24px 48px -12px rgba(15, 23, 42, 0.55);
  padding: 0;
  max-width: 360px;
  color: #e5e7eb;
  overflow: hidden;
}

.popup-preview-tooltip__body {
  padding: 10px 14px 12px;
  font-size: 12px;
  line-height: 1.45;
  max-height: 220px;
  overflow-y: auto;
  color: #cbd5f5;
  scrollbar-width: thin;
  scrollbar-color: rgba(148, 163, 184, 0.6) transparent;
}
```

With these changes in place, the tooltip preview reliably loads, renders outside the popup boundary, and scrolls for long content.
