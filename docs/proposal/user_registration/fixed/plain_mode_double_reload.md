# Plain Mode Double-Reload Fix

## Summary
Single-tab plain-mode autosave appeared to require two reloads before freshly edited text showed up. Investigation revealed that edits were saved correctly to Postgres, but the first reload was served from the service worker's stale cache. The stale-while-revalidate strategy returned the previous document version while updating the cache asynchronously, so the editor displayed the older content until a second reload.

## Root Cause
- `public/service-worker.js` cached `/api/postgres-offline/documents/**` responses using stale-while-revalidate.
- On first reload the service worker returned the cached document (previous version) before the network fetch completed.
- The network fetch wrote the new version to the cache after the response was already delivered, meaning the fresh data only appeared on the next reload.

## Fix
- Updated the service worker to bypass the cache for document GETs, forcing a network-first strategy for `/api/postgres-offline/documents/**`.
- Bumped `CACHE_VERSION` so existing clients discard the stale cache and install the new service worker immediately.

## Code Changes
- **`public/service-worker.js`**
  - Changed `CACHE_VERSION` from `'v1'` to `'v2'`.
  - Modified the fetch handler to call `fetch(request)` directly for document endpoints instead of returning the cached response.

```diff
-const CACHE_VERSION = 'v1';
+const CACHE_VERSION = 'v2';
...
-  if (request.method === 'GET' && shouldCache(url.pathname)) {
-    event.respondWith(handleCachedRequest(request));
-  }
+  if (request.method === 'GET' && shouldCache(url.pathname)) {
+    if (url.pathname.includes('/documents/')) {
+      // Network-first to avoid stale editor content on reload
+      event.respondWith(fetch(request));
+    } else {
+      event.respondWith(handleCachedRequest(request));
+    }
+  }
```

## Verification
1. Restarted the dev server and unregistered the old service worker.
2. Edited a note in plain mode; confirmed autosave wrote the new text to Postgres (`document_saves.version = 13`, content `"sample test extended final"`).
3. Reloaded once. Network panel showed the first GET returning the updated JSON; `debug_logs` recorded:
   - `CONTENT_LOADED` with the new text,
   - `FALLBACK_DISCARD_PENDING` (provider version newer than any snapshot),
   - `CONTENT_SET_IN_EDITOR` applying the updated content on the first reload.
4. No second reload required—UI immediately reflected the latest edit.

## Supporting Artifacts
- **Database**: `debug_logs` rows for session `session-1758341177778-xmv6d2zs0` and `document_saves` entries for note `c816bcc3-8a22-4f6e-8588-5cedeb746b93` (versions 11–13).
- **Network Evidence**: Chrome DevTools network trace showing `/api/postgres-offline/documents/...` returning the new content on the first reload.

## Follow Up
- Monitor for any regressions after service worker redeploys (clients must pick up the new version `v2`).
- Consider adding an automated Playwright test for plain-mode reload behavior once the UI is stable.
