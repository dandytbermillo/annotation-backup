/**
 * Annotation Types Client Service
 *
 * Client-side helper for cross-tab synchronization using BroadcastChannel.
 * Safe for SSR - only runs in browser environment.
 *
 * @module lib/services/annotation-types-client
 */

'use client';

/**
 * Channel name for broadcasting annotation type updates
 */
const CHANNEL_NAME = 'annotation-types-updates';

/**
 * Subscribe to annotation type update notifications across browser tabs.
 *
 * Uses BroadcastChannel API to notify when annotation types change.
 * Gracefully degrades if BroadcastChannel is not supported.
 *
 * @param callback - Function to call when types are updated (MUST be sync)
 * @returns Unsubscribe function
 *
 * @example
 * ```typescript
 * const unsubscribe = subscribeToAnnotationTypeUpdates(() => {
 *   console.log('Types updated, refresh data');
 *   fetchLatestTypes();
 * });
 *
 * // Later: cleanup
 * unsubscribe();
 * ```
 */
export function subscribeToAnnotationTypeUpdates(callback: () => void): () => void {
  // SSR safety check
  if (typeof window === 'undefined') {
    console.warn('[subscribeToAnnotationTypeUpdates] Called in non-browser environment');
    return () => {}; // No-op unsubscribe
  }

  // Browser compatibility check
  if (!('BroadcastChannel' in window)) {
    console.warn('[subscribeToAnnotationTypeUpdates] BroadcastChannel not supported, updates will be local only');
    return () => {}; // Graceful degradation
  }

  try {
    const channel = new BroadcastChannel(CHANNEL_NAME);

    // Sync event handler (not async)
    const handler = (event: MessageEvent) => {
      if (event.data?.type === 'update') {
        try {
          callback();
        } catch (error) {
          console.error('[subscribeToAnnotationTypeUpdates] Callback error:', error);
        }
      }
    };

    channel.addEventListener('message', handler);

    // Return cleanup function
    return () => {
      channel.removeEventListener('message', handler);
      channel.close();
    };
  } catch (error) {
    console.error('[subscribeToAnnotationTypeUpdates] Failed to create BroadcastChannel:', error);
    return () => {}; // Return no-op on error
  }
}

/**
 * Broadcast annotation type update to all tabs
 *
 * Call this after INSERT/UPDATE/DELETE operations on annotation_types table.
 * Other tabs subscribed will refresh their data.
 *
 * @example
 * ```typescript
 * // After creating new annotation type:
 * await fetch('/api/annotation-types', { method: 'POST', body: ... });
 * notifyAnnotationTypeUpdate(); // Broadcast to other tabs
 * ```
 */
export function notifyAnnotationTypeUpdate(): void {
  // SSR safety
  if (typeof window === 'undefined') {
    return;
  }

  // Browser compatibility
  if (!('BroadcastChannel' in window)) {
    return;
  }

  try {
    const channel = new BroadcastChannel(CHANNEL_NAME);
    channel.postMessage({ type: 'update', timestamp: Date.now() });
    channel.close();
  } catch (error) {
    console.error('[notifyAnnotationTypeUpdate] Failed to broadcast:', error);
  }
}
