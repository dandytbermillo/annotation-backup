/**
 * useAnnotationTypes Hook
 *
 * React hook for accessing annotation types with SSR support and cross-tab sync.
 *
 * @module lib/hooks/use-annotation-types
 */

'use client';

import { useEffect, useRef, useState } from 'react';
import { subscribeToAnnotationTypeUpdates } from '@/lib/services/annotation-types-client';
import type { AnnotationTypeConfig } from '@/lib/models/annotation-type-registry';

/**
 * Hook to access annotation types with real-time updates.
 *
 * Hydrates from server-provided initial state, then fetches fresh data
 * and subscribes to cross-tab updates via BroadcastChannel.
 *
 * @param initial - Server-provided initial annotation types for SSR/hydration
 * @returns Current annotation types array
 *
 * @example
 * ```typescript
 * // In a Server Component:
 * import { ensureAnnotationTypesReady, getAnnotationTypeRegistry } from '@/lib/bootstrap/annotation-types';
 *
 * async function MyServerComponent() {
 *   await ensureAnnotationTypesReady();
 *   const registry = getAnnotationTypeRegistry();
 *   const initialTypes = registry.getAll();
 *
 *   return <MyClientComponent initialTypes={initialTypes} />;
 * }
 *
 * // In the Client Component:
 * 'use client';
 * import { useAnnotationTypes } from '@/lib/hooks/use-annotation-types';
 *
 * function MyClientComponent({ initialTypes }) {
 *   const types = useAnnotationTypes(initialTypes);
 *
 *   return (
 *     <div>
 *       {types.map(type => (
 *         <div key={type.id} style={{ color: type.color }}>
 *           {type.icon} {type.label}
 *         </div>
 *       ))}
 *     </div>
 *   );
 * }
 * ```
 */
export function useAnnotationTypes(initial: AnnotationTypeConfig[]): AnnotationTypeConfig[] {
  const [types, setTypes] = useState<AnnotationTypeConfig[]>(initial);
  const isMountedRef = useRef<boolean>(true);

  // Sync state when server-provided initial changes (e.g., navigation)
  useEffect(() => {
    setTypes(initial);
  }, [initial]);

  // Fetch on mount and subscribe to updates
  useEffect(() => {
    isMountedRef.current = true;

    // Fetch function with abort signal support
    async function refresh(signal?: AbortSignal) {
      try {
        const res = await fetch('/api/annotation-types', {
          method: 'GET',
          cache: 'no-store', // Always fetch fresh data
          signal,
        });

        if (!res.ok) {
          throw new Error(`Failed to fetch annotation types: ${res.status} ${res.statusText}`);
        }

        const data: AnnotationTypeConfig[] = await res.json();

        // Only update state if component still mounted
        if (isMountedRef.current) {
          setTypes(data);
        }
      } catch (error) {
        // Ignore abort errors (expected on unmount)
        if (error instanceof DOMException && error.name === 'AbortError') {
          return;
        }

        console.error('[useAnnotationTypes] Failed to refresh types:', error);
        // Don't throw - gracefully degrade to initial/stale data
      }
    }

    // Create abort controller for cleanup
    const abortController = new AbortController();

    // Initial fetch on mount
    refresh(abortController.signal);

    // Subscribe to cross-tab updates
    const unsubscribe = subscribeToAnnotationTypeUpdates(() => {
      // Callback is sync - fetch happens fire-and-forget
      refresh(abortController.signal);
    });

    // Cleanup function
    return () => {
      isMountedRef.current = false;
      abortController.abort(); // Cancel any in-flight requests
      unsubscribe(); // Stop listening to broadcasts
    };
  }, []); // Empty deps - only run once on mount

  return types;
}
