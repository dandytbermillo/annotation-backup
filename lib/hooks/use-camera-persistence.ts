/**
 * Camera Persistence Hook
 *
 * Debounces camera state changes and persists to database
 * - Debounces updates (500ms)
 * - Filters redundant updates (<0.5px delta)
 * - Flushes on unmount
 * - Handles offline errors gracefully
 *
 * @see docs/proposal/canvas_state_persistence/implementation.md lines 89-128
 */

import { useEffect, useRef, useCallback } from 'react'
import { useCanvas } from '@/components/canvas/canvas-context'
import { debugLog } from '@/lib/utils/debug-logger'
import { canvasOfflineQueue } from '@/lib/canvas/canvas-offline-queue'
import { useCanvasWorkspace } from '@/components/canvas/canvas-workspace-context'

export interface CameraPersistenceOptions {
  /** Note ID for camera state persistence */
  noteId: string
  /** Optional user ID for per-user camera state */
  userId?: string
  /** Debounce delay in milliseconds (default: 500) */
  debounceMs?: number
  /** Minimum delta threshold to trigger persistence (default: 0.5 pixels) */
  deltaThreshold?: number
  /** Enable/disable persistence (default: true) */
  enabled?: boolean
}

interface CameraState {
  x: number
  y: number
  zoom: number
}

const DEFAULT_DEBOUNCE_MS = 500
const DEFAULT_DELTA_THRESHOLD = 0.5

/**
 * Hook to persist camera state changes to the database
 */
export function useCameraPersistence(options: CameraPersistenceOptions) {
  const {
    noteId,
    userId,
    debounceMs = DEFAULT_DEBOUNCE_MS,
    deltaThreshold = DEFAULT_DELTA_THRESHOLD,
    enabled = true
  } = options

  const { state } = useCanvas()
  const { getWorkspaceVersion } = useCanvasWorkspace()
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null)
  const lastPersistedRef = useRef<CameraState | null>(null)
  const pendingUpdateRef = useRef<CameraState | null>(null)

  /**
   * Check if camera state has changed significantly
   */
  const hasSignificantChange = useCallback((current: CameraState, last: CameraState | null): boolean => {
    if (!last) return true

    const deltaX = Math.abs(current.x - last.x)
    const deltaY = Math.abs(current.y - last.y)
    const deltaZoom = Math.abs(current.zoom - last.zoom)

    return (
      deltaX >= deltaThreshold ||
      deltaY >= deltaThreshold ||
      deltaZoom >= 0.01 // 1% zoom change threshold
    )
  }, [deltaThreshold])

  /**
   * Persist camera state to database
   */
  const persistCameraState = useCallback(async (camera: CameraState) => {
    if (!enabled) return

    const enqueueCameraUpdate = async () => {
      try {
        await canvasOfflineQueue.enqueue({
          type: 'camera_update',
          noteId,
          data: {
            camera,
            userId: userId ?? null
          },
          workspaceVersion: getWorkspaceVersion(noteId)
        })
        debugLog({
          component: 'CameraPersistence',
          action: 'queued_offline_camera_update',
          metadata: { noteId, userId: userId ?? null }
        })
      } catch (queueError) {
        debugLog({
          component: 'CameraPersistence',
          action: 'queue_enqueue_failed',
          metadata: {
            noteId,
            error: queueError instanceof Error ? queueError.message : 'Unknown error'
          }
        })
      }
    }

    try {
      const url = `/api/canvas/camera/${noteId}`
      const body = JSON.stringify({
        camera,
        userId: userId || null
      })

      const response = await fetch(url, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json'
        },
        body
      })

      if (!response.ok) {
        // Handle HTTP errors
        const error = await response.json().catch(() => ({ error: 'Unknown error' }))
        debugLog({
          component: 'CameraPersistence',
          action: 'persist_failed',
          metadata: { error, noteId, userId: userId ?? null }
        })
        if (response.status >= 500) {
          await enqueueCameraUpdate()
        }
        // Don't throw - allow offline operation
        return
      }

      // Update last persisted state
      lastPersistedRef.current = camera

      debugLog({
        component: 'CameraPersistence',
        action: 'persisted_camera_state',
        metadata: { camera, noteId, userId: userId ?? null }
      })
    } catch (error) {
      // Handle network errors gracefully (offline mode)
      debugLog({
        component: 'CameraPersistence',
        action: 'network_error',
        metadata: {
          error: error instanceof Error ? error.message : 'Unknown error',
          noteId,
          userId: userId ?? null
        }
      })
      await enqueueCameraUpdate()
    }
  }, [noteId, userId, enabled, getWorkspaceVersion])

  /**
   * Flush pending camera updates immediately
   */
  const flush = useCallback(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current)
      debounceTimerRef.current = null
    }

    if (pendingUpdateRef.current) {
      const pending = pendingUpdateRef.current
      pendingUpdateRef.current = null
      persistCameraState(pending)
    }
  }, [persistCameraState])

  /**
   * Schedule a debounced camera state update
   */
  const scheduleUpdate = useCallback((camera: CameraState) => {
    if (!enabled) return

    // Check if change is significant
    if (!hasSignificantChange(camera, lastPersistedRef.current)) {
      debugLog({
        component: 'CameraPersistence',
        action: 'skip_insignificant_change',
        metadata: { camera, threshold: deltaThreshold }
      })
      return
    }

    // Store pending update
    pendingUpdateRef.current = camera

    // Clear existing timer
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current)
    }

    // Schedule new timer
    debounceTimerRef.current = setTimeout(() => {
      flush()
    }, debounceMs)
  }, [enabled, hasSignificantChange, debounceMs, flush])

  /**
   * Watch canvas state changes and schedule persistence
   */
  useEffect(() => {
    if (!enabled || !state.canvasState) return

    const camera: CameraState = {
      x: state.canvasState.translateX || 0,
      y: state.canvasState.translateY || 0,
      zoom: state.canvasState.zoom || 1.0
    }

    scheduleUpdate(camera)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    enabled,
    state.canvasState?.translateX,
    state.canvasState?.translateY,
    state.canvasState?.zoom
    // scheduleUpdate intentionally omitted to prevent infinite loops
  ])

  /**
   * Flush on unmount
   */
  useEffect(() => {
    return () => {
      // Flush pending updates synchronously on unmount
      if (pendingUpdateRef.current) {
        // Use navigator.sendBeacon for reliable unmount persistence
        const camera = pendingUpdateRef.current
        const url = `/api/canvas/camera/${noteId}`
        const body = JSON.stringify({
          camera,
          userId: userId || null
        })

        // Try sendBeacon first (more reliable)
        const beaconSuccess = navigator.sendBeacon?.(url, new Blob([body], { type: 'application/json' }))

        if (!beaconSuccess) {
          // Fallback to synchronous fetch
          fetch(url, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body,
            keepalive: true
          }).catch(err => {
            debugLog({
              component: 'CameraPersistence',
              action: 'unmount_flush_failed',
              metadata: {
                error: err instanceof Error ? err.message : 'Unknown error',
                noteId
              }
            })
          })
        }
      }

      // Clear timer
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current)
      }
    }
  }, [noteId, userId])

  return {
    flush,
    lastPersisted: lastPersistedRef.current
  }
}
