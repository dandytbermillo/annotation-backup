"use client"

import { useRef, useCallback, useEffect } from 'react'
import { debugLog } from '@/lib/utils/debug-logger'

interface ThrottledStateOptions<T> {
  /** State to track */
  state: T
  /** Throttle interval in ms (default: 2000ms) */
  throttleMs?: number
  /** Keys that trigger immediate update (no throttle) */
  immediateKeys?: (keyof T)[]
  /** Callback when throttled state should be persisted */
  onPersist: (state: T) => void
  /** Component ID for debug logging */
  componentId?: string
}

/**
 * Hook that throttles state persistence to avoid excessive updates.
 *
 * Use case: Timer component ticks every second, but we don't want to
 * persist metadata 60 times per minute. This hook throttles updates
 * to every 2 seconds by default, while allowing immediate updates
 * for significant changes (e.g., isRunning toggled).
 *
 * Features:
 * - Throttled updates for continuous changes (e.g., seconds ticking)
 * - Immediate updates for significant changes via immediateKeys
 * - Guaranteed persist on unmount (workspace switch/eviction)
 * - Uses refs to avoid stale closure issues
 *
 * @example
 * ```tsx
 * useThrottledComponentState({
 *   state: { minutes, seconds, isRunning },
 *   throttleMs: 2000,
 *   immediateKeys: ['isRunning'], // Immediate update when timer starts/stops
 *   onPersist: (state) => onStateUpdate?.(state),
 *   componentId,
 * })
 * ```
 */
export function useThrottledComponentState<T extends Record<string, unknown>>({
  state,
  throttleMs = 2000,
  immediateKeys = [],
  onPersist,
  componentId,
}: ThrottledStateOptions<T>): void {
  const lastPersistedRef = useRef<T>(state)
  const lastPersistTimeRef = useRef<number>(0)
  const pendingRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Track latest state for unmount cleanup (avoids stale closure)
  const latestStateRef = useRef<T>(state)
  useEffect(() => {
    latestStateRef.current = state
  }, [state])

  // Track latest onPersist callback (avoids stale closure)
  const onPersistRef = useRef(onPersist)
  useEffect(() => {
    onPersistRef.current = onPersist
  }, [onPersist])

  // Persist function that updates refs and calls callback
  const persist = useCallback((newState: T, reason: 'immediate' | 'throttled' | 'unmount') => {
    lastPersistedRef.current = newState
    lastPersistTimeRef.current = Date.now()
    onPersistRef.current(newState)

    void debugLog({
      component: 'ThrottledState',
      action: reason === 'immediate'
        ? 'component_state_immediate_persist'
        : reason === 'unmount'
        ? 'component_state_unmount_persist'
        : 'component_state_throttled_persist',
      metadata: {
        componentId,
        reason,
        state: newState,
      },
    })
  }, [componentId])

  // Main effect that handles throttled/immediate updates
  useEffect(() => {
    const now = Date.now()
    const timeSinceLastPersist = now - lastPersistTimeRef.current

    // Check for immediate keys (significant changes)
    const hasImmediateChange = immediateKeys.some(
      key => state[key] !== lastPersistedRef.current[key]
    )

    if (hasImmediateChange) {
      // Clear any pending throttled update
      if (pendingRef.current) {
        clearTimeout(pendingRef.current)
        pendingRef.current = null
      }
      persist(state, 'immediate')
      return
    }

    // Check if state actually changed
    const hasChange = Object.keys(state).some(
      key => state[key as keyof T] !== lastPersistedRef.current[key as keyof T]
    )

    if (!hasChange) {
      return // No change, nothing to persist
    }

    // Throttle continuous changes
    if (timeSinceLastPersist >= throttleMs) {
      persist(state, 'throttled')
    } else if (!pendingRef.current) {
      // Schedule a throttled update
      const delay = throttleMs - timeSinceLastPersist
      pendingRef.current = setTimeout(() => {
        pendingRef.current = null
        persist(latestStateRef.current, 'throttled')
      }, delay)
    }

    return () => {
      if (pendingRef.current) {
        clearTimeout(pendingRef.current)
        pendingRef.current = null
      }
    }
  }, [state, throttleMs, immediateKeys, persist])

  // Persist on unmount (workspace switch/eviction) - guaranteed final save
  useEffect(() => {
    return () => {
      // Clear any pending throttled update
      if (pendingRef.current) {
        clearTimeout(pendingRef.current)
        pendingRef.current = null
      }

      // Final persist with latest state (using refs to avoid stale closure)
      // Only persist if state changed since last persist
      const latest = latestStateRef.current
      const lastPersisted = lastPersistedRef.current

      const hasUnpersistedChange = Object.keys(latest).some(
        key => latest[key as keyof T] !== lastPersisted[key as keyof T]
      )

      if (hasUnpersistedChange) {
        onPersistRef.current(latest)

        void debugLog({
          component: 'ThrottledState',
          action: 'component_state_unmount_persist',
          metadata: {
            componentId,
            state: latest,
          },
        })
      }
    }
  }, [componentId]) // Empty deps would work, but componentId helps with logging
}
