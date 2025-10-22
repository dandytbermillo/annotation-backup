/**
 * Panel Persistence Hook
 *
 * Provides atomic panel position/size persistence with:
 * - Coordinate conversion (screen-space -> world-space)
 * - Atomic multi-store updates via StateTransaction
 * - API persistence with offline queue fallback
 * - Conflict detection via revision tokens
 *
 * @see docs/proposal/canvas_state_persistence/implementation.md lines 130-220
 */

import { useCallback } from 'react'
import { useCanvas } from '@/components/canvas/canvas-context'
import { DataStore } from '@/lib/data-store'
import { LayerManager } from '@/lib/canvas/layer-manager'
import { StateTransactionImpl } from '@/lib/sync/state-transaction'
import { screenToWorld, sizeScreenToWorld } from '@/lib/canvas/coordinate-utils'
import { parsePanelKey } from '@/lib/canvas/composite-id'
import { canvasOfflineQueue } from '@/lib/canvas/canvas-offline-queue'
import { debugLog } from '@/lib/utils/debug-logger'
import type { CanvasItem } from '@/types/canvas-items'
import { resolvePanelDimensions, type PanelDimensions } from '@/lib/canvas/panel-metrics'
import { useCanvasWorkspace } from '@/components/canvas/canvas-workspace-context'

export interface PanelPersistOptions {
  /** Data store instance */
  dataStore: DataStore
  /** Branches map */
  branchesMap: Map<string, any>
  /** Layer manager instance */
  layerManager: LayerManager
  /** Current note ID */
  noteId: string
  /** Optional user ID for multi-user scenarios */
  userId?: string
  /** Current canvas items (used for dimension inference) */
  canvasItems?: CanvasItem[]
}

export interface PanelUpdateData {
  /** Panel ID (used for API calls) */
  panelId: string
  /** Store key (composite noteId::panelId, used for store operations). If not provided, falls back to panelId. */
  storeKey?: string
  /** Position coordinates */
  position?: { x: number; y: number }
  /** Size dimensions (optional) */
  size?: { width: number; height: number }
  /** Z-index (optional) */
  zIndex?: number
  /** Panel lifecycle state (e.g., 'active', 'closed') */
  state?: string
  /** Coordinate space of position/size. Default 'screen'. Use 'world' if coordinates are already world-space (e.g. from panel.style.left/top) */
  coordinateSpace?: 'screen' | 'world'
  /** Expected revision token for conflict detection (optional) */
  expectedRevision?: string
}

/**
 * Hook to persist panel position/size changes
 */
export function usePanelPersistence(options: PanelPersistOptions) {
  const { dataStore, branchesMap, layerManager, noteId, userId, canvasItems } = options
  const { state } = useCanvas()
  const { getWorkspaceVersion } = useCanvasWorkspace()
  const cachedCanvasItems = canvasItems

  const getPanelDimensions = useCallback(
    (panelId: string, defaultDimensions?: PanelDimensions) => {
      return resolvePanelDimensions({
        noteId,
        panelId,
        dataStore,
        canvasItems: cachedCanvasItems,
        defaultDimensions
      })
    },
    [noteId, dataStore, cachedCanvasItems]
  )

  /**
   * Persist panel update with atomic transaction and world-space coordinates
   */
  const persistPanelUpdate = useCallback(
    async (update: PanelUpdateData) => {
      const { panelId, storeKey, position, size, zIndex, state: panelState, coordinateSpace = 'screen', expectedRevision } = update

      // Use composite key for store operations, fallback to plain panelId
      const key = storeKey || panelId
      const parsedKey = storeKey ? parsePanelKey(storeKey) : null
      const effectiveNoteId = parsedKey?.noteId && parsedKey.noteId.length > 0 ? parsedKey.noteId : noteId

      // Get current panel data for revision token
      const currentData = dataStore.get(key)
      const revisionToken = expectedRevision || currentData?.revisionToken

      // Get current camera state
      const camera = {
        x: state.canvasState?.translateX || 0,
        y: state.canvasState?.translateY || 0
      }
      const zoom = state.canvasState?.zoom || 1.0

      // Convert to world-space coordinates if needed
      const worldPosition = position
        ? (coordinateSpace === 'world'
            ? position
            : screenToWorld(position, camera, zoom))
        : undefined
      const worldSize = size
        ? (coordinateSpace === 'world'
            ? size
            : (() => {
                // Convert {width, height} to {x, y} for sizeScreenToWorld
                const sizeXY = sizeScreenToWorld({ x: size.width, y: size.height }, zoom)
                return { width: sizeXY.x, height: sizeXY.y }
              })()
          )
        : undefined

      // Create transaction
      const transaction = new StateTransactionImpl(dataStore, branchesMap, layerManager)

      // Queue updates to all stores
      // CRITICAL: Keep position as screen-space and worldPosition as world-space
      const updateData: any = {}

      if (position) {
        updateData.position = position
      }
      if (worldPosition) {
        updateData.worldPosition = worldPosition
      }

      if (worldSize) {
        updateData.size = worldSize
      }

      if (zIndex !== undefined) {
        updateData.zIndex = zIndex
      }

      if (panelState !== undefined) {
        updateData.state = panelState
      }

      if (Object.keys(updateData).length === 0) {
        debugLog({
          component: 'PanelPersistence',
          action: 'noop_update_skipped',
          metadata: { panelId, noteId: effectiveNoteId }
        })
        return
      }

      // Add updates to transaction using composite key
      transaction.add('dataStore', key, updateData)
      transaction.add('branchesMap', key, updateData)
      transaction.add('layerManager', key, updateData)

      // Prepare API payload
      const apiPayload: any = {
        id: panelId,
        updatedBy: userId,
        revisionToken: revisionToken  // For conflict detection
      }

      if (worldPosition) {
        apiPayload.position = worldPosition
      }

      if (worldSize) {
        apiPayload.size = worldSize
      }

      if (zIndex !== undefined) {
        apiPayload.zIndex = zIndex
      }

      if (panelState !== undefined) {
        apiPayload.state = panelState
      }

      // Commit transaction with API persistence
      try {
        await transaction.commit(async () => {
          const response = await fetch(`/api/canvas/layout/${effectiveNoteId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              updates: [apiPayload]
            })
          })

          if (!response.ok) {
            const error = await response.json().catch(() => ({ error: 'Unknown error' }))
            throw new Error(`API persistence failed: ${error.error || response.statusText}`)
          }

          const result = await response.json()

          // Check for revision conflicts
          const resultItem = result.results?.[0]
          if (resultItem?.error === 'Revision conflict') {
            throw new Error('Revision conflict detected')
          }

          debugLog({
            component: 'PanelPersistence',
            action: 'persisted_to_api',
            metadata: { panelId, noteId: effectiveNoteId }
          })
        })
      } catch (error) {
        debugLog({
          component: 'PanelPersistence',
          action: 'persistence_failed',
          metadata: {
            error: error instanceof Error ? error.message : 'Unknown error',
            panelId,
            noteId: effectiveNoteId
          }
        })

        // Queue for offline replay
        await canvasOfflineQueue.enqueue({
          type: 'panel_update',
          noteId: effectiveNoteId,
          data: apiPayload,
          workspaceVersion: getWorkspaceVersion(effectiveNoteId)
        })

        debugLog({
          component: 'PanelPersistence',
          action: 'queued_for_offline',
          metadata: { panelId, noteId: effectiveNoteId }
        })
      }
    },
    [dataStore, branchesMap, layerManager, noteId, userId, state.canvasState, getWorkspaceVersion]
  )

  /**
   * Persist panel creation
   */
  const persistPanelCreate = useCallback(
    async (panelData: {
      panelId: string
      storeKey?: string
      type: 'editor' | 'branch' | 'context' | 'toolbar' | 'annotation'
      position: { x: number; y: number }
      size: { width: number; height: number }
      zIndex?: number
      state?: string
      title?: string
      metadata?: Record<string, any>
      coordinateSpace?: 'screen' | 'world'
    }) => {
      const { panelId, storeKey, type, position, size, zIndex = 0, state: panelState = 'active', title, metadata, coordinateSpace = 'screen' } = panelData
      const parsedKey = storeKey ? parsePanelKey(storeKey) : null
      const effectiveNoteId = parsedKey?.noteId && parsedKey.noteId.length > 0 ? parsedKey.noteId : noteId

      // Get current camera state
      const camera = {
        x: state.canvasState?.translateX || 0,
        y: state.canvasState?.translateY || 0
      }
      const zoom = state.canvasState?.zoom || 1.0

      // Convert to world-space if needed
      const worldPosition = coordinateSpace === 'world'
        ? position
        : screenToWorld(position, camera, zoom)
      const worldSize = coordinateSpace === 'world'
        ? size
        : (() => {
            const sizeXY = sizeScreenToWorld({ x: size.width, y: size.height }, zoom)
            return { width: sizeXY.x, height: sizeXY.y }
          })()

      const payload = {
        id: panelId,
        noteId: effectiveNoteId,
        type,
        position: worldPosition,
        size: worldSize,
        zIndex,
        state: panelState,
        title: title || undefined,  // Include title if provided
        metadata: metadata || undefined,  // Include metadata if provided
        updatedBy: userId
      }

      debugLog({
        component: 'PanelPersistence',
        action: 'attempting_panel_create',
        metadata: {
          panelId,
          noteId,
          type,
          title,
          screenPosition: position,
          worldPosition,
          camera,
          zoom,
          payload
        }
      })

      try {
        const response = await fetch('/api/canvas/panels', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        })

        if (!response.ok) {
          // Get error details from response
          const errorData = await response.json().catch(() => ({}))
          const errorMessage = errorData.message || errorData.error || response.statusText
          throw new Error(`Panel creation failed: ${errorMessage}`)
        }

        debugLog({
          component: 'PanelPersistence',
          action: 'panel_created',
          metadata: { panelId, noteId: effectiveNoteId, type }
        })
      } catch (error) {
        debugLog({
          component: 'PanelPersistence',
          action: 'panel_creation_failed',
          metadata: {
            error: error instanceof Error ? error.message : 'Unknown error',
            errorStack: error instanceof Error ? error.stack : undefined,
            panelId,
            noteId: effectiveNoteId
          }
        })

        // Queue for offline replay
        await canvasOfflineQueue.enqueue({
          type: 'panel_create',
          noteId: effectiveNoteId,
          data: {
            id: panelId,
            noteId: effectiveNoteId,
            type,
            position: worldPosition,
            size: worldSize,
            zIndex,
            state: panelState,
            updatedBy: userId
          },
          workspaceVersion: getWorkspaceVersion(effectiveNoteId)
        })

        debugLog({
          component: 'PanelPersistence',
          action: 'panel_creation_queued',
          metadata: { panelId, noteId: effectiveNoteId }
        })
      }
    },
    [noteId, userId, state.canvasState, getWorkspaceVersion]
  )

  /**
   * Persist panel deletion
   * Note: storeKey parameter is accepted for API consistency but not currently used
   * as deletion only requires the backend panel ID
   */
  const persistPanelDelete = useCallback(
    async (panelId: string, storeKey?: string) => {
      const parsedKey = storeKey ? parsePanelKey(storeKey) : null
      const effectiveNoteId = parsedKey?.noteId && parsedKey.noteId.length > 0 ? parsedKey.noteId : noteId
      try {
        // Pass noteId as query parameter for composite key lookup
        const url = `/api/canvas/panels/${panelId}?noteId=${effectiveNoteId}`
        const response = await fetch(url, {
          method: 'DELETE'
        })

        if (!response.ok && response.status !== 404) {
          throw new Error(`Panel deletion failed: ${response.statusText}`)
        }

        debugLog({
          component: 'PanelPersistence',
          action: 'panel_deleted',
          metadata: { panelId, noteId: effectiveNoteId }
        })
      } catch (error) {
        debugLog({
          component: 'PanelPersistence',
          action: 'panel_deletion_failed',
          metadata: {
            error: error instanceof Error ? error.message : 'Unknown error',
            panelId,
            noteId: effectiveNoteId
          }
        })

        // Queue for offline replay
        await canvasOfflineQueue.enqueue({
          type: 'panel_delete',
          noteId: effectiveNoteId,
          data: { panelId, noteId: effectiveNoteId },
          workspaceVersion: getWorkspaceVersion(effectiveNoteId)
        })

        debugLog({
          component: 'PanelPersistence',
          action: 'panel_deletion_queued',
          metadata: { panelId, noteId: effectiveNoteId }
        })
      }
    },
    [noteId, getWorkspaceVersion]
  )

  /**
   * Batch persist multiple panel updates (useful for bulk operations)
   */
  const persistBatchUpdates = useCallback(
    async (updates: PanelUpdateData[]) => {
      const camera = {
        x: state.canvasState?.translateX || 0,
        y: state.canvasState?.translateY || 0
      }
      const zoom = state.canvasState?.zoom || 1.0

      // Convert all updates to world-space
      const worldUpdates = updates.map(update => {
        const payload: any = {
          id: update.panelId,
          updatedBy: userId
        }

        if (update.zIndex !== undefined) {
          payload.zIndex = update.zIndex
        }

        if (update.state !== undefined) {
          payload.state = update.state
        }

        if (update.position) {
          const worldPosition = update.coordinateSpace === 'world'
            ? update.position
            : screenToWorld(update.position, camera, zoom)
          payload.position = worldPosition
        }

        if (update.size) {
          const worldSize = update.coordinateSpace === 'world'
            ? update.size
            : (() => {
                const sizeXY = sizeScreenToWorld({ x: update.size!.width, y: update.size!.height }, zoom)
                return { width: sizeXY.x, height: sizeXY.y }
              })()
          payload.size = worldSize
        }

        return payload
      }).filter(update => Object.keys(update).length > 1)

      try {
        const response = await fetch(`/api/canvas/layout/${noteId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            updates: worldUpdates
          })
        })

        if (!response.ok) {
          throw new Error(`Batch update failed: ${response.statusText}`)
        }

        debugLog({
          component: 'PanelPersistence',
          action: 'batch_persisted',
          metadata: { count: updates.length, noteId }
        })
      } catch (error) {
        debugLog({
          component: 'PanelPersistence',
          action: 'batch_update_failed',
          metadata: {
            error: error instanceof Error ? error.message : 'Unknown error',
            count: updates.length,
            noteId
          }
        })

        // Queue each update individually for offline replay
        const workspaceVersion = getWorkspaceVersion(noteId)
        for (const update of worldUpdates) {
          await canvasOfflineQueue.enqueue({
            type: 'panel_update',
            noteId,
            data: update,
            workspaceVersion
          })
        }

        debugLog({
          component: 'PanelPersistence',
          action: 'batch_updates_queued',
          metadata: { count: updates.length, noteId }
        })
      }
    },
    [noteId, userId, state.canvasState, getWorkspaceVersion]
  )

  return {
    persistPanelUpdate,
    persistPanelCreate,
    persistPanelDelete,
    persistBatchUpdates,
    getPanelDimensions
  }
}
