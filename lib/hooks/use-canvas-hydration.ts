/**
 * Canvas Hydration Hook
 *
 * Loads persisted canvas state on mount:
 * - Panel positions and dimensions (world-space -> screen-space conversion)
 * - Camera state (translation and zoom)
 * - Applies to stores (dataStore, branchesMap, LayerManager)
 * - Initializes canvas context with restored camera
 *
 * Features (CRITICAL_REVIEW fixes):
 * - AbortController for race condition prevention
 * - 10s timeout on all fetch operations
 * - Data validation (NaN, Infinity, negative values)
 * - localStorage cache fallback with 7-day retention
 *
 * @see docs/proposal/canvas_state_persistence/implementation.md lines 50-87
 * @see docs/proposal/canvas_state_persistence/CRITICAL_REVIEW.md Issues 2-6
 */

import { useEffect, useState, useCallback, useRef } from 'react'
import { useCanvas } from '@/components/canvas/canvas-context'
import { DataStore } from '@/lib/data-store'
import { LayerManager } from '@/lib/canvas/layer-manager'
import { canvasOfflineQueue } from '@/lib/canvas/canvas-offline-queue'
import { debugLog } from '@/lib/utils/debug-logger'
import { makePanelKey } from '@/lib/canvas/composite-id'
import { loadStateFromStorage } from '@/lib/canvas/canvas-storage'

// Constants
const HYDRATION_TIMEOUT_MS = 10000 // 10 seconds
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000 // 7 days
const CACHE_KEY_PREFIX = 'canvas_hydration_cache_'

// Validation utilities
function isValidNumber(value: any): boolean {
  return typeof value === 'number' && !Number.isNaN(value) && Number.isFinite(value)
}

function isValidPositiveNumber(value: any): boolean {
  return isValidNumber(value) && value >= 0
}

function validateCameraState(camera: any): camera is { x: number; y: number; zoom: number } {
  return (
    camera &&
    typeof camera === 'object' &&
    isValidNumber(camera.x) &&
    isValidNumber(camera.y) &&
    isValidPositiveNumber(camera.zoom) &&
    camera.zoom > 0
  )
}

function validatePanelData(panel: any): boolean {
  return (
    panel &&
    typeof panel === 'object' &&
    typeof panel.id === 'string' &&
    panel.position &&
    isValidNumber(panel.position.x) &&
    isValidNumber(panel.position.y) &&
    panel.size &&
    isValidPositiveNumber(panel.size.width) &&
    isValidPositiveNumber(panel.size.height) &&
    isValidNumber(panel.zIndex)
  )
}

// Cache utilities
function getCacheKey(noteId: string, type: 'camera' | 'panels'): string {
  return `${CACHE_KEY_PREFIX}${noteId}_${type}`
}

function saveToCacheWithExpiry(key: string, data: any): void {
  try {
    const cacheItem = {
      data,
      timestamp: Date.now()
    }
    localStorage.setItem(key, JSON.stringify(cacheItem))
  } catch (error) {
    debugLog({
      component: 'CanvasHydration',
      action: 'cache_save_failed',
      metadata: { error: error instanceof Error ? error.message : String(error) }
    })
  }
}

function loadFromCacheWithExpiry(key: string): any | null {
  try {
    const cached = localStorage.getItem(key)
    if (!cached) return null

    const cacheItem = JSON.parse(cached)
    const age = Date.now() - cacheItem.timestamp

    if (age > CACHE_TTL_MS) {
      // Expired, remove it
      localStorage.removeItem(key)
      return null
    }

    debugLog({
      component: 'CanvasHydration',
      action: 'loaded_from_cache',
      metadata: { ageSeconds: Math.round(age / 1000) }
    })
    return cacheItem.data
  } catch (error) {
    debugLog({
      component: 'CanvasHydration',
      action: 'cache_load_failed',
      metadata: { error: error instanceof Error ? error.message : String(error) }
    })
    return null
  }
}

// Fetch with timeout and abort
async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    })
    clearTimeout(timeoutId)
    return response
  } catch (error) {
    clearTimeout(timeoutId)
    throw error
  }
}

// Module-level Map to track hydration per session
// Key: noteId, Value: timestamp of last hydration
// This prevents duplicate hydration if component remounts within same session
// but allows re-hydration on page refresh (new session)
const hydrationSessions = new Map<string, number>()
const HYDRATION_COOLDOWN_MS = 5000 // 5 seconds cooldown between hydrations

export interface HydrationOptions {
  /** Note ID to load state for */
  noteId: string
  /** Optional user ID for per-user camera state */
  userId?: string
  /** Data store instance */
  dataStore?: DataStore
  /** Branches map */
  branchesMap?: Map<string, any>
  /** Layer manager instance */
  layerManager?: LayerManager
  /** Enable/disable hydration (default: true) */
  enabled?: boolean
}

export interface HydrationStatus {
  /** Whether hydration is in progress */
  loading: boolean
  /** Hydration error if any */
  error: Error | null
  /** Whether hydration succeeded */
  success: boolean
  /** Number of panels loaded */
  panelsLoaded: number
  /** Whether camera state was loaded */
  cameraLoaded: boolean
  /** Loaded panels data (for creating CanvasItems) */
  panels: Array<{
    id: string
    noteId: string
    storeKey?: string // Composite key for multi-note canvas
    type: string
    position: { x: number; y: number }
    size: { width: number; height: number }
    zIndex: number
    state?: string // Panel lifecycle state (e.g., 'active', 'closed')
    revisionToken?: string // Revision token for conflict detection
    updatedAt?: string // Last update timestamp
    title?: string
    metadata?: Record<string, any>
  }>
}

/**
 * Hook to hydrate canvas state from persisted data
 */
export function useCanvasHydration(options: HydrationOptions) {
  const {
    noteId,
    userId,
    dataStore,
    branchesMap,
    layerManager,
    enabled = true
  } = options

  const { state, dispatch } = useCanvas()
  const [status, setStatus] = useState<HydrationStatus>({
    loading: false,
    error: null,
    success: false,
    panelsLoaded: 0,
    cameraLoaded: false,
    panels: []
  })

  /**
   * Load camera state from API with timeout, validation, and cache fallback
   */
  const loadCameraState = useCallback(async (signal?: AbortSignal): Promise<{
    camera: { x: number; y: number; zoom: number }
    updatedAt: string | null
    exists: boolean
  } | null> => {
    try {
      const url = userId
        ? `/api/canvas/camera/${noteId}?userId=${userId}`
        : `/api/canvas/camera/${noteId}`

      const response = await fetchWithTimeout(
        url,
        { signal },
        HYDRATION_TIMEOUT_MS
      )

      if (!response.ok) {
        throw new Error(`Failed to load camera state: ${response.statusText}`)
      }

      const result = await response.json()

      if (result.success && result.exists && result.camera) {
        // Validate camera data
        if (!validateCameraState(result.camera)) {
          debugLog({
            component: 'CanvasHydration',
            action: 'invalid_camera_data',
            metadata: { camera: result.camera }
          })
          throw new Error('Invalid camera data')
        }

        debugLog({
          component: 'CanvasHydration',
          action: 'loaded_camera_state',
          metadata: { camera: result.camera }
        })

        // Cache successful result (camera data only, not metadata)
        saveToCacheWithExpiry(getCacheKey(noteId, 'camera'), result.camera)

        return {
          camera: result.camera,
          updatedAt: result.updatedAt || null,
          exists: result.exists
        }
      }

      // No saved camera state, use defaults
      debugLog({
        component: 'CanvasHydration',
        action: 'no_saved_camera',
        metadata: { noteId }
      })
      return {
        camera: { x: 0, y: 0, zoom: 1.0 },
        updatedAt: null,
        exists: false
      }
    } catch (error) {
      debugLog({
        component: 'CanvasHydration',
        action: 'camera_load_failed',
        metadata: { error: error instanceof Error ? error.message : String(error) }
      })

      // Try cache fallback on timeout or network errors
      if (error instanceof Error && (error.name === 'AbortError' || error.message.includes('fetch'))) {
        debugLog({
          component: 'CanvasHydration',
          action: 'attempting_camera_cache_fallback',
          metadata: {}
        })
        const cached = loadFromCacheWithExpiry(getCacheKey(noteId, 'camera'))
        if (cached && validateCameraState(cached)) {
          debugLog({
            component: 'CanvasHydration',
            action: 'using_cached_camera',
            metadata: { camera: cached }
          })
          return {
            camera: cached,
            updatedAt: null, // Cache doesn't store timestamp
            exists: true
          }
        }
      }

      // Don't fail hydration if camera load fails
      return {
        camera: { x: 0, y: 0, zoom: 1.0 },
        updatedAt: null,
        exists: false
      }
    }
  }, [noteId, userId])

  /**
   * Load panel layout from API with timeout, validation, and cache fallback
   */
  const loadPanelLayout = useCallback(async (signal?: AbortSignal): Promise<Array<{
    id: string
    noteId: string
    type: string
    position: { x: number; y: number }
    size: { width: number; height: number }
    zIndex: number
    state: string
    revisionToken: string
    updatedAt: string
    title?: string
    metadata?: Record<string, any>
  }>> => {
    try {
      const response = await fetchWithTimeout(
        `/api/canvas/layout/${noteId}`,
        { signal },
        HYDRATION_TIMEOUT_MS
      )

      if (!response.ok) {
        throw new Error(`Failed to load panel layout: ${response.statusText}`)
      }

      const result = await response.json()

      if (result.success && result.panels) {
        // Validate all panel data
        const validPanels = result.panels.filter((panel: any) => {
          const isValid = validatePanelData(panel)
          if (!isValid) {
            debugLog({
              component: 'CanvasHydration',
              action: 'invalid_panel_data',
              metadata: { panel }
            })
          }
          return isValid
        })

        if (validPanels.length < result.panels.length) {
          debugLog({
            component: 'CanvasHydration',
            action: 'filtered_invalid_panels',
            metadata: { filteredCount: result.panels.length - validPanels.length }
          })
        }

        debugLog({
          component: 'CanvasHydration',
          action: 'loaded_panels',
          metadata: { count: validPanels.length }
        })

        // Cache successful result
        saveToCacheWithExpiry(getCacheKey(noteId, 'panels'), validPanels)

        return validPanels
      }

      debugLog({
        component: 'CanvasHydration',
        action: 'no_panels_found',
        metadata: { noteId }
      })
      return []
    } catch (error) {
      debugLog({
        component: 'CanvasHydration',
        action: 'panel_load_failed',
        metadata: { error: error instanceof Error ? error.message : String(error) }
      })

      // Try cache fallback on timeout or network errors
      if (error instanceof Error && (error.name === 'AbortError' || error.message.includes('fetch'))) {
        debugLog({
          component: 'CanvasHydration',
          action: 'attempting_panels_cache_fallback',
          metadata: {}
        })
        const cached = loadFromCacheWithExpiry(getCacheKey(noteId, 'panels'))
        if (cached && Array.isArray(cached)) {
          const validCached = cached.filter(validatePanelData)
          if (validCached.length > 0) {
            debugLog({
              component: 'CanvasHydration',
              action: 'using_cached_panels',
              metadata: { count: validCached.length }
            })
            return validCached
          }
        }
      }

      throw error
    }
  }, [noteId])

  /**
   * Apply camera state to canvas context
   */
  const applyCameraState = useCallback((camera: { x: number; y: number; zoom: number }) => {
    dispatch({
      type: 'SET_CANVAS_STATE',
      payload: {
        ...state.canvasState,
        translateX: camera.x,
        translateY: camera.y,
        zoom: camera.zoom
      }
    })

    debugLog({
      component: 'CanvasHydration',
      action: 'applied_camera_state',
      metadata: { camera }
    })
  }, [dispatch, state.canvasState])

  /**
   * Apply panel layout to stores
   */
  const applyPanelLayout = useCallback((panels: Array<any>, camera: { x: number; y: number }, zoom: number) => {
    let appliedCount = 0

    for (const panel of panels) {
      try {
        // Generate composite key for multi-note canvas support
        const storeKey = makePanelKey(panel.noteId, panel.id)

        // Use annotation type from metadata for UI rendering (header colors, etc.)
        // Falls back to 'note' if no annotation type is stored
        const annotationType = panel.metadata?.annotationType || 'note'

        debugLog({
          component: 'CanvasHydration',
          action: 'applying_panel_type',
          metadata: {
            panelId: panel.id,
            storeKey,
            dbType: panel.type,
            annotationType,
            hasMetadata: !!panel.metadata
          }
        })

        // CRITICAL: Stores must hold WORLD-SPACE coordinates per implementation plan
        // Components will convert world→screen during rendering
        const parentId =
          panel.parentId ??
          panel.metadata?.parentId ??
          panel.metadata?.parent_id ??
          panel.metadata?.parentPanelId ??
          null

        const panelData: Record<string, any> = {
          id: panel.id,
          noteId: panel.noteId,
          storeKey, // Add composite key for store operations
          type: annotationType, // Use UI annotation type for rendering (note/explore/promote/main)
          dbType: panel.type, // Keep database type for reference (editor/branch/context/etc.)
          position: panel.position, // WORLD-SPACE coordinates (from database)
          worldPosition: panel.position, // EXPLICIT world-space for branch loader detection
          size: panel.size, // WORLD-SPACE dimensions
          dimensions: panel.size, // Alias for backward compatibility
          zIndex: panel.zIndex,
          state: panel.state,
          revisionToken: panel.revisionToken,
          title: panel.title,
          metadata: panel.metadata
        }

        if (parentId) {
          panelData.parentId = parentId
          panelData.metadata = {
            ...(panelData.metadata || {}),
            parentId,
            parentPanelId: parentId
          }
        }

        debugLog({
          component: 'CanvasHydration',
          action: 'storing_panel_data',
          metadata: {
            panelId: panel.id,
            storeKey,
            worldPosition: panel.position, // Stored in dataStore (world-space)
            cameraUsed: camera,
            zoom
          }
        })

        // Update DataStore using composite key (preserve existing fields like parentId injected by branch loader)
        if (dataStore) {
          const existing = dataStore.get(storeKey)
          dataStore.set(storeKey, existing ? { ...existing, ...panelData } : panelData)
        }

        // Update branchesMap using composite key (same merge semantics as dataStore for consistency)
        if (branchesMap) {
          const existing = branchesMap.get(storeKey)
          branchesMap.set(storeKey, existing ? { ...existing, ...panelData } : panelData)
        }

        // Update LayerManager using composite key
        if (layerManager) {
          const existing = layerManager.getNode(storeKey)
          layerManager.updateNode(storeKey, existing ? { ...existing, ...panelData } : panelData)
        }

        appliedCount++
      } catch (error) {
        debugLog({
          component: 'CanvasHydration',
          action: 'panel_apply_failed',
          metadata: { panelId: panel.id, error: error instanceof Error ? error.message : String(error) }
        })
      }
    }

    debugLog({
      component: 'CanvasHydration',
      action: 'applied_panels_to_stores',
      metadata: { count: appliedCount }
    })
    return appliedCount
  }, [dataStore, branchesMap, layerManager])

  /**
   * Perform full hydration with abort controller
   */
  const hydrate = useCallback(async (signal?: AbortSignal) => {
    if (!enabled) {
      debugLog({
        component: 'CanvasHydration',
        action: 'hydration_disabled',
        metadata: { reason: 'enabled flag is false' }
      })
      return
    }

    setStatus({
      loading: true,
      error: null,
      success: false,
      panelsLoaded: 0,
      cameraLoaded: false,
      panels: []
    })

    try {
      // Load camera state first (needed for coordinate conversion)
      const cameraResult = await loadCameraState(signal)

      const cameraLoaded = cameraResult !== null && cameraResult.exists

      // Check if local snapshot exists and is newer than server camera
      const localSnapshot = loadStateFromStorage(noteId)
      let shouldApplyServerCamera = false

      if (cameraResult && cameraResult.exists && cameraResult.updatedAt) {
        // Server has camera data
        if (localSnapshot && localSnapshot.savedAt) {
          // Local snapshot also exists - compare timestamps
          const serverTime = new Date(cameraResult.updatedAt).getTime()
          const localTime = localSnapshot.savedAt

          if (serverTime > localTime) {
            // Server camera is newer - use it
            shouldApplyServerCamera = true
            debugLog({
              component: 'CanvasHydration',
              action: 'preferring_server_camera_newer',
              metadata: {
                serverTime: new Date(serverTime).toISOString(),
                localTime: new Date(localTime).toISOString(),
                diff: serverTime - localTime
              }
            })
          } else {
            // Local snapshot is newer or same age - skip server camera
            debugLog({
              component: 'CanvasHydration',
              action: 'skip_server_camera_snapshot_newer',
              metadata: {
                serverTime: new Date(serverTime).toISOString(),
                localTime: new Date(localTime).toISOString(),
                diff: localTime - serverTime,
                reason: 'local_snapshot_is_newer_or_equal'
              }
            })
          }
        } else {
          // No local snapshot - use server camera
          shouldApplyServerCamera = true
          debugLog({
            component: 'CanvasHydration',
            action: 'using_server_camera_no_snapshot',
            metadata: { reason: 'no_local_snapshot_found' }
          })
        }
      } else if (localSnapshot) {
        // No server camera but local snapshot exists
        debugLog({
          component: 'CanvasHydration',
          action: 'skip_server_camera_not_exists',
          metadata: { reason: 'server_camera_does_not_exist' }
        })
      }

      // Use loaded camera or default canvas translation
      // CRITICAL: When no camera state is saved, use the canvas's default translation
      // offsets (-1000, -1200) instead of (0, 0). Otherwise world→screen conversion
      // will be wrong and panels will appear at incorrect positions.
      const effectiveCamera = cameraLoaded && cameraResult
        ? cameraResult.camera
        : {
            x: state.canvasState?.translateX || -1000,
            y: state.canvasState?.translateY || -1200,
            zoom: state.canvasState?.zoom || 1.0
          }

      debugLog({
        component: 'CanvasHydration',
        action: 'using_effective_camera',
        metadata: {
          cameraLoaded,
          effectiveCamera,
          reason: cameraLoaded ? 'loaded_from_db' : 'using_default_canvas_translation'
        }
      })

      // Apply camera to canvas context only if server camera is newer than local snapshot
      if (cameraResult && shouldApplyServerCamera) {
        applyCameraState(cameraResult.camera)
      }

      // Load panel layout (don't check abort until after both camera and panels are loaded)
      const panels = await loadPanelLayout(signal)

      // Check if aborted AFTER loading both camera and panels
      // This ensures panels get loaded even if component remounts quickly
      if (signal?.aborted) {
        debugLog({
          component: 'CanvasHydration',
          action: 'hydration_aborted_after_load',
          metadata: { stage: 'after_both_loaded', cameraLoaded, panelsLoaded: panels.length }
        })
        // Continue anyway - data is already loaded, just apply it
      }

      // Apply panels to stores with coordinate conversion
      const panelsLoaded = applyPanelLayout(panels, effectiveCamera, effectiveCamera.zoom)

      // Initialize offline queue
      await canvasOfflineQueue.init()

      // Get panels from dataStore using composite keys (with world-space positions per implementation plan)
      const storedPanels = panels.map(panel => {
        const storeKey = makePanelKey(panel.noteId, panel.id)
        const storedPanel = dataStore?.get(storeKey)
        return {
          id: panel.id,
          noteId: panel.noteId,
          storeKey, // Include composite key for consumers
          type: panel.type,
          position: storedPanel?.position || panel.position, // World-space position
          size: storedPanel?.size || panel.size, // World-space size
          zIndex: panel.zIndex,
          state: panel.state,
          revisionToken: panel.revisionToken,
          updatedAt: panel.updatedAt,
          title: panel.title,
          metadata: panel.metadata
        }
      })

      setStatus({
        loading: false,
        error: null,
        success: true,
        panelsLoaded,
        cameraLoaded,
        panels: storedPanels // Return panels with world-space positions per implementation plan
      })

      debugLog({
        component: 'CanvasHydration',
        action: 'hydration_complete',
        metadata: { panelsLoaded, cameraLoaded }
      })
    } catch (error) {
      // Don't set error state if aborted (expected behavior)
      if (error instanceof Error && error.name === 'AbortError') {
        debugLog({
          component: 'CanvasHydration',
          action: 'hydration_aborted',
          metadata: { stage: 'caught_abort_error' }
        })
        return
      }

      const errorObj = error instanceof Error ? error : new Error('Unknown hydration error')
      debugLog({
        component: 'CanvasHydration',
        action: 'hydration_failed',
        metadata: { error: errorObj.message, stack: errorObj.stack }
      })

      setStatus({
        loading: false,
        error: errorObj,
        success: false,
        panelsLoaded: 0,
        cameraLoaded: false,
        panels: []
      })
    }
  }, [
    enabled,
    loadCameraState,
    loadPanelLayout,
    applyCameraState,
    applyPanelLayout
  ])

  /**
   * Hydrate on mount with AbortController for race condition prevention
   */
  useEffect(() => {
    if (!enabled || !noteId) {
      return
    }

    // Check if recently hydrated (within cooldown period)
    const lastHydration = hydrationSessions.get(noteId)
    const now = Date.now()

    if (lastHydration && (now - lastHydration) < HYDRATION_COOLDOWN_MS) {
      debugLog({
        component: 'CanvasHydration',
        action: 'skip_recent_hydration',
        metadata: { noteId, secondsAgo: Math.round((now - lastHydration) / 1000) }
      })
      return
    }

    // Mark hydration timestamp
    hydrationSessions.set(noteId, now)
    debugLog({
      component: 'CanvasHydration',
      action: 'starting_hydration',
      metadata: { noteId }
    })

    const controller = new AbortController()

    // Start hydration with abort signal
    hydrate(controller.signal)

    // Cleanup: abort on unmount or noteId change
    return () => {
      controller.abort()
      debugLog({
        component: 'CanvasHydration',
        action: 'hydration_cleanup',
        metadata: { reason: 'unmount or noteId changed' }
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, noteId, userId]) // hydrate intentionally omitted to prevent infinite loops; userId ensures scope-aware refresh

  /**
   * Manual re-hydration function (useful for refresh)
   */
  const refetch = useCallback(() => {
    // Clear cooldown for this note to force re-hydration
    hydrationSessions.delete(noteId)
    // Manual refetch without abort signal (user-initiated, should not be cancelled)
    return hydrate()
  }, [hydrate, noteId])

  return {
    ...status,
    refetch
  }
}
