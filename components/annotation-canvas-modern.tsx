"use client"

import { useEffect, useState, forwardRef, useImperativeHandle, useRef, useCallback, useMemo } from "react"
import { createPortal } from "react-dom"
import { flushSync } from "react-dom"
import { CanvasProvider, useCanvas } from "./canvas/canvas-context"
import type { DataStore } from "@/lib/data-store"
import { IsolationProvider } from "@/lib/isolation/context"
import { CanvasPanel } from "./canvas/canvas-panel"
import { AnnotationToolbar } from "./canvas/annotation-toolbar"
import { UnifiedProvider } from "@/lib/provider-switcher"
import { isPlainModeActive } from "@/lib/collab-mode"
import { useLayer } from "./canvas/layer-provider"
import { PopupStateAdapter } from "@/lib/adapters/popup-state-adapter"
// import { CanvasControls } from "./canvas/canvas-controls" // Removed per user request
import { EnhancedControlPanelV2 } from "./canvas/enhanced-control-panel-v2"
import { EnhancedMinimap } from "./canvas/enhanced-minimap"
import { WidgetStudioConnections } from "./canvas/widget-studio-connections"
import { panToPanel } from "@/lib/canvas/pan-animations"
import { Settings } from "lucide-react"
import { AddComponentMenu } from "./canvas/add-component-menu"
import { ComponentPanel } from "./canvas/component-panel"
import { StickyNoteOverlayPanel } from "./canvas/sticky-note-overlay-panel"
import { CanvasItem, createPanelItem, createComponentItem, isPanel, isComponent, PanelType } from "@/types/canvas-items"
import { ensurePanelKey, parsePanelKey } from "@/lib/canvas/composite-id"
// IsolationDebugPanel now integrated into EnhancedControlPanelV2
import { 
  loadStateFromStorage, 
  saveStateToStorage, 
  CANVAS_STORAGE_DEBOUNCE 
} from "@/lib/canvas/canvas-storage"
import { getPlainProvider } from "@/lib/provider-switcher"
import { getWheelZoomMultiplier } from "@/lib/canvas/zoom-utils"
import { worldToScreen, screenToWorld } from "@/lib/canvas/coordinate-utils"
import { debugLog } from "@/lib/utils/debug-logger"
import { useCanvasHydration } from "@/lib/hooks/use-canvas-hydration"
import { useCameraPersistence } from "@/lib/hooks/use-camera-persistence"
import { usePanelPersistence } from "@/lib/hooks/use-panel-persistence"
import { DEFAULT_PANEL_DIMENSIONS } from "@/lib/canvas/panel-metrics"
import { LayerManagerProvider, useLayerManager } from "@/lib/hooks/use-layer-manager"
import { useCanvasWorkspace, SHARED_WORKSPACE_ID, type OpenWorkspaceNote } from "./canvas/canvas-workspace-context"
import { useCameraUserId } from "@/lib/hooks/use-camera-scope"
import { dedupeCanvasItems, type CanvasDedupeWarning } from "@/lib/canvas/dedupe-canvas-items"
import { scheduleCanvasSnapshotDedupeMigration } from "@/lib/migrations/dedupe-snapshots-v1"

const PENDING_SAVE_MAX_AGE_MS = 5 * 60 * 1000

// Type alias for hydration hook result
type HydrationResult = ReturnType<typeof useCanvasHydration>

interface ModernAnnotationCanvasProps {
  noteIds: string[]
  primaryNoteId: string | null
  isNotesExplorerOpen?: boolean
  onCanvasStateChange?: (state: { zoom: number; showConnections: boolean }) => void
  showAddComponentMenu?: boolean
  onToggleAddComponentMenu?: () => void
  onRegisterActiveEditor?: (editorRef: any, panelId: string) => void
  onSnapshotLoadComplete?: () => void  // Called after snapshot load + centering completes
  skipSnapshotForNote?: string | null
  onSnapshotSettled?: (noteId: string) => void
  children?: React.ReactNode  // Toolbar and other components rendered inside CanvasProvider
  freshNoteIds?: string[]
  onFreshNoteHydrated?: (noteId: string) => void
}

interface CanvasImperativeHandle {
  zoomIn: () => void
  zoomOut: () => void
  resetView: () => void
  panBy: (deltaX: number, deltaY: number) => void
  toggleConnections: () => void
  centerOnPanel: (panelId: string) => void
  addComponent: (type: string, position?: { x: number; y: number }) => void
}

interface NoteHydratorProps {
  noteId: string
  userId?: string
  dataStore: DataStore
  branchesMap: Map<string, any>
  layerManager: ReturnType<typeof useLayerManager>['manager']
  onHydration: (noteId: string, status: HydrationResult) => void
  enabled?: boolean
  workspaceVersion?: number | null
}

function NoteHydrator({
  noteId,
  userId,
  dataStore,
  branchesMap,
  layerManager,
  onHydration,
  enabled = true,
  workspaceVersion,
}: NoteHydratorProps) {
  const status = useCanvasHydration({
    noteId,
    userId,
    dataStore,
    branchesMap,
    layerManager,
    enabled,
    workspaceVersion: workspaceVersion ?? undefined,
  })

  useEffect(() => {
    onHydration(noteId, status)
  }, [noteId, status, onHydration])

  return null
}

// Default viewport settings
const defaultViewport = {
  zoom: 1,
  translateX: -1000,
  translateY: -1200,
  showConnections: true,
}

// Create default canvas state
const createDefaultCanvasState = () => ({
  ...defaultViewport,
  isDragging: false,
  lastMouseX: 0,
  lastMouseY: 0,
})

// Create default canvas items with main panel
const LEGACY_DEFAULT_MAIN_POSITION = { x: 2000, y: 1500 }

const getDefaultMainPosition = (): { x: number; y: number } => {
  if (typeof window === 'undefined') {
    return { x: 0, y: 0 }
  }

  const { width, height } = DEFAULT_PANEL_DIMENSIONS
  const centeredX = Math.round(window.innerWidth / 2 - width / 2)
  const centeredY = Math.round(window.innerHeight / 2 - height / 2)
  return { x: centeredX, y: centeredY }
}

const isDefaultMainPosition = (position: { x: number; y: number } | null | undefined) => {
  if (!position) return false
  const defaultPosition = getDefaultMainPosition()
  const matchesCurrent = Math.round(position.x) === defaultPosition.x && Math.round(position.y) === defaultPosition.y
  const matchesLegacy = position.x === LEGACY_DEFAULT_MAIN_POSITION.x && position.y === LEGACY_DEFAULT_MAIN_POSITION.y
  return matchesCurrent || matchesLegacy
}

const createDefaultCanvasItems = (noteId: string, mainPosition?: { x: number; y: number }): CanvasItem[] => [
  createPanelItem(
    "main",
    mainPosition ?? getDefaultMainPosition(),
    "main",
    noteId,
    ensurePanelKey(noteId, "main"),
  ),
]

// Ensure main panel always exists in items array
const ensureMainPanel = (items: CanvasItem[], noteId: string, mainPosition?: { x: number; y: number }): CanvasItem[] => {
  let hasMain = false

  const normalizedItems = items.map((item) => {
    if (item.itemType !== "panel") {
      return item
    }

    const parsedFromStoreKey = item.storeKey ? parsePanelKey(item.storeKey) : null
    const parsedFromPanelId =
      item.panelId && item.panelId.includes("::") ? parsePanelKey(item.panelId) : null

    const resolvedNoteId =
      parsedFromStoreKey?.noteId || parsedFromPanelId?.noteId || item.noteId || noteId
    const resolvedPanelId =
      parsedFromStoreKey?.panelId || parsedFromPanelId?.panelId || item.panelId || "main"
    const nextStoreKey = ensurePanelKey(resolvedNoteId, resolvedPanelId)

    if (resolvedPanelId === "main" && resolvedNoteId === noteId) {
      hasMain = true
    }

    if (
      item.noteId !== resolvedNoteId ||
      item.panelId !== resolvedPanelId ||
      item.storeKey !== nextStoreKey
    ) {
      return {
        ...item,
        noteId: resolvedNoteId,
        panelId: resolvedPanelId,
        storeKey: nextStoreKey,
      }
    }

    return item
  })

  if (hasMain) {
    return normalizedItems
  }

  return [
    ...normalizedItems,
    createPanelItem(
      "main",
      mainPosition ?? getDefaultMainPosition(),
      "main",
      noteId,
      ensurePanelKey(noteId, "main"),
    ),
  ]
}

const ModernAnnotationCanvasInner = forwardRef<CanvasImperativeHandle, ModernAnnotationCanvasProps>(({ 
  noteIds,
  primaryNoteId,
  isNotesExplorerOpen = false,
  onCanvasStateChange,
  showAddComponentMenu: externalShowAddComponentMenu,
  onToggleAddComponentMenu,
  onSnapshotLoadComplete,
  skipSnapshotForNote,
  onSnapshotSettled,
  freshNoteIds = [],
  onFreshNoteHydrated
}, ref) => {
  const noteId = primaryNoteId ?? noteIds[0] ?? ""
  const hasNotes = noteIds.length > 0 && noteId.length > 0

  if (!hasNotes) {
    return null
  }
  const { state: canvasContextState, dispatch, dataStore } = useCanvas()
  const {
    openNotes,
    updateMainPosition,
    getPendingPosition,
    getCachedPosition,
    closeNote
  } = useCanvasWorkspace()
  const workspaceNoteMap = useMemo(() => {
    const map = new Map<string, OpenWorkspaceNote>()
    openNotes.forEach(note => map.set(note.noteId, note))
    return map
  }, [openNotes])
  const activeWorkspaceVersion = workspaceNoteMap.get(noteId)?.version ?? null
  const freshNoteSet = useMemo(() => new Set(freshNoteIds), [freshNoteIds])
  const isDefaultOffscreenPosition = useCallback((position: { x: number; y: number } | null | undefined) => {
    return isDefaultMainPosition(position)
  }, [])

  const resolveWorkspacePosition = useCallback((targetNoteId: string): { x: number; y: number } | null => {
    const pending = getPendingPosition(targetNoteId)
    if (pending && !isDefaultOffscreenPosition(pending)) return pending

    const cached = getCachedPosition(targetNoteId)
    if (cached && !isDefaultOffscreenPosition(cached)) return cached

    const workspaceEntry = workspaceNoteMap.get(targetNoteId)
    if (workspaceEntry?.mainPosition && !isDefaultOffscreenPosition(workspaceEntry.mainPosition)) {
      return workspaceEntry.mainPosition
    }

    return null
  }, [workspaceNoteMap, getPendingPosition, getCachedPosition, isDefaultOffscreenPosition])

  const workspaceMainPosition = useMemo(() => resolveWorkspacePosition(noteId), [noteId, resolveWorkspacePosition])
  const getItemNoteId = useCallback((item: CanvasItem): string | null => {
    if (item.noteId) return item.noteId
    if (item.storeKey) {
      const parsed = parsePanelKey(item.storeKey)
      if (parsed.noteId) return parsed.noteId
    }
    return null
  }, [])

  // Layer system for multi-layer canvas
  const layerContext = useLayer()
  const canvasOpacity = layerContext ? PopupStateAdapter.getLayerOpacity('notes', layerContext.activeLayer) : 1

  // Initialize canvas state - check for snapshot to avoid visible jump
  const [canvasState, _setCanvasState] = useState(() => {
    const snapshot = activeWorkspaceVersion !== null
      ? loadStateFromStorage(noteId, activeWorkspaceVersion)
      : loadStateFromStorage(noteId)
    console.log('[AnnotationCanvas] useState initializer:', {
      noteId,
      hasSnapshot: !!snapshot,
      snapshotViewport: snapshot?.viewport
    })

    if (snapshot && snapshot.viewport) {
      const initialState = {
        ...createDefaultCanvasState(),
        translateX: snapshot.viewport.translateX ?? defaultViewport.translateX,
        translateY: snapshot.viewport.translateY ?? defaultViewport.translateY,
        zoom: snapshot.viewport.zoom ?? 1,
        showConnections: snapshot.viewport.showConnections ?? true
      }
      console.log('[AnnotationCanvas] Initializing state from snapshot:', initialState)
      return initialState
    }

    console.log('[AnnotationCanvas] Initializing state to default (no snapshot)')
    return createDefaultCanvasState()
  })

  const canvasStateRef = useRef(canvasState)

  useEffect(() => {
    canvasStateRef.current = canvasState
  }, [canvasState])

  // Wrap setCanvasState to log all calls
  const setCanvasState: typeof _setCanvasState = useCallback((update) => {
    const stack = new Error().stack
    const caller = stack?.split('\n').slice(2, 6).join(' | ') || 'unknown'

    debugLog({
      component: 'AnnotationCanvas',
      action: 'setCanvasState_called',
      metadata: {
        noteId,
        isFunction: typeof update === 'function',
        caller: caller.substring(0, 500)
      }
    })

    return _setCanvasState(update)
  }, [noteId])

  // Track viewport changes for debugging
  const previousViewportRef = useRef({ x: canvasState.translateX, y: canvasState.translateY })

  useEffect(() => {
    const prev = previousViewportRef.current
    const changed = prev.x !== canvasState.translateX || prev.y !== canvasState.translateY

    if (changed) {
      const stack = new Error().stack
      const caller = stack?.split('\n')[3] || 'unknown'

      debugLog({
        component: 'AnnotationCanvas',
        action: 'viewport_changed',
        metadata: {
          noteId,
          from: { x: prev.x, y: prev.y },
          to: { x: canvasState.translateX, y: canvasState.translateY },
          delta: { x: canvasState.translateX - prev.x, y: canvasState.translateY - prev.y },
          zoom: canvasState.zoom,
          caller: caller.trim(),
          isDragging: canvasState.isDragging
        }
      })

      previousViewportRef.current = { x: canvasState.translateX, y: canvasState.translateY }
    }
  }, [canvasState.translateX, canvasState.translateY, canvasState.isDragging, noteId])

  // Unified canvas items state
const workspaceSeedAppliedRef = useRef(false)
const [canvasItems, _setCanvasItems] = useState<CanvasItem[]>([])
const canvasItemsRef = useRef<CanvasItem[]>(canvasItems)

useEffect(() => {
  canvasItemsRef.current = canvasItems
}, [canvasItems])

const [dedupeWarnings, setDedupeWarnings] = useState<CanvasDedupeWarning[]>([])

const updateDedupeWarnings = useCallback((incoming: CanvasDedupeWarning[], options: { append?: boolean } = {}) => {
  setDedupeWarnings(prev => {
    const combined = options.append ? [...prev, ...incoming] : [...incoming]
    if (combined.length === 0) {
      return prev.length === 0 ? prev : []
    }

    const serialize = (warning: CanvasDedupeWarning) =>
      `${warning.code}:${warning.panelId ?? ''}:${warning.noteId ?? ''}:${warning.storeKey ?? ''}:${warning.message}`

    const uniqueMap = new Map<string, CanvasDedupeWarning>()
    combined.forEach(warning => {
      uniqueMap.set(serialize(warning), warning)
    })

    const normalized = Array.from(uniqueMap.values())
    normalized.sort((a, b) => serialize(a).localeCompare(serialize(b)))

    const prevSerialized = prev.map(serialize)
    const normalizedSerialized = normalized.map(serialize)
    const isSame =
      prevSerialized.length === normalizedSerialized.length &&
      prevSerialized.every((value, index) => value === normalizedSerialized[index])

    if (isSame) {
      return prev
    }

    return normalized
  })
}, [])

const setCanvasItems: typeof _setCanvasItems = useCallback((update) => {
  const stack = new Error().stack
  const caller = stack?.split('\n').slice(2, 4).join(' | ') || 'unknown'

  _setCanvasItems(prev => {
    const next = typeof update === 'function' ? update(prev) : update

    // CRITICAL FIX: If the update function returned the same array reference,
    // don't trigger a re-render. This prevents unnecessary React updates.
    if (next === prev) {
      debugLog({
        component: 'AnnotationCanvas',
        action: 'setCanvasItems_SKIPPED_SAME_REF',
        metadata: {
          noteId,
          reason: 'update_returned_same_array_reference',
          caller: caller.substring(0, 200)
        }
      })
      return prev
    }

    const mainPanels = next.filter(item => item.itemType === 'panel' && item.panelId === 'main')

    debugLog({
      component: 'AnnotationCanvas',
      action: 'setCanvasItems_called',
      metadata: {
        noteId,
        isFunction: typeof update === 'function',
        prevItemCount: prev.length,
        nextItemCount: next.length,
        mainPanelPositions: mainPanels.map(p => ({
          noteId: p.noteId,
          position: p.position
        })),
        caller: caller.substring(0, 300)
      }
    })

    const result = dedupeCanvasItems(next, { fallbackNoteId: noteId })

    if (result.removedCount > 0) {
      debugLog({
        component: 'AnnotationCanvas',
        action: 'canvasItems_deduped_at_source',
        metadata: {
          noteId,
          removedCount: result.removedCount,
          resultingCount: result.items.length
        }
      })
    }

    if (result.warnings.length > 0) {
      result.warnings.forEach(warning => {
        debugLog({
          component: 'AnnotationCanvas',
          action: 'canvasItems_dedupe_warning',
          metadata: {
            code: warning.code,
            panelId: warning.panelId ?? null,
            noteId: warning.noteId ?? null,
            storeKey: warning.storeKey ?? null
          },
          content_preview: warning.message
        })
      })
    }

    if (result.warnings.length > 0) {
      queueMicrotask(() => updateDedupeWarnings(result.warnings, { append: false }))
    } else {
      queueMicrotask(() => updateDedupeWarnings([], { append: false }))
    }

    return result.items
  })
}, [noteId, updateDedupeWarnings])
const [isStateLoaded, setIsStateLoaded] = useState(false)
const autoSaveTimerRef = useRef<number | null>(null)
const [showControlPanel, setShowControlPanel] = useState(false)
const [internalShowAddComponentMenu, setInternalShowAddComponentMenu] = useState(false)
const mainPanelSeededRef = useRef(false)

  // CRITICAL: This effect syncs canvasItems with noteIds
  // It should NEVER update positions for existing panels (only metadata)
  useEffect(() => {
    debugLog({
      component: 'AnnotationCanvas',
      action: 'noteIds_sync_effect_triggered',
      metadata: {
        hasNotes,
        noteIds,
        currentItemsCount: canvasItems.length,
        currentNoteIdProp: noteId  // Track the current noteId prop
      }
    })

    if (!hasNotes) {
      setCanvasItems([])
      return
    }

    setCanvasItems(prev => {
      const allowedNoteIds = new Set(noteIds)
      let changed = false

      const mainByNote = new Map<string, CanvasItem>()
      const otherItems: CanvasItem[] = []

      // Track what panels we start with
      const prevMainPanels = prev
        .filter(item => item.itemType === 'panel' && item.panelId === 'main')
        .map(item => ({
          noteId: getItemNoteId(item),
          position: item.position
        }))

      prev.forEach(item => {
        if (item.itemType === 'panel' && item.panelId === 'main') {
          const itemNoteId = getItemNoteId(item)
          if (itemNoteId && allowedNoteIds.has(itemNoteId)) {
            mainByNote.set(itemNoteId, item)
          } else {
            changed = true
          }
          return
        }

        const itemNoteId = getItemNoteId(item)
        if (itemNoteId && !allowedNoteIds.has(itemNoteId)) {
          changed = true
          return
        }

        otherItems.push(item)
      })

      const nextMainItems: CanvasItem[] = []
      noteIds.forEach(id => {
        const existing = mainByNote.get(id)
        const targetStoreKey = ensurePanelKey(id, 'main')

        if (existing) {
          // CRITICAL FIX: Only update metadata (noteId, storeKey), NOT position
          // Position updates should only happen via explicit user actions (drag)
          // or initial hydration, NOT on every tab click/note switch
          const needsMetaUpdate = existing.noteId !== id || existing.storeKey !== targetStoreKey

          if (needsMetaUpdate) {
            debugLog({
              component: 'AnnotationCanvas',
              action: 'noteIds_sync_updating_metadata_only',
              metadata: {
                noteId: id,
                existingNoteId: existing.noteId,  // Track BEFORE
                existingPosition: existing.position,
                keepingPosition: true
              }
            })

            nextMainItems.push({
              ...existing,
              // Keep existing position - do NOT update from workspace
              position: existing.position,
              noteId: id,
              storeKey: targetStoreKey
            })
            changed = true
          } else {
            nextMainItems.push(existing)
          }
        } else {
          // New panel - use workspace position if available, otherwise default
          const targetPosition = resolveWorkspacePosition(id) ?? getDefaultMainPosition()

          debugLog({
            component: 'AnnotationCanvas',
            action: 'noteIds_sync_creating_new_panel',
            metadata: {
              noteId: id,
              targetPosition,
              source: isDefaultMainPosition(targetPosition) ? 'default' : 'workspace'
            }
          })

          nextMainItems.push(
            createPanelItem('main', targetPosition, 'main', id, targetStoreKey)
          )
          changed = true
        }
      })

      const newItems = [...nextMainItems, ...otherItems]

      // CRITICAL: Only return new array if something actually changed
      // Returning the same array prevents unnecessary React re-renders
      if (!changed && newItems.length === prev.length) {
        debugLog({
          component: 'AnnotationCanvas',
          action: 'noteIds_sync_NO_CHANGE',
          metadata: {
            noteIds,
            itemCount: prev.length,
            reason: 'items_unchanged_returning_prev'
          }
        })
        return prev
      }

      // Track what panels we're returning
      const nextMainPanels = nextMainItems.map(item => ({
        noteId: getItemNoteId(item),
        position: item.position
      }))

      debugLog({
        component: 'AnnotationCanvas',
        action: 'noteIds_sync_updated_items',
        metadata: {
          prevCount: prev.length,
          newCount: newItems.length,
          changed,
          noteIdsInput: noteIds,
          currentNoteIdProp: noteId,
          prevMainPanels,
          nextMainPanels,
          mainByNoteKeys: Array.from(mainByNote.keys())
        }
      })

      return newItems
    })
  }, [hasNotes, noteIds, getItemNoteId, resolveWorkspacePosition, noteId])

  // Reset per-note refs when noteId changes
  const initialNoteRef = useRef<string | null>(null)

  useEffect(() => {
    const isFirstNote = initialNoteRef.current === null
    if (isFirstNote) {
      initialNoteRef.current = noteId
    }

    debugLog({
      component: 'AnnotationCanvas',
      action: 'noteId_changed_resetting_refs',
      metadata: {
        noteId,
        prevMainPanelSeeded: mainPanelSeededRef.current,
        prevWorkspaceSeedApplied: workspaceSeedAppliedRef.current,
        isFirstNote,
      }
    })

    mainPanelSeededRef.current = false
    if (isFirstNote) {
      workspaceSeedAppliedRef.current = false
    }
  }, [noteId])
  const isRestoringSnapshotRef = useRef(false)
  
  // Use external control if provided, otherwise use internal state
  const showAddComponentMenu = externalShowAddComponentMenu !== undefined ? externalShowAddComponentMenu : internalShowAddComponentMenu
  const toggleAddComponentMenu = onToggleAddComponentMenu || (() => setInternalShowAddComponentMenu(!internalShowAddComponentMenu))
  const [stickyOverlayEl, setStickyOverlayEl] = useState<HTMLElement | null>(null)

  // Canvas state persistence - Get provider instances for hydration
  const provider = useMemo(() => UnifiedProvider.getInstance(), [])
  const branchesMap = useMemo(() => provider.getBranchesMap(), [provider])
  const layerManagerApi = useLayerManager()
  const cameraUserId = useCameraUserId()

  // Hydrate canvas state on mount (panels + camera)
  const primaryHydrationStatus = useCanvasHydration({
    noteId,
    userId: cameraUserId ?? undefined,
    dataStore,
    branchesMap,
    layerManager: layerManagerApi.manager,
    enabled: Boolean(noteId)
  })

  // CRITICAL FIX: Track initial hydration PER NOTE (not per component)
  // In multi-note workspaces, each note needs its own initial hydration
  const hydratedNotesRef = useRef<Set<string>>(new Set())
  const lastHydratedNoteRef = useRef<string | null>(null)
  const initialCanvasSetupRef = useRef(false)

  const handleNoteHydration = useCallback((targetNoteId: string, hydrationStatus: HydrationResult) => {
    if (!hydrationStatus?.success || hydrationStatus.panels.length === 0) {
      return
    }

    if (hydratedNotesRef.current.has(targetNoteId)) {
      debugLog({
        component: 'AnnotationCanvas',
        action: 'skip_already_hydrated_note',
        metadata: {
          noteId: targetNoteId,
          reason: 'note_marked_hydrated'
        }
      })
      return
    }

    const workspaceMainPosition = resolveWorkspacePosition(targetNoteId)
    const isInitialHydration = !hydratedNotesRef.current.has(targetNoteId)
    const isSameNote = lastHydratedNoteRef.current === targetNoteId
    const mainPanelExists = canvasItems.some(item => item.itemType === 'panel' && item.panelId === 'main' && getItemNoteId(item) === targetNoteId)
    const skipHydration = !isInitialHydration && mainPanelExists

    const currentNotePanels = hydrationStatus.panels.filter(panel => {
      const parsed = panel.id.includes('::') ? parsePanelKey(panel.id) : null
      const panelNoteId = panel.noteId || parsed?.noteId || targetNoteId
      const isCurrentNote = panelNoteId === targetNoteId
      const isActive = (panel.state ?? 'active') === 'active'
      return isCurrentNote && isActive
    })

    const panelsToHydrate = skipHydration
      ? []
      : (isInitialHydration || !isSameNote
          ? (isInitialHydration ? currentNotePanels : currentNotePanels.filter(panel => panel.id === 'main'))
          : currentNotePanels.filter(panel => panel.id === 'main'))

    debugLog({
      component: 'AnnotationCanvas',
      action: 'creating_canvas_items_from_hydration',
      metadata: {
        totalPanels: hydrationStatus.panels.length,
        currentNotePanels: currentNotePanels.length,
        noteId: targetNoteId,
        panelsHydrated: panelsToHydrate.map(panel => panel.id),
        mode: skipHydration
          ? 'skip_existing_panel'
          : isInitialHydration
            ? 'initial_restore'
            : (isSameNote ? 'same_note_refresh' : 'note_switch')
      }
    })

    if (panelsToHydrate.length === 0) {
      debugLog({
        component: 'AnnotationCanvas',
        action: 'skipping_hydration_no_panels',
        metadata: {
          reason: skipHydration ? 'skip_existing_panel' : 'no_panels_to_hydrate',
          isInitialHydration,
          mainPanelExists,
          noteId: targetNoteId
        }
      })
      if (!skipHydration) {
        lastHydratedNoteRef.current = targetNoteId
      }
      return
    }

    const newItems = panelsToHydrate.map(panel => {
      const panelType = (panel.metadata?.annotationType as PanelType) || 'note'
      const parsedId = panel.id.includes('::') ? parsePanelKey(panel.id) : null
      const hydratedNoteId = panel.noteId || parsedId?.noteId || targetNoteId
      const hydratedPanelId = parsedId?.panelId || panel.id
      const storeKey = ensurePanelKey(hydratedNoteId, hydratedPanelId)
      const camera = { x: canvasState.translateX, y: canvasState.translateY }
      const screenPosition = worldToScreen(panel.position, camera, canvasState.zoom)

      debugLog({
        component: 'AnnotationCanvas',
        action: 'world_to_screen_conversion',
        metadata: {
          panelId: panel.id,
          worldPosition: panel.position,
          camera,
          zoom: canvasState.zoom,
          screenPosition,
          noteId: hydratedNoteId
        },
        content_preview: `Panel ${panel.id}: world(${panel.position.x}, ${panel.position.y}) → screen(${screenPosition.x}, ${screenPosition.y})`
      })

      return createPanelItem(
        hydratedPanelId,
        screenPosition,
        panelType,
        hydratedNoteId,
        storeKey,
      )
    })

    setCanvasItems(prev => {
      const existingStoreKeys = new Set(
        prev
          .filter(item => item.itemType === 'panel')
          .map(item => {
            if (item.storeKey) {
              return item.storeKey
            }
            const resolvedNoteId = getItemNoteId(item) ?? targetNoteId
            const resolvedPanelId = item.panelId ?? 'main'
            return ensurePanelKey(resolvedNoteId, resolvedPanelId)
          })
      )

      const itemsToAdd = newItems.filter(item => {
        const key = item.storeKey ?? ensurePanelKey(
          item.noteId ?? targetNoteId,
          item.panelId ?? 'main'
        )
        if (existingStoreKeys.has(key)) {
          debugLog({
            component: 'AnnotationCanvas',
            action: 'HYDRATION_SKIPPED_DUPLICATE',
            metadata: {
              noteId: targetNoteId,
              panelId: item.panelId,
              storeKey: key,
              reason: 'panel_already_exists_in_canvas'
            }
          })
          return false
        }
        existingStoreKeys.add(key)
        return true
      })

      if (itemsToAdd.length > 0) {
        debugLog({
          component: 'AnnotationCanvas',
          action: 'HYDRATION_ADDING_PANELS',
          metadata: {
            noteId: targetNoteId,
            addedCount: itemsToAdd.length,
            totalItems: prev.length + itemsToAdd.length,
            addedPanels: itemsToAdd.map(p => ({
              panelId: p.panelId,
              position: p.position,
              noteId: p.noteId
            }))
          }
        })
        return [...prev, ...itemsToAdd]
      }

      return prev
    })

    newItems.forEach(item => {
      if (isPanel(item)) {
        const panelKey = item.storeKey ?? ensurePanelKey(item.noteId ?? targetNoteId, item.panelId ?? 'main')
        dispatch({
          type: 'ADD_PANEL',
          payload: {
            id: panelKey,
            panel: { element: null, branchId: item.panelId }
          }
        })
        debugLog({
          component: 'AnnotationCanvas',
          action: 'added_hydrated_panel_to_state',
          metadata: {
            panelId: item.panelId,
            noteId: item.noteId,
            compositeKey: panelKey
          },
          content_preview: `Added hydrated panel ${panelKey} to state.panels for connection lines`
        })
      }
    })

    if (!initialCanvasSetupRef.current && workspaceMainPosition && !mainPanelExists) {
      setCanvasItems(prev =>
        prev.map(item => {
          if (item.itemType === 'panel' && item.panelId === 'main') {
            const itemNoteId = getItemNoteId(item)
            if (itemNoteId === targetNoteId) {
              return { ...item, position: workspaceMainPosition }
            }
          }
          return item
        })
      )
      workspaceSeedAppliedRef.current = true
    }

    hydratedNotesRef.current.add(targetNoteId)
    lastHydratedNoteRef.current = targetNoteId

    debugLog({
      component: 'AnnotationCanvas',
      action: 'marked_note_as_hydrated',
      metadata: {
        noteId: targetNoteId,
        totalHydratedNotes: hydratedNotesRef.current.size,
        hydratedNotes: Array.from(hydratedNotesRef.current)
      }
    })

    if (freshNoteSet.has(targetNoteId)) {
      debugLog({
        component: 'AnnotationCanvas',
        action: 'fresh_note_hydrated',
        metadata: { noteId: targetNoteId }
      })
      queueMicrotask(() => {
        onFreshNoteHydrated?.(targetNoteId)
      })
    }
  }, [canvasItems, canvasState.translateX, canvasState.translateY, canvasState.zoom, dispatch, getItemNoteId, resolveWorkspacePosition, freshNoteSet, onFreshNoteHydrated])

  useEffect(() => {
    if (!noteId) return
    handleNoteHydration(noteId, primaryHydrationStatus)
  }, [noteId, primaryHydrationStatus, handleNoteHydration])
  // CRITICAL: This effect updates main panel positions from workspace
  // It should ONLY run for BRAND NEW notes (first time opening), NOT when switching between already-open notes!
  useEffect(() => {
    // Check if main panel for this note already exists in canvasItems
    const mainPanelExists = canvasItems.some(item => {
      if (item.itemType === "panel" && item.panelId === "main") {
        const itemNoteId = getItemNoteId(item)
        return itemNoteId === noteId
      }
      return false
    })

    debugLog({
      component: 'AnnotationCanvas',
      action: 'workspaceSeedAppliedRef_effect_triggered',
      metadata: {
        noteId,
        mainPanelExists,
        workspaceSeedApplied: workspaceSeedAppliedRef.current,
        hasWorkspacePosition: !!workspaceMainPosition,
        workspacePosition: workspaceMainPosition,
        hydrationSuccess: primaryHydrationStatus.success,
        willUpdatePosition: !workspaceSeedAppliedRef.current && !!workspaceMainPosition && !primaryHydrationStatus.success && !mainPanelExists
      }
    })

    // CRITICAL FIX: Do NOT run if panel already exists (switching between open notes)
    if (mainPanelExists) {
      debugLog({
        component: 'AnnotationCanvas',
        action: 'WORKSPACE_SEED_SKIPPED_PANEL_EXISTS',
        metadata: {
          noteId,
          reason: 'main_panel_already_exists_in_canvas'
        }
      })
      return
    }

    if (workspaceSeedAppliedRef.current) return
    if (!workspaceMainPosition) return
    if (primaryHydrationStatus.success) return
    if (initialNoteRef.current !== noteId) return

    debugLog({
      component: 'AnnotationCanvas',
      action: 'WORKSPACE_SEED_UPDATING_POSITIONS',
      metadata: {
        noteId,
        workspaceMainPosition,
        reason: 'workspace_seed_applied_new_note'
      }
    })

    setCanvasItems(prev =>
      prev.map(item => {
        // Only update main panel for the CURRENT note
        if (item.itemType === "panel" && item.panelId === "main") {
          const itemNoteId = getItemNoteId(item)
          if (itemNoteId === noteId) {
            return { ...item, position: workspaceMainPosition }
          }
        }
        return item
      }),
    )
    workspaceSeedAppliedRef.current = true
  }, [noteId, workspaceMainPosition, primaryHydrationStatus.success, getItemNoteId, canvasItems])

  // Enable camera persistence (debounced)
  useCameraPersistence({
    noteId,
    userId: cameraUserId ?? undefined,
    debounceMs: 500,
    enabled: true
  })

  // Enable panel persistence
  const { persistPanelCreate, persistPanelUpdate, getPanelDimensions } = usePanelPersistence({
    dataStore,
    branchesMap,
    layerManager: layerManagerApi.manager,
    noteId,
    canvasItems,
    userId: cameraUserId ?? undefined
  })

  const persistCameraSnapshot = useCallback(
    async (camera: { x: number; y: number; zoom: number }) => {
      if (typeof window === 'undefined') return
      try {
        await fetch(`/api/canvas/camera/${noteId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ camera, userId: cameraUserId ?? null })
        })
      } catch (error) {
        console.warn('[AnnotationCanvas] Failed to persist restored camera snapshot', error)
      }
    },
    [noteId, cameraUserId]
  )

  // Persist main panel if it doesn't exist in database (first-time note open)
  useEffect(() => {
    if (primaryHydrationStatus.success) {
      const hasMainPanel = primaryHydrationStatus.panels.some(p => p.id === 'main')

      if (!hasMainPanel && !mainPanelSeededRef.current) {
        // Main panel doesn't exist in database - persist it with CENTERED position
        debugLog({
          component: 'AnnotationCanvas',
          action: 'persisting_default_main_panel',
          metadata: { noteId }
        })

        // Calculate a centered position instead of using offscreen default
        const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 1920
        const viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 1080

        // CRITICAL FIX: Find the main panel for THIS note, not just any main panel
        const mainPanelItem = canvasItems.find(item => {
          if (item.itemType === 'panel' && item.panelId === 'main') {
            const itemNoteId = getItemNoteId(item)
            return itemNoteId === noteId
          }
          return false
        })

        const screenDimensions = getPanelDimensions('main')
        const worldPanelWidth = screenDimensions.width / canvasState.zoom
        const worldPanelHeight = screenDimensions.height / canvasState.zoom

        // Calculate world position that will appear centered with current viewport
        // Screen center position (where we want panel center to appear)
        const screenCenterX = viewportWidth / 2
        const screenCenterY = viewportHeight / 2

        // Convert screen position to world position
        // screenPos = (worldPos + viewportTranslate) * zoom
        // worldPos = (screenPos / zoom) - viewportTranslate
        const worldCenterX = (screenCenterX / canvasState.zoom) - canvasState.translateX
        const worldCenterY = (screenCenterY / canvasState.zoom) - canvasState.translateY

        // Offset by half panel size to center the panel (not just top-left corner)
        const centeredPosition = {
          x: worldCenterX - (worldPanelWidth / 2),
          y: worldCenterY - (worldPanelHeight / 2)
        }

        // Get current main panel position from canvas items (if already set)
        const existingMainPanelPosition = mainPanelItem?.position && !isDefaultOffscreenPosition(mainPanelItem.position)
          ? mainPanelItem.position
          : null
        const workspacePosition = workspaceMainPosition && !isDefaultOffscreenPosition(workspaceMainPosition)
          ? workspaceMainPosition
          : null

        // Priority: 1) existing main panel position (if not default), 2) workspace position (if not default), 3) calculated centered position
        const mainPosition = existingMainPanelPosition || workspacePosition || centeredPosition

        const defaultMainPosition = getDefaultMainPosition()

        debugLog({
          component: 'AnnotationCanvas',
          action: 'NEW_NOTE_MAIN_POSITION_DETERMINED',
          metadata: {
            noteId,
            mainPanelItem_position: mainPanelItem?.position,
            workspaceMainPosition,
            defaultMainPosition,
            centeredPosition,
            currentViewport: { x: canvasState.translateX, y: canvasState.translateY, zoom: canvasState.zoom },
            finalMainPosition: mainPosition
          }
        })

        console.log('[NEW NOTE] Main panel position determined:', {
          'from canvasItems': mainPanelItem?.position,
          'from workspace': workspaceMainPosition,
          'default (offscreen)': defaultMainPosition,
          'calculated centered': centeredPosition,
          'current viewport': { x: canvasState.translateX, y: canvasState.translateY },
          'FINAL POSITION USED': mainPosition
        })

        // Update canvas items to use the final position (especially if we calculated a centered position)
        if (!mainPanelItem?.position || isDefaultOffscreenPosition(mainPanelItem.position)) {
          // Main panel is using default offscreen position or doesn't exist - update it to centered position
          const currentPosition = mainPanelItem?.position
          if (!currentPosition || currentPosition.x !== mainPosition.x || currentPosition.y !== mainPosition.y) {
            setCanvasItems(prev =>
              prev.map(item => {
                // CRITICAL FIX: Only update the main panel for THIS noteId, not all main panels!
                const itemNoteId = getItemNoteId(item)
                if (item.itemType === 'panel' && item.panelId === 'main' && itemNoteId === noteId) {
                  return { ...item, position: mainPosition }
                }
                return item
              })
            )
            debugLog({
              component: 'AnnotationCanvas',
              action: 'NEW_NOTE_CANVAS_POSITION_UPDATED',
              metadata: { noteId, mainPosition },
            })
          }
        }

        const cameraForConversion = {
          x: canvasState.translateX,
          y: canvasState.translateY
        }
        const screenPosition = worldToScreen(mainPosition, cameraForConversion, canvasState.zoom)

        const mainStoreKey = ensurePanelKey(noteId, 'main')
        const mainBranch = dataStore.get(mainStoreKey)
        const resolvedTitle =
          (mainBranch && typeof mainBranch.title === 'string' && mainBranch.title.trim().length > 0
            ? mainBranch.title
            : mainPanelItem?.title) ?? undefined

        const seedReason = existingMainPanelPosition
          ? 'existing_position'
          : workspacePosition
            ? 'workspace_position'
            : 'centered_position'

        debugLog({
          component: 'AnnotationCanvas',
          action: 'workspace_main_panel_seeded',
          metadata: {
            noteId,
            seedReason,
            screenDimensions,
            worldPanelSize: { width: worldPanelWidth, height: worldPanelHeight },
            mainPosition,
            viewport: {
              translateX: canvasState.translateX,
              translateY: canvasState.translateY,
              zoom: canvasState.zoom
            }
          }
        })

        persistPanelCreate({
          panelId: 'main',
          storeKey: ensurePanelKey(noteId, 'main'),  // Composite key for multi-note support
          type: 'editor',
          position: screenPosition,
          size: { width: screenDimensions.width, height: screenDimensions.height },
          zIndex: 0,
          title: resolvedTitle,
          metadata: { annotationType: 'main' }
        }).catch(err => {
          debugLog({
            component: 'AnnotationCanvas',
            action: 'main_panel_persist_failed',
            metadata: { error: err instanceof Error ? err.message : 'Unknown error' }
          })
        })

        void updateMainPosition(noteId, mainPosition).catch(err => {
          debugLog({
            component: 'AnnotationCanvas',
            action: 'workspace_main_position_update_failed',
            metadata: {
              error: err instanceof Error ? err.message : 'Unknown error',
              noteId
            }
          })
        })

        mainPanelSeededRef.current = true
      }
    }
  }, [
    primaryHydrationStatus.success,
    primaryHydrationStatus.panels,
    noteId,
    canvasItems,
    persistPanelCreate,
    workspaceMainPosition,
    updateMainPosition,
    // CRITICAL FIX: DO NOT include canvasState.zoom/translateX/translateY
    // Including viewport state causes this effect to re-run on every camera pan,
    // which recalculates positions and causes panels to jump when switching tabs!
    // This effect should ONLY run when hydration completes or note changes.
    dataStore
  ])

  // Selection guards to prevent text highlighting during canvas drag
  const selectionGuardsRef = useRef<{
    onSelectStart: (e: Event) => void;
    onDragStart: (e: Event) => void;
    prevUserSelect: string;
  } | null>(null)

  const enableSelectionGuards = useCallback(() => {
    if (typeof document === 'undefined') return
    if (selectionGuardsRef.current) return
    const onSelectStart = (e: Event) => { e.preventDefault() }
    const onDragStart = (e: Event) => { e.preventDefault() }
    selectionGuardsRef.current = { onSelectStart, onDragStart, prevUserSelect: document.body.style.userSelect }
    document.documentElement.classList.add('dragging-no-select')
    document.body.style.userSelect = 'none'
    document.addEventListener('selectstart', onSelectStart, true)
    document.addEventListener('dragstart', onDragStart, true)
    try { window.getSelection()?.removeAllRanges?.() } catch {}
  }, [])

  const pendingDispatchRef = useRef({
    translateX: canvasContextState.canvasState.translateX,
    translateY: canvasContextState.canvasState.translateY,
    zoom: canvasContextState.canvasState.zoom,
  })
  const dispatchFrameRef = useRef<number | null>(null)

  const scheduleDispatch = useCallback(
    (next: { translateX: number; translateY: number; zoom: number }) => {
      pendingDispatchRef.current = next
      if (dispatchFrameRef.current != null) return

      dispatchFrameRef.current = requestAnimationFrame(() => {
        dispatchFrameRef.current = null
        const payload = pendingDispatchRef.current
        dispatch({
          type: 'SET_CANVAS_STATE',
          payload,
        })
      })
    },
    [dispatch]
  )

  useEffect(() => {
    return () => {
      if (dispatchFrameRef.current != null) {
        cancelAnimationFrame(dispatchFrameRef.current)
        dispatchFrameRef.current = null
      }
    }
  }, [])

  const updateCanvasTransform = useCallback(
    (updater: (prev: ReturnType<typeof createDefaultCanvasState>) => ReturnType<typeof createDefaultCanvasState>) => {
      setCanvasState(prev => {
        const next = updater(prev)
        if (
          next.translateX !== prev.translateX ||
          next.translateY !== prev.translateY ||
          next.zoom !== prev.zoom
        ) {
          scheduleDispatch({
            translateX: next.translateX,
            translateY: next.translateY,
            zoom: next.zoom,
          })
        }
        return next
      })
    },
    [scheduleDispatch]
  )

  const panBy = useCallback(
    (deltaX: number, deltaY: number) => {
      if (deltaX === 0 && deltaY === 0) {
        return
      }
      updateCanvasTransform(prev => ({
        ...prev,
        translateX: prev.translateX + deltaX,
        translateY: prev.translateY + deltaY,
      }))
    },
    [updateCanvasTransform]
  )

  useEffect(() => {
    // Skip syncing if we're currently restoring from snapshot
    // This prevents the visible "jump" from default viewport to restored viewport
    if (isRestoringSnapshotRef.current) {
      debugLog({
        component: 'AnnotationCanvas',
        action: 'skip_context_sync_during_snapshot_restore',
        metadata: { noteId, reason: 'snapshot_restoration_in_progress' }
      })
      return
    }

    const { translateX, translateY, zoom } = canvasContextState.canvasState
    setCanvasState(prev => {
      if (
        prev.translateX === translateX &&
        prev.translateY === translateY &&
        prev.zoom === zoom
      ) {
        return prev
      }
      return {
        ...prev,
        translateX,
        translateY,
        zoom,
      }
    })
  }, [
    canvasContextState.canvasState.translateX,
    canvasContextState.canvasState.translateY,
    canvasContextState.canvasState.zoom,
    noteId
  ])

  const disableSelectionGuards = useCallback(() => {
    if (typeof document === 'undefined') return
    const g = selectionGuardsRef.current
    if (!g) return
    document.removeEventListener('selectstart', g.onSelectStart, true)
    document.removeEventListener('dragstart', g.onDragStart, true)
    document.documentElement.classList.remove('dragging-no-select')
    document.body.style.userSelect = g.prevUserSelect || ''
    selectionGuardsRef.current = null
  }, [])

  useEffect(() => {
    // Note: We no longer clear editor docs when switching notes
    // The composite key system (noteId-panelId) already isolates docs between notes
    // This allows content to load immediately when switching back to a previously viewed note
    
    // Check if we're in plain mode (explicit flag; avoids provider init race)
    const isPlainMode = isPlainModeActive()
    
    if (!isPlainMode) {
      // Initialize collaboration provider with YJS persistence
      const provider = UnifiedProvider.getInstance()
      
      // Set the current note context
      provider.setCurrentNote(noteId)
      
      // Check if this is a new note (check localStorage for existing data)
      const existingData = localStorage.getItem(`note-data-${noteId}`)
      const isNewNote = !existingData
      
      console.log('[AnnotationCanvas] Initializing note:', {
        noteId,
        hasExistingData: !!existingData,
        isNewNote
      })
      
      // Define default data for new notes
      const defaultData = {
        'main': {
          title: 'New Document',
          type: 'main',
          content: '', // Empty content for new documents
          branches: [],
          position: { x: 2000, y: 1500 },
          isEditable: true,
          // Mark as new to force edit mode
          isNew: isNewNote
        }
      }
      
      console.log('[AnnotationCanvas] Default data for main panel:', defaultData.main)
      
      // Initialize with defaults - the provider will merge with existing data if any
      // For new notes, this sets empty content
      // For existing notes, this preserves their content
      provider.initializeDefaultData(noteId, defaultData)
    }

    return () => {
      // Don't destroy note when switching - only cleanup when truly unmounting
      // The provider's smart cache management will handle memory efficiently
      // This allows content to persist when switching between notes
    }
  }, [noteId])

  // Load canvas state when note changes
  useEffect(() => {
    setIsStateLoaded(false)

    // Clear any pending auto-save timer
    if (autoSaveTimerRef.current) {
      window.clearTimeout(autoSaveTimerRef.current)
      autoSaveTimerRef.current = null
    }

    // Check for snapshot FIRST before initializing to default
    const snapshot = activeWorkspaceVersion !== null
      ? loadStateFromStorage(noteId, activeWorkspaceVersion)
      : loadStateFromStorage(noteId)

    if (snapshot && skipSnapshotForNote === noteId) {
      debugLog({
        component: 'AnnotationCanvas',
        action: 'snapshot_restore_skipped',
        metadata: { noteId }
      })
      initialCanvasSetupRef.current = true
      isRestoringSnapshotRef.current = false
      setIsStateLoaded(true)
      if (onSnapshotLoadComplete) {
        onSnapshotLoadComplete()
      }
      onSnapshotSettled?.(noteId)
      return
    }

    // Only initialize to default if no snapshot exists AND this is first setup
    if (!initialCanvasSetupRef.current && !snapshot) {
      setCanvasState(createDefaultCanvasState())
      setCanvasItems(createDefaultCanvasItems(noteId, workspaceMainPosition ?? undefined))
      initialCanvasSetupRef.current = true
    }
    if (!snapshot) {
      debugLog({
        component: 'AnnotationCanvas',
        action: 'no_saved_state_new_note',
        metadata: { noteId }
      })

      const hasSeedPosition =
        !!workspaceMainPosition && !isDefaultOffscreenPosition(workspaceMainPosition)
      const isFreshToolbarNote = freshNoteSet.has(noteId)
      const shouldSkipAutoCenter = isFreshToolbarNote || hasSeedPosition

      if (shouldSkipAutoCenter) {
        debugLog({
          component: 'AnnotationCanvas',
          action: 'new_note_auto_center_skipped',
          metadata: {
            noteId,
            reason: isFreshToolbarNote ? 'fresh_note' : 'seeded_position',
            seededPosition: hasSeedPosition ? workspaceMainPosition : null
          }
        })
        setIsStateLoaded(true)
        if (onSnapshotLoadComplete) {
          onSnapshotLoadComplete()
        }
        onSnapshotSettled?.(noteId)
        return
      }

      console.table([
        {
          Action: 'No Saved State',
          NoteId: noteId,
          Time: new Date().toLocaleTimeString(),
        },
      ])

      // For new notes, we still need to center the main panel
      // Use setTimeout with retries to ensure DOM is ready
      let retries = 0
      const maxRetries = 10
      const tryCenter = () => {
        retries++

        debugLog({
          component: 'AnnotationCanvas',
          action: 'centering_new_note',
          metadata: { noteId, attempt: retries }
        })

        const panelEl = document.querySelector(`[data-panel-id="main"]`) as HTMLElement
        if (!panelEl) {
          if (retries < maxRetries) {
            debugLog({
              component: 'AnnotationCanvas',
              action: 'new_note_panel_not_found_retry',
              metadata: { noteId, attempt: retries, nextRetry: '50ms' }
            })
            setTimeout(tryCenter, 50)
            return
          }

          debugLog({
            component: 'AnnotationCanvas',
            action: 'new_note_panel_not_found',
            metadata: { noteId, attemptsExhausted: retries }
          })
          if (onSnapshotLoadComplete) {
            onSnapshotLoadComplete()
          }
          onSnapshotSettled?.(noteId)
          return
        }

        // Get panel dimensions and calculate center
        const panelDimensions = {
          width: panelEl.offsetWidth,
          height: panelEl.offsetHeight
        }

        const viewportDimensions = {
          width: window.innerWidth,
          height: window.innerHeight
        }

        // CRITICAL FIX: Find the main panel for THIS note, not just any main panel
        const mainPanel = canvasItems.find(item => {
          if (item.itemType === 'panel' && item.panelId === 'main') {
            const itemNoteId = getItemNoteId(item)
            return itemNoteId === noteId
          }
          return false
        })
        const position: { x: number; y: number } = (() => {
          if (mainPanel?.position && !isDefaultOffscreenPosition(mainPanel.position)) {
            return mainPanel.position
          }
          if (workspaceMainPosition && !isDefaultOffscreenPosition(workspaceMainPosition)) {
            return workspaceMainPosition
          }

          const pendingPosition = getPendingPosition(noteId)
          if (pendingPosition && !isDefaultOffscreenPosition(pendingPosition)) {
            return pendingPosition
          }

          const cachedPosition = getCachedPosition(noteId)
          if (cachedPosition && !isDefaultOffscreenPosition(cachedPosition)) {
            return cachedPosition
          }

          return getDefaultMainPosition()
        })()

        debugLog({
          component: 'AnnotationCanvas',
          action: 'new_note_centering_source',
          metadata: {
            noteId,
            mainPanelPosition: mainPanel?.position,
            workspaceMainPosition,
            pendingPosition: getPendingPosition(noteId),
            cachedPosition: getCachedPosition(noteId),
            chosenPosition: position,
          },
        })

        const centerOffset = {
          x: (viewportDimensions.width / 2 - panelDimensions.width / 2) / canvasState.zoom,
          y: (viewportDimensions.height / 2 - panelDimensions.height / 2) / canvasState.zoom
        }

        const targetX = -position.x + centerOffset.x
        const targetY = -position.y + centerOffset.y

        debugLog({
          component: 'AnnotationCanvas',
          action: 'new_note_centering_calculated',
          metadata: {
            position,
            panelDimensions,
            viewportDimensions,
            targetX,
            targetY
          }
        })

        // Disable CSS transition
        const canvasEl = document.getElementById('infinite-canvas')
        if (canvasEl) {
          canvasEl.style.transition = 'none'
          void canvasEl.offsetHeight
        }

        // Update viewport
        flushSync(() => {
          setCanvasState(prev => ({
            ...prev,
            translateX: targetX,
            translateY: targetY
          }))
        })

        // ✅ CRITICAL FIX: Sync to context to prevent stale state on first drag
        // Without this, panCameraBy reads old translateX=-1000 from context
        // causing panels to snap on first auto-scroll
        dispatch({
          type: 'SET_CANVAS_STATE',
          payload: {
            translateX: targetX,
            translateY: targetY
          }
        })

        debugLog({
          component: 'AnnotationCanvas',
          action: 'new_note_context_synced',
          metadata: { noteId, targetX, targetY }
        })

        // Restore transition
        if (canvasEl) {
          requestAnimationFrame(() => {
            canvasEl.style.transition = ''
          })
        }

        // Notify parent
        if (onSnapshotLoadComplete) {
          onSnapshotLoadComplete()
        }
      }

      // Start the centering retry loop
      setTimeout(tryCenter, 0)

      setIsStateLoaded(true)
      return
    }

    const plainProvider = getPlainProvider()
    let providerVersion = 0
    let providerHasContent = false
    if (plainProvider) {
      try {
        providerVersion = plainProvider.getDocumentVersion(noteId, 'main')
        const existing = plainProvider.getDocument(noteId, 'main')
        providerHasContent = existing ? !plainProvider.isEmptyContent(existing) : false
      } catch (err) {
        console.warn('[AnnotationCanvas] Failed to inspect provider cache during snapshot load:', err)
      }
    }

    let pendingSnapshotBlocked = false
    if (plainProvider && typeof window !== 'undefined') {
      try {
        const pendingKey = `pending_save_${noteId}_main`
        const pendingData = window.localStorage.getItem(pendingKey)
        if (pendingData) {
          const parsed = JSON.parse(pendingData) as { timestamp?: number; version?: number }
          const timestamp = typeof parsed.timestamp === 'number' ? parsed.timestamp : 0
          if (timestamp) {
            const age = Date.now() - timestamp
            if (age < PENDING_SAVE_MAX_AGE_MS) {
              const pendingVersion = typeof parsed.version === 'number' ? parsed.version : 0
              if (pendingVersion > providerVersion) {
                pendingSnapshotBlocked = true
              } else {
                window.localStorage.removeItem(pendingKey)
              }
            } else {
              window.localStorage.removeItem(pendingKey)
            }
          } else {
            window.localStorage.removeItem(pendingKey)
          }
        }
      } catch (error) {
        console.warn('[AnnotationCanvas] Failed to inspect pending backup for snapshot guard:', error)
      }
    }

    if (pendingSnapshotBlocked) {
      console.log('[AnnotationCanvas] Deferring snapshot restore; pending save has newer content', {
        noteId,
        providerVersion,
      })
      // Reset viewport to defaults even when deferring snapshot
      setCanvasState((prev) => ({
        ...prev,
        translateX: defaultViewport.translateX,
        translateY: defaultViewport.translateY,
      }))
      setIsStateLoaded(true)
      return
    }

    console.table([
      {
        Action: 'State Loaded',
        NoteId: noteId,
        Items: snapshot.items.length,
        SavedAt: new Date(snapshot.savedAt).toLocaleTimeString(),
        ProviderVersion: providerVersion,
        ProviderHasContent: providerHasContent,
      },
    ])

    const viewport = snapshot.viewport
    const restoredTranslateX = Number.isFinite(viewport.translateX)
      ? viewport.translateX
      : defaultViewport.translateX
    const restoredTranslateY = Number.isFinite(viewport.translateY)
      ? viewport.translateY
      : defaultViewport.translateY
    const restoredZoom = Number.isFinite(viewport.zoom) ? viewport.zoom : canvasState.zoom

    // Mark initial setup as complete (prevents re-initialization on subsequent effect runs)
    if (!initialCanvasSetupRef.current) {
      initialCanvasSetupRef.current = true
    }

    // Mark that we're restoring snapshot to prevent syncing effect from running
    isRestoringSnapshotRef.current = true

    setCanvasState((prev) => ({
      ...prev,
      zoom: restoredZoom,
      translateX: restoredTranslateX,
      translateY: restoredTranslateY,
      showConnections:
        typeof viewport.showConnections === 'boolean' ? viewport.showConnections : prev.showConnections,
    }))

    dispatch({
      type: 'SET_CANVAS_STATE',
      payload: {
        translateX: restoredTranslateX,
        translateY: restoredTranslateY,
      },
    })

    persistCameraSnapshot({
      x: restoredTranslateX,
      y: restoredTranslateY,
      zoom: restoredZoom,
    })

    // Allow syncing effect to run again after snapshot restore completes
    // Use requestAnimationFrame to ensure state updates have been processed
    requestAnimationFrame(() => {
      isRestoringSnapshotRef.current = false
    })

    // Restore items from snapshot, preserving their original noteIds
    // DON'T force-change noteIds - this breaks multi-note display!
    let restoredItems = ensureMainPanel(
      snapshot.items.map((item) => ({ ...item })) as CanvasItem[],
      noteId,
      workspaceMainPosition ?? undefined
    )
    const dedupeFromSnapshot = dedupeCanvasItems(restoredItems, { fallbackNoteId: noteId })
    if (dedupeFromSnapshot.removedCount > 0) {
      debugLog({
        component: 'AnnotationCanvas',
        action: 'snapshot_items_deduped',
        metadata: {
          noteId,
          removedCount: dedupeFromSnapshot.removedCount,
          resultingCount: dedupeFromSnapshot.items.length
        }
      })
    }
    if (dedupeFromSnapshot.warnings.length > 0) {
      dedupeFromSnapshot.warnings.forEach(warning => {
        debugLog({
          component: 'AnnotationCanvas',
          action: 'snapshot_dedupe_warning',
          metadata: {
            noteId,
            code: warning.code,
            panelId: warning.panelId ?? null,
            storeKey: warning.storeKey ?? null
          },
          content_preview: warning.message
        })
      })
      updateDedupeWarnings(dedupeFromSnapshot.warnings, { append: true })
    }
    restoredItems = dedupeFromSnapshot.items

    // CRITICAL: Detect and fix corrupted snapshots with screen-space coordinates
    // Corrupted snapshots have panel positions that are screen-space instead of world-space
    // This happened due to a bug in handleCreatePanel that was converting world→screen
    const mainPanelItem = restoredItems.find(item => item.itemType === 'panel' && item.panelId === 'main')
    if (mainPanelItem && primaryHydrationStatus.panels.length > 0) {
      const dbPanel = primaryHydrationStatus.panels.find(p => p.id === 'main')
      if (dbPanel) {
        // Check if snapshot position differs significantly from database position
        const posDiff = Math.abs(mainPanelItem.position.x - dbPanel.position.x) +
                        Math.abs(mainPanelItem.position.y - dbPanel.position.y)

        // If difference > 1000px, snapshot is likely corrupted (screen-space instead of world-space)
        if (posDiff > 1000) {
          debugLog({
            component: 'AnnotationCanvas',
            action: 'CORRUPTED_SNAPSHOT_DETECTED',
            metadata: {
              snapshotPosition: mainPanelItem.position,
              dbPosition: dbPanel.position,
              difference: posDiff,
              action: 'using_database_position'
            }
          })

          // Use database position instead of corrupted snapshot position
          restoredItems = restoredItems.map(item =>
            item.itemType === 'panel' && item.panelId === 'main'
              ? { ...item, position: dbPanel.position }
              : item
          )
        }
      }
    }

    // Log what we're restoring to debug_logs table (after corruption fix)
    const finalMainPanelItem = restoredItems.find(item => item.itemType === 'panel' && item.panelId === 'main')
    debugLog({
      component: 'AnnotationCanvas',
      action: 'SNAPSHOT_RESTORE_DETAILS',
      metadata: {
        viewport: { x: restoredTranslateX, y: restoredTranslateY, zoom: restoredZoom },
        mainPanelPosition: finalMainPanelItem?.position,
        screenPosition: finalMainPanelItem?.position ? {
          x: (finalMainPanelItem.position.x + restoredTranslateX) * restoredZoom,
          y: (finalMainPanelItem.position.y + restoredTranslateY) * restoredZoom
        } : null,
        totalItems: restoredItems.length
      }
    })

    debugLog({
      component: 'AnnotationCanvas',
      action: 'SNAPSHOT_RESTORE_SETTING_CANVAS_ITEMS',
      metadata: {
        noteId,
        itemCount: restoredItems.length,
        mainPanelPosition: restoredItems.find(item => item.itemType === 'panel' && item.panelId === 'main')?.position,
        allPanelPositions: restoredItems
          .filter(item => item.itemType === 'panel')
          .map(item => ({
            panelId: item.panelId,
            noteId: item.noteId,
            position: item.position
          }))
      }
    })

    // CRITICAL FIX: Merge restored items with existing items from OTHER notes
    // Do NOT replace entire canvasItems array - this causes other notes' panels to unmount!
    setCanvasItems(prev => {
      // Keep items from OTHER notes unchanged
      const otherNotesItems = prev.filter(item => {
        const itemNoteId = getItemNoteId(item)
        return itemNoteId && itemNoteId !== noteId
      })

      debugLog({
        component: 'AnnotationCanvas',
        action: 'SNAPSHOT_RESTORE_MERGE',
        metadata: {
          noteId,
          restoredItemsCount: restoredItems.length,
          otherNotesItemsCount: otherNotesItems.length,
          totalItemsCount: otherNotesItems.length + restoredItems.length
        }
      })

      // Merge: other notes' items + this note's restored items
      return [...otherNotesItems, ...restoredItems]
    })

    const mainPanel = restoredItems.find((item) => item.itemType === 'panel' && item.panelId === 'main')

    if (plainProvider && mainPanel?.position) {
      const mainStoreKey = ensurePanelKey(noteId, 'main')
      const mainBranch = dataStore.get(mainStoreKey)
      if (mainBranch) {
        mainBranch.position = { ...mainPanel.position }
        dataStore.set(mainStoreKey, mainBranch)
        debugLog({
          component: 'AnnotationCanvas',
          action: 'restored_datastore_main_position',
          metadata: { noteId, position: mainBranch.position }
        })
      }
    }

    debugLog({
      component: 'AnnotationCanvas',
      action: 'snapshot_viewport_restored',
      metadata: {
        noteId,
        translateX: restoredTranslateX,
        translateY: restoredTranslateY,
        zoom: restoredZoom,
        items: restoredItems.length,
      }
    })

    setIsStateLoaded(true)

    if (onSnapshotLoadComplete) {
      onSnapshotLoadComplete()
    }

    onSnapshotSettled?.(noteId)

    return
  }, [noteId, onSnapshotLoadComplete, skipSnapshotForNote, onSnapshotSettled, activeWorkspaceVersion])

  // Cleanup auto-save timer on unmount
  useEffect(() => {
    return () => {
      if (autoSaveTimerRef.current) {
        window.clearTimeout(autoSaveTimerRef.current)
        autoSaveTimerRef.current = null
      }
    }
  }, [])

  const handleCanvasMouseDown = (e: React.MouseEvent) => {
    // Only respond to primary button (left-click)
    // Ignore right-click (button 2), middle-click (button 1), etc.
    if (e.button !== 0) return

    // Only start dragging if clicking on canvas background
    // Don't drag if clicking on a panel or component
    const target = e.target instanceof Element ? e.target : null
    if (target && (target.closest('.panel') || target.closest('[data-component-panel]'))) return

    setCanvasState(prev => ({
      ...prev,
      isDragging: true,
      lastMouseX: e.clientX,
      lastMouseY: e.clientY
    }))

    enableSelectionGuards()
    document.body.style.userSelect = 'none'
    try { window.getSelection()?.removeAllRanges?.() } catch {}
    e.preventDefault()
  }

  const handleCanvasMouseMove = (e: MouseEvent) => {
    if (!canvasState.isDragging) return
    
    const deltaX = e.clientX - canvasState.lastMouseX
    const deltaY = e.clientY - canvasState.lastMouseY

    updateCanvasTransform(prev => ({
      ...prev,
      translateX: prev.translateX + deltaX,
      translateY: prev.translateY + deltaY,
      lastMouseX: e.clientX,
      lastMouseY: e.clientY,
    }))
  }

  const handleCanvasMouseUp = () => {
    setCanvasState(prev => ({ ...prev, isDragging: false }))
    document.body.style.userSelect = ''
    disableSelectionGuards()
  }

  const handleWheel = (e: React.WheelEvent) => {
    // Only zoom if Shift key is held down
    if (!e.shiftKey) {
      // Allow normal scrolling when Shift is not pressed
      return
    }
    
    e.preventDefault()

    const multiplier = getWheelZoomMultiplier(e.nativeEvent)
    const newZoom = Math.max(0.3, Math.min(2, canvasState.zoom * multiplier))
    
    const rect = e.currentTarget.getBoundingClientRect()
    const mouseX = e.clientX - rect.left
    const mouseY = e.clientY - rect.top
    
    const zoomChange = newZoom / canvasState.zoom
    
    updateCanvasTransform(prev => ({
      ...prev,
      zoom: newZoom,
      translateX: mouseX - (mouseX - prev.translateX) * zoomChange,
      translateY: mouseY - (mouseY - prev.translateY) * zoomChange,
    }))
  }

  useEffect(() => {
    document.addEventListener('mousemove', handleCanvasMouseMove)
    document.addEventListener('mouseup', handleCanvasMouseUp)
    
    return () => {
      document.removeEventListener('mousemove', handleCanvasMouseMove)
      document.removeEventListener('mouseup', handleCanvasMouseUp)
    }
  }, [canvasState.isDragging, canvasState.lastMouseX, canvasState.lastMouseY])

  useEffect(() => {
    if (typeof document === 'undefined') return

    const overlay = document.createElement('div')
    overlay.id = 'sticky-note-overlay-root'
    overlay.style.position = 'fixed'
    overlay.style.inset = '0'
    overlay.style.pointerEvents = 'none'
    overlay.style.zIndex = '12000'
    overlay.style.display = 'block'

    document.body.appendChild(overlay)
    setStickyOverlayEl(overlay)

    return () => {
      document.body.removeChild(overlay)
      setStickyOverlayEl(null)
    }
  }, [])

  const handlePanelClose = (panelId: string, panelNoteId?: string) => {
    let storeKeyToDelete: string | undefined
    const closedAt = new Date().toISOString()

    debugLog({
      component: 'AnnotationCanvas',
      action: 'panel_close_start',
      metadata: {
        panelId,
        panelNoteId,
        currentNoteId: noteId,
        canvasItemsCount: canvasItems.length
      },
      content_preview: `Closing panel ${panelId} (note: ${panelNoteId || noteId})`
    })

    setCanvasItems(prev => {
      const filtered = prev.filter(item => {
        if (isPanel(item) && item.panelId === panelId) {
          const itemNoteId = getItemNoteId(item) || panelNoteId
          if (!panelNoteId || itemNoteId === panelNoteId) {
            storeKeyToDelete = item.storeKey ?? (itemNoteId ? ensurePanelKey(itemNoteId, panelId) : undefined)

            debugLog({
              component: 'AnnotationCanvas',
              action: 'panel_removed_from_items',
              metadata: {
                panelId,
                itemNoteId,
                storeKey: item.storeKey,
                storeKeyToDelete,
                position: item.position
              },
              content_preview: `Removed panel ${panelId} from canvasItems`
            })

            return false
          }
        }
        return true
      })

      debugLog({
        component: 'AnnotationCanvas',
        action: 'panel_close_items_updated',
        metadata: {
          panelId,
          beforeCount: prev.length,
          afterCount: filtered.length,
          removedCount: prev.length - filtered.length
        },
        content_preview: `canvasItems: ${prev.length} → ${filtered.length}`
      })

      return filtered
    })

    const targetNoteId = panelNoteId || noteId
    if (!targetNoteId) {
      console.warn('[AnnotationCanvas] Cannot close panel without note id', panelId)
      return
    }

    const storeKey = storeKeyToDelete ?? ensurePanelKey(targetNoteId, panelId)
    const existingPanelData = dataStore.get(storeKey)
    const existingRevision = existingPanelData?.revisionToken
    const parentId = existingPanelData?.parentId

    if (existingPanelData) {
      dataStore.update(storeKey, { state: 'closed', closedAt })
      debugLog({
        component: 'AnnotationCanvas',
        action: 'panel_state_marked_closed',
        metadata: {
          panelId,
          noteId: targetNoteId,
          storeKey,
          parentId,
          revisionToken: existingRevision
        }
      })
    }

    if (branchesMap?.has(storeKey)) {
      const branchData = branchesMap.get(storeKey)
      branchesMap.set(storeKey, { ...branchData, state: 'closed', closedAt })
    }

    const removeBranchReference = (ownerNoteId: string, ownerPanelId: string) => {
      const ownerKey = ensurePanelKey(ownerNoteId, ownerPanelId)
      const ownerData = dataStore.get(ownerKey)
      if (ownerData?.branches?.length) {
        const filtered = ownerData.branches.filter((childId: string) => childId !== panelId)
        if (filtered.length !== ownerData.branches.length) {
          dataStore.update(ownerKey, { branches: filtered })
        }
      }

      if (branchesMap?.has(ownerKey)) {
        const ownerBranch = branchesMap.get(ownerKey)
        const ownerBranches = ownerBranch?.branches
        if (Array.isArray(ownerBranches)) {
          const filtered = ownerBranches.filter((childId: string) => childId !== panelId)
          if (filtered.length !== ownerBranches.length) {
            branchesMap.set(ownerKey, { ...ownerBranch, branches: filtered })
          }
        }
      }
    }

    if (panelId !== 'main') {
      removeBranchReference(targetNoteId, 'main')
      if (parentId && parentId !== 'main') {
        removeBranchReference(targetNoteId, parentId)
      }
    }

    if (layerManagerApi.manager.getNode(storeKey)) {
      layerManagerApi.manager.removeNode(storeKey)
    }

    // CRITICAL: Also remove panel from state.panels Map so it can be reopened later
    // CRITICAL FIX: Use composite key (storeKey) not just panelId
    dispatch({
      type: 'REMOVE_PANEL',
      payload: { id: storeKey }  // Use composite key "noteId::panelId" not just "panelId"
    })

    if (typeof window !== 'undefined') {
      try {
        window.localStorage.setItem(`note-data-${targetNoteId}:invalidated`, Date.now().toString())
      } catch (error) {
        console.warn('[AnnotationCanvas] Failed to mark snapshot tombstone', error)
      }
    }

    if (panelId === 'main') {
      closeNote(targetNoteId, { persist: true }).catch(error => {
        console.warn('[AnnotationCanvas] Failed to persist workspace close', error)
      })
    }

    persistPanelUpdate({
      panelId,
      storeKey,
      state: 'closed',
      expectedRevision: existingRevision
    }).catch(err => {
      debugLog({
        component: 'AnnotationCanvas',
        action: 'panel_close_state_persist_failed',
        metadata: {
          panelId,
          noteId: targetNoteId,
          error: err instanceof Error ? err.message : 'Unknown error'
        }
      })
    })
  }

  const handleCreatePanel = (panelId: string, parentPanelId?: string, parentPosition?: { x: number, y: number }, sourceNoteId?: string, isPreview?: boolean, coordinateSpace?: 'screen' | 'world') => {
    const targetNoteId = sourceNoteId || noteId
    if (!targetNoteId) {
      console.warn('[AnnotationCanvas] Cannot create panel without target note id', panelId)
      return
    }

    console.log('[AnnotationCanvas] Creating panel:', panelId, 'for note:', targetNoteId, 'with parent:', parentPanelId, 'at position:', parentPosition)

    fetch('/api/debug/log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        component: 'AnnotationCanvas',
        action: 'handle_create_panel',
        metadata: {
          panelId,
          parentPanelId,
          parentPosition,
          isPlainMode: isPlainModeActive(),
          noteId: targetNoteId
        },
        content_preview: `Creating panel ${panelId} at x=${parentPosition?.x}, y=${parentPosition?.y}`,
        note_id: targetNoteId
      })
    }).catch(console.error)

    const isPlainMode = isPlainModeActive()

    setCanvasItems(prev => {
      const newPanelStoreKey = ensurePanelKey(targetNoteId, panelId)

      debugLog({
        component: 'AnnotationCanvas',
        action: 'create_panel_check_existing',
        metadata: {
          panelId,
          targetNoteId,
          newPanelStoreKey,
          currentCanvasItemsCount: prev.length,
          panelIdsInItems: prev.filter(isPanel).map(p => ({ panelId: p.panelId, noteId: getItemNoteId(p) }))
        },
        content_preview: `Checking if panel ${panelId} already exists in ${prev.length} items`
      })

      const existingPanelCheck = prev.some(item => isPanel(item) && item.panelId === panelId && getItemNoteId(item) === targetNoteId)

      if (existingPanelCheck) {
        debugLog({
          component: 'AnnotationCanvas',
          action: 'create_panel_early_return',
          metadata: {
            panelId,
            targetNoteId,
            reason: 'Panel already exists in canvasItems'
          },
          content_preview: `EARLY RETURN: Panel ${panelId} already exists, not creating`
        })
        return prev
      }

      debugLog({
        component: 'AnnotationCanvas',
        action: 'create_panel_proceeding',
        metadata: {
          panelId,
          targetNoteId,
          isPlainMode: isPlainModeActive()
        },
        content_preview: `Proceeding to create panel ${panelId}`
      })

      if (isPlainMode) {
        if (parentPosition && (window as any).canvasDataStore) {
          const dataStore = (window as any).canvasDataStore
          const existingPanelData = dataStore.get(newPanelStoreKey)

          if (!existingPanelData?.worldPosition) {
            // Only convert screen->world if position is in screen space
            // If coordinateSpace is 'world', parentPosition is already in world coordinates
            const worldPosition = coordinateSpace === 'world'
              ? parentPosition
              : screenToWorld(parentPosition, { x: canvasState.translateX, y: canvasState.translateY }, canvasState.zoom)

            dataStore.update(newPanelStoreKey, {
              id: panelId,
              position: worldPosition,
              worldPosition
            })
          }
        }
      } else {
        const provider = UnifiedProvider.getInstance()
        provider.setCurrentNote(targetNoteId)

        const yjsBranches = provider.getBranchesMap()
        const panelData = yjsBranches.get(newPanelStoreKey)

        if (!panelData) {
          console.warn(`No data found for panel ${panelId} (note ${targetNoteId})`)
          return prev
        }

        if (parentPosition) {
          // Only convert screen->world if position is in screen space
          // If coordinateSpace is 'world', parentPosition is already in world coordinates
          const worldPosition = coordinateSpace === 'world'
            ? parentPosition
            : screenToWorld(parentPosition, { x: canvasState.translateX, y: canvasState.translateY }, canvasState.zoom)

          panelData.position = worldPosition
          yjsBranches.set(newPanelStoreKey, panelData)
        }
      }

      const hydratedStoreKey = newPanelStoreKey
      let branchData = dataStore?.get(hydratedStoreKey)
      if (!branchData && branchesMap) {
        branchData = branchesMap.get(hydratedStoreKey)
      }

      let panelType: PanelType
      if (panelId === 'main') {
        panelType = 'main'
      } else if (branchData?.type) {
        panelType = branchData.type as PanelType
      } else {
        panelType = panelId.includes('explore') ? 'explore' : panelId.includes('promote') ? 'promote' : 'note'
      }

      const dbPanelType: 'editor' | 'branch' | 'context' | 'toolbar' | 'annotation' =
        panelId === 'main' ? 'editor' :
        panelType === 'explore' ? 'context' :
        panelType === 'promote' ? 'annotation' : 'branch'

      // For preview panels from dropdown, the parentPosition is already in screen coordinates
      // We DON'T need to convert since the dropdown is fixed and preview should appear adjacent to it
      // Panels are rendered with position:absolute inside the canvas, so we use screen coords directly
      const position = isPreview && parentPosition
        ? (() => {
            console.log('[AnnotationCanvas] Using preview screen position directly:', {
              isPreview,
              position: parentPosition,
              note: 'Screen coordinates from fixed dropdown'
            })
            return parentPosition  // Already screen coordinates, no conversion needed
          })()
        : (branchData?.position || branchData?.worldPosition)
          ? (branchData.position || branchData.worldPosition)
          : parentPosition
            ? (coordinateSpace === 'world'
                ? parentPosition  // Already in world coordinates, no conversion needed
                : screenToWorld(parentPosition, { x: canvasState.translateX, y: canvasState.translateY }, canvasState.zoom))
            : { x: 2000, y: 1500 }

      let panelTitle: string | undefined
      if (panelType !== 'main') {
        if (branchData?.preview) {
          panelTitle = branchData.preview
        } else if (branchData?.title) {
          panelTitle = branchData.title
        }
      } else {
        const mainStoreKey = ensurePanelKey(targetNoteId, 'main')
        const mainBranch = dataStore.get(mainStoreKey)
        panelTitle =
          (mainBranch && typeof mainBranch.title === 'string' && mainBranch.title.trim().length > 0
            ? mainBranch.title
            : undefined) ?? 'Main'
      }

      // Use the provided coordinateSpace, or determine it based on position source
      const effectiveCoordinateSpace = coordinateSpace ?? ((isPreview && parentPosition) ? 'screen' : 'world')

      const persistencePosition = effectiveCoordinateSpace === 'screen' && parentPosition
        ? parentPosition
        : position

      persistPanelCreate({
        panelId,
        storeKey: hydratedStoreKey,
        type: dbPanelType,
        position: persistencePosition,
        size: { width: 500, height: 400 },
        zIndex: 1,
        title: panelTitle,
        metadata: { annotationType: panelType },
        coordinateSpace: effectiveCoordinateSpace
      }).catch(err => {
        debugLog({
          component: 'AnnotationCanvas',
          action: 'panel_create_persist_failed',
          metadata: {
            panelId,
            noteId: targetNoteId,
            error: err instanceof Error ? err.message : 'Unknown error'
          }
        })
      })

      persistPanelUpdate({
        panelId,
        storeKey: hydratedStoreKey,
        position: persistencePosition,
        coordinateSpace: effectiveCoordinateSpace,
        state: 'active'
      }).catch(err => {
        debugLog({
          component: 'AnnotationCanvas',
          action: 'panel_state_active_persist_failed',
          metadata: {
            panelId,
            noteId: targetNoteId,
            error: err instanceof Error ? err.message : 'Unknown error'
          }
        })
      })

      const existingPanel = prev.find(item => item.itemType === 'panel' && item.panelId === panelId && getItemNoteId(item) === targetNoteId)
      if (existingPanel) {
        debugLog({
          component: 'AnnotationCanvas',
          action: 'panel_already_exists',
          metadata: {
            panelId,
            noteId: targetNoteId,
            existingPosition: existingPanel.position,
            requestedPosition: position
          }
        })
        return prev
      }

      return [
        ...prev,
        createPanelItem(
          panelId,
          position,
          panelType,
          targetNoteId,
          hydratedStoreKey,
        ),
      ]
    })
  }
  
  // Handle adding components
  const handleAddComponent = (type: string, position?: { x: number; y: number }) => {
    console.log('[Canvas] handleAddComponent called with type:', type, 'position:', position)

    // Calculate position - center of viewport in world coordinates
    // The canvas translate is the offset, so we need to negate it to get world position
    const viewportCenterX = window.innerWidth / 2
    const viewportCenterY = window.innerHeight / 2

    // Convert from screen space to world space
    // World position = (Screen position - Canvas translate) / zoom
    const worldX = (-canvasState.translateX + viewportCenterX) / canvasState.zoom
    const worldY = (-canvasState.translateY + viewportCenterY) / canvasState.zoom

    // Center the component (component is ~350px wide, ~300px tall)
    const finalPosition = position || {
      x: worldX - 175,
      y: worldY - 150
    }

    const stickyScreenPosition = position || {
      x: viewportCenterX - 175,
      y: viewportCenterY - 150
    }

    console.log('[Canvas] Creating component at position:', type === 'sticky-note' ? stickyScreenPosition : finalPosition)

    const newComponent = createComponentItem(
      type as 'calculator' | 'timer' | 'sticky-note' | 'dragtest' | 'perftest',
      type === 'sticky-note' ? stickyScreenPosition : finalPosition
    )

    console.log('[Canvas] Created component:', newComponent)
    console.log('[Canvas] Adding to canvasItems')
    setCanvasItems(prev => [...prev, newComponent])
  }
  
  const handleComponentClose = (id: string) => {
    setCanvasItems(prev => prev.filter(item => item.id !== id))
  }
  
  const handleComponentPositionChange = (id: string, position: { x: number; y: number }) => {
    setCanvasItems(prev => prev.map(item => 
      item.id === id ? { ...item, position } : item
    ))
  }

  const componentItems = useMemo(() => canvasItems.filter(isComponent), [canvasItems])
  const stickyNoteItems = useMemo(
    () => componentItems.filter(item => item.componentType === 'sticky-note'),
    [componentItems]
  )
  const floatingComponents = useMemo(
    () => componentItems.filter(item => item.componentType !== 'sticky-note'),
    [componentItems]
  )

  const uniqueNoteIds = useMemo(
    () => Array.from(new Set(noteIds.filter((id): id is string => typeof id === 'string' && id.length > 0))),
    [noteIds]
  )

  const secondaryNoteIds = useMemo(
    () => uniqueNoteIds.filter(id => id !== noteId),
    [uniqueNoteIds, noteId]
  )

  // Subscribe to panel creation events
  useEffect(() => {
    const handlePanelEvent = (event: CustomEvent) => {
      if (event.detail?.panelId) {
        handleCreatePanel(
          event.detail.panelId,
          event.detail.parentPanelId,
          event.detail.parentPosition,
          event.detail.noteId,
          false, // isPreview
          event.detail.coordinateSpace // Pass coordinate space flag
        )
      }
    }
    
    const handlePreviewPanelEvent = (event: CustomEvent) => {
      console.log('[AnnotationCanvas] Received preview-panel event:', event.detail)

      if (event.detail?.panelId) {
        // Create a temporary preview panel
        // Use previewPosition if provided (viewport-relative), otherwise use parentPosition
        const position = event.detail.previewPosition || event.detail.parentPosition

        console.log('[AnnotationCanvas] Creating preview panel:', {
          panelId: event.detail.panelId,
          position,
          isPreview: true
        })

        handleCreatePanel(
          event.detail.panelId,
          event.detail.parentPanelId,
          position,
          event.detail.noteId,
          true  // isPreview = true, forces use of provided position
        )
      }
    }
    
    const handleRemovePreviewPanelEvent = (event: CustomEvent) => {
      if (event.detail?.panelId) {
        // Remove the preview panel
        handlePanelClose(event.detail.panelId)
      }
    }

    window.addEventListener('create-panel' as any, handlePanelEvent)
    window.addEventListener('preview-panel' as any, handlePreviewPanelEvent)
    window.addEventListener('remove-preview-panel' as any, handleRemovePreviewPanelEvent)
    
    return () => {
      window.removeEventListener('create-panel' as any, handlePanelEvent)
      window.removeEventListener('preview-panel' as any, handlePreviewPanelEvent)
      window.removeEventListener('remove-preview-panel' as any, handleRemovePreviewPanelEvent)
    }
  }, [noteId]) // Add noteId dependency to ensure we're using the correct note

  // Create viewport snapshot for auto-save
  const viewportSnapshot = useMemo(
    () => ({
      zoom: canvasState.zoom,
      translateX: canvasState.translateX,
      translateY: canvasState.translateY,
      showConnections: canvasState.showConnections,
    }),
    [canvasState.zoom, canvasState.translateX, canvasState.translateY, canvasState.showConnections]
  )

  useEffect(() => {
    if (!isStateLoaded) return

    // Clear existing timer before scheduling a new save
    if (autoSaveTimerRef.current) {
      window.clearTimeout(autoSaveTimerRef.current)
    }

    autoSaveTimerRef.current = window.setTimeout(() => {
      const dedupeResult = dedupeCanvasItems(canvasItems, { fallbackNoteId: noteId })

      if (dedupeResult.removedCount > 0) {
        debugLog({
          component: 'AnnotationCanvas',
          action: 'canvasItems_deduped_on_save',
          metadata: {
            noteId,
            removedCount: dedupeResult.removedCount,
            resultingCount: dedupeResult.items.length
          }
        })
      }

      if (dedupeResult.warnings.length > 0) {
        dedupeResult.warnings.forEach(warning => {
          debugLog({
            component: 'AnnotationCanvas',
            action: 'canvasItems_dedupe_warning_on_save',
            metadata: {
              noteId,
              code: warning.code,
              panelId: warning.panelId ?? null,
              storeKey: warning.storeKey ?? null
            },
            content_preview: warning.message
          })
        })
        updateDedupeWarnings(dedupeResult.warnings, { append: true })
      }

      const success = saveStateToStorage(noteId, {
        viewport: viewportSnapshot,
        items: dedupeResult.items,
        workspaceVersion: activeWorkspaceVersion ?? undefined,
      })

      if (!success) {
        console.warn('[AnnotationCanvas] Failed to save canvas state')
      }

      autoSaveTimerRef.current = null
    }, CANVAS_STORAGE_DEBOUNCE)

    return () => {
      if (autoSaveTimerRef.current) {
        window.clearTimeout(autoSaveTimerRef.current)
        autoSaveTimerRef.current = null
      }
    }
  }, [noteId, viewportSnapshot, canvasItems, isStateLoaded, activeWorkspaceVersion, updateDedupeWarnings])

  // Expose methods via ref
  useImperativeHandle(ref, () => ({
    zoomIn: () => {
      updateCanvasTransform(prev => {
        const newZoom = Math.min(prev.zoom * 1.1, 2)
        const next = { ...prev, zoom: newZoom }
        onCanvasStateChange?.({ zoom: newZoom, showConnections: prev.showConnections })
        return next
      })
    },
    zoomOut: () => {
      updateCanvasTransform(prev => {
        const newZoom = Math.max(prev.zoom * 0.9, 0.3)
        const next = { ...prev, zoom: newZoom }
        onCanvasStateChange?.({ zoom: newZoom, showConnections: prev.showConnections })
        return next
      })
    },
    resetView: () => {
      updateCanvasTransform(prev => {
        const next = { ...prev, zoom: 1, translateX: -1000, translateY: -1200 }
        onCanvasStateChange?.({ zoom: 1, showConnections: prev.showConnections })
        return next
      })
    },
    panBy,
    toggleConnections: () => {
      setCanvasState(prev => {
        const newShowConnections = !prev.showConnections
        const newState = { ...prev, showConnections: newShowConnections }
        onCanvasStateChange?.({ zoom: prev.zoom, showConnections: newShowConnections })
        return newState
      })
    },
    centerOnPanel: (storeKeyOrPanelId: string) => {
      const normalizePosition = (value: any): { x: number; y: number } | null => {
        if (!value || typeof value !== 'object') return null
        const { x, y } = value as { x?: number; y?: number }
        if (typeof x !== 'number' || typeof y !== 'number') return null
        return { x, y }
      }

      const getPanelPosition = (key: string): { x: number; y: number } | null => {
        const items = canvasItemsRef.current
        const parsedKey = key.includes('::') ? parsePanelKey(key) : null
        const targetNoteId = parsedKey?.noteId ?? noteId
        const targetPanelId = parsedKey?.panelId ?? key
        const storeKey = ensurePanelKey(targetNoteId, targetPanelId)

        // 0) Matrix data - check current canvas items first
        const panel = items.find(item => {
          if (item.itemType !== 'panel') return false
          if (key.includes('::')) {
            return item.storeKey === key
          }
          if (item.storeKey === storeKey) {
            return true
          }
          return item.panelId === targetPanelId
        })

        if (panel?.position) {
          console.log('[Canvas] Found panel in canvasItems:', {
            key,
            matchedStoreKey: storeKey,
            position: panel.position,
            storeKey: panel.storeKey
          })
          return { ...panel.position }
        }

        // 1) Shared dataStore fallback
        if (dataStore) {
          const record = dataStore.get(storeKey)
          if (record && typeof record === 'object') {
            const candidates = [
              normalizePosition((record as any)?.position),
              normalizePosition((record as any)?.worldPosition),
              normalizePosition((record as any)?.mainPosition),
            ]

            for (const candidate of candidates) {
              if (candidate) {
                console.log('[Canvas] Found panel in dataStore:', {
                  key,
                  matchedStoreKey: storeKey,
                  position: candidate
                })
                return { ...candidate }
              }
            }
          }
        }

        // 2) Collaboration provider (Yjs) map
        const provider = UnifiedProvider.getInstance()
        if (!isPlainModeActive()) {
          const branchesMap = provider.getBranchesMap()
          const branch = branchesMap?.get(storeKey) ?? branchesMap?.get(key)
          if (branch?.position) {
            console.log('[Canvas] Found panel in branchesMap:', { key, storeKey, position: branch.position })
            return { ...branch.position }
          }
        }

        // 3) Workspace persistence (main panel only)
        if (targetPanelId === 'main') {
          const workspacePosition = resolveWorkspacePosition(targetNoteId)
          if (workspacePosition) {
            console.log('[Canvas] Using workspace position for panel:', {
              key,
              storeKey,
              position: workspacePosition
            })
            return { ...workspacePosition }
          }
        }

        // 4) DOM measurement fallback
        const state = canvasStateRef.current
        const el = document.querySelector(`[data-store-key="${storeKey}"]`) as HTMLElement | null
        if (el) {
          const rect = el.getBoundingClientRect()
          const container = document.getElementById('canvas-container')
          const containerRect = container?.getBoundingClientRect()

          const screenX = (rect.left + rect.width / 2) - (containerRect?.left ?? 0)
          const screenY = (rect.top + rect.height / 2) - (containerRect?.top ?? 0)

          const worldX = (screenX - state.translateX) / state.zoom
          const worldY = (screenY - state.translateY) / state.zoom

          console.log('[Canvas] Calculated panel position from DOM:', {
            key,
            storeKey,
            screenPos: { x: screenX, y: screenY },
            worldPos: { x: worldX, y: worldY },
            viewport: { x: state.translateX, y: state.translateY, zoom: state.zoom }
          })

          return { x: worldX, y: worldY }
        }

        console.warn('[Canvas] Panel not found via canvasItems/dataStore/provider/workspace/DOM:', {
          key,
          storeKey,
        })
        return null
      }

      console.log(`[Canvas] Attempting to center on panel '${storeKeyOrPanelId}'`)

      let retryCount = 0
      const maxRetries = 10
      const retryDelay = 100 // ms

      const attemptCenter = () => {
        const position = getPanelPosition(storeKeyOrPanelId)

        if (position) {
          const state = canvasStateRef.current
          console.log(`[Canvas] Panel '${storeKeyOrPanelId}' found, centering with slow animation...`)

          debugLog({
            component: 'AnnotationCanvas',
            action: 'center_on_panel',
            metadata: {
              storeKeyOrPanelId,
              position
            }
          })

          const selector = storeKeyOrPanelId.includes('::')
            ? `[data-store-key="${storeKeyOrPanelId}"]`
            : `[data-panel-id="${storeKeyOrPanelId}"]`
          const panelElement = document.querySelector(selector) as HTMLElement
          const panelDimensions = panelElement
            ? { width: panelElement.offsetWidth, height: panelElement.offsetHeight }
            : { width: 500, height: 400 }

          const viewportDimensions = { width: window.innerWidth, height: window.innerHeight }

          debugLog({
            component: 'AnnotationCanvas',
            action: 'panel_dimensions',
            metadata: {
              storeKeyOrPanelId,
              panelFound: !!panelElement,
              panelDimensions,
              viewportDimensions,
              zoom: state.zoom
            }
          })

          const centerOffset = {
            x: (viewportDimensions.width / 2 - panelDimensions.width / 2) / state.zoom,
            y: (viewportDimensions.height / 2 - panelDimensions.height / 2) / state.zoom
          }

          const targetX = -position.x + centerOffset.x
          const targetY = -position.y + centerOffset.y

          debugLog({
            component: 'AnnotationCanvas',
            action: 'calculated_target',
            metadata: {
              storeKeyOrPanelId,
              position,
              targetX,
              targetY,
              currentX: state.translateX,
              currentY: state.translateY
            }
          })

          const canvasEl = document.getElementById('infinite-canvas')

          if (canvasEl) {
            const originalTransition = canvasEl.style.transition
            canvasEl.style.transition = 'transform 2s ease-in-out'
            void canvasEl.offsetHeight

            debugLog({
              component: 'AnnotationCanvas',
              action: 'transition_enabled_slow_debug',
              metadata: { storeKeyOrPanelId, originalTransition, debugTransition: '2s ease-in-out' }
            })
          }

          flushSync(() => {
            setCanvasState(prev => {
              const next = { ...prev, translateX: targetX, translateY: targetY }
              canvasStateRef.current = next
              return next
            })
          })

          dispatch({
            type: 'SET_CANVAS_STATE',
            payload: {
              translateX: targetX,
              translateY: targetY
            }
          })

          debugLog({
            component: 'AnnotationCanvas',
            action: 'viewport_updated_instant',
            metadata: { storeKeyOrPanelId, targetX, targetY }
          })

          debugLog({
            component: 'AnnotationCanvas',
            action: 'centerOnPanel_context_synced',
            metadata: { storeKeyOrPanelId, targetX, targetY }
          })

          if (canvasEl) {
            setTimeout(() => {
              canvasEl.style.transition = ''
              debugLog({
                component: 'AnnotationCanvas',
                action: 'transition_restored_dom',
                metadata: { storeKeyOrPanelId }
              })
            }, 2100)
          }
        } else if (retryCount < maxRetries) {
          retryCount++
          console.log(`[Canvas] Panel '${storeKeyOrPanelId}' not found, retry ${retryCount}/${maxRetries}`)
          setTimeout(attemptCenter, retryDelay)
        } else {
          const state = canvasStateRef.current
          console.warn(`[Canvas] Panel '${storeKeyOrPanelId}' not found after ${maxRetries} retries, using viewport center`)

          const viewportWidth = window.innerWidth
          const viewportHeight = window.innerHeight
          const panelWidth = 800
          const panelHeight = 600

          const centerWorldX = (viewportWidth / 2 - panelWidth / 2) / state.zoom - state.translateX
          const centerWorldY = (viewportHeight / 2 - panelHeight / 2) / state.zoom - state.translateY

          console.log(`[Canvas] Panel should be created at world position (${centerWorldX}, ${centerWorldY}) to appear centered`)
        }
      }

      attemptCenter()
    },
    addComponent: (type: string, position?: { x: number; y: number }) => {
      handleAddComponent(type, position)
    }
  }), [onCanvasStateChange, canvasState, updateCanvasTransform, panBy, handleAddComponent, resolveWorkspacePosition, dataStore, noteId])

  useEffect(() => {
    debugLog({
      component: 'AnnotationApp',
      action: 'canvas_outline_applied',
      metadata: {
        outline: 'rgba(99, 102, 241, 0.85) solid 4px',
        outlineOffset: '6px'
      }
    })
  }, [])

  return (
    <>
      {secondaryNoteIds.map(id => (
        <NoteHydrator
          key={`hydrator-${id}`}
          noteId={id}
          userId={cameraUserId ?? undefined}
          dataStore={dataStore}
          branchesMap={branchesMap}
          layerManager={layerManagerApi.manager}
          enabled={true}
          workspaceVersion={workspaceNoteMap.get(id)?.version ?? null}
          onHydration={handleNoteHydration}
        />
      ))}
      <div
        className="w-screen h-screen overflow-hidden bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500"
        style={{
          opacity: canvasOpacity,
          transition: 'opacity 0.3s ease',
        }}
      >
        {dedupeWarnings.length > 0 && (
          <div className="fixed top-4 right-4 z-[1100] max-w-sm rounded-md border border-amber-500/80 bg-white/95 p-4 shadow-lg text-sm text-amber-900">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-semibold">Canvas state warnings</p>
                <p className="text-xs text-amber-700">
                  Some panels are missing metadata and were normalised. Please review before continuing.
                </p>
              </div>
              <button
                type="button"
                onClick={() => updateDedupeWarnings([], { append: false })}
                className="text-xs font-medium text-amber-700 hover:text-amber-800"
              >
                Dismiss
              </button>
            </div>
            <ul className="mt-2 space-y-1">
              {dedupeWarnings.slice(0, 5).map((warning, index) => (
                <li key={`${warning.code}-${warning.storeKey ?? warning.panelId ?? index}`} className="leading-snug">
                  {warning.message}
                </li>
              ))}
            </ul>
            {dedupeWarnings.length > 5 && (
              <p className="mt-2 text-xs text-amber-700">
                +{dedupeWarnings.length - 5} more warning{dedupeWarnings.length - 5 === 1 ? '' : 's'} logged to console.
              </p>
            )}
          </div>
        )}
        {/* Demo Header - Disabled per user request */}
        {/* <div className="fixed top-0 left-0 right-0 bg-black/90 text-white p-3 text-xs font-medium z-[1000] border-b border-white/10 flex items-center justify-between">
          <span>🚀 Yjs-Ready Unified Knowledge Canvas • Collaborative-Ready Architecture with Tiptap Editor</span>
          <span className="text-gray-300 flex items-center gap-2">
            <span className="text-yellow-400">💡</span>
            Hold <kbd className="px-2 py-0.5 bg-gray-700 rounded text-xs font-bold">Shift</kbd> + Scroll to zoom
          </span>
        </div> */}

        {/* Canvas Controls - Removed per user request */}
        {/* {!isNotesExplorerOpen && (
          <CanvasControls 
            zoom={canvasState.zoom}
            onZoomIn={() => setCanvasState(prev => ({ ...prev, zoom: Math.min(prev.zoom * 1.1, 2) }))}
            onZoomOut={() => setCanvasState(prev => ({ ...prev, zoom: Math.max(prev.zoom * 0.9, 0.3) }))}
            onResetView={() => setCanvasState(prev => ({ ...prev, zoom: 1, translateX: -1000, translateY: -1200 }))}
            onToggleConnections={() => setCanvasState(prev => ({ ...prev, showConnections: !prev.showConnections }))}
            showConnections={canvasState.showConnections}
          />
        )} */}
        
        {/* Control Panel Toggle Button - Always visible */}
        <button
          onClick={() => setShowControlPanel(!showControlPanel)}
          className="fixed top-16 right-4 z-[900] p-3 bg-gray-900 hover:bg-gray-800 text-white rounded-lg shadow-lg transition-all duration-200 hover:scale-110"
          title="Toggle Control Panel"
        >
          <Settings size={20} />
        </button>
        
        {/* Add Components Button - Moved to sidebar */}

        {/* Enhanced Control Panel V2 - Wider with always-visible metrics */}
        <EnhancedControlPanelV2 
          visible={showControlPanel}
          onClose={() => setShowControlPanel(false)}
          canvasItems={canvasItems}
          onAddComponent={handleAddComponent}
        />
        
        {/* Isolation Debug Panel - Only in development */}
        {/* Isolation Debug now integrated into Control Panel */}

        {/* Enhanced Minimap */}
        <EnhancedMinimap 
          canvasItems={canvasItems}
          canvasState={canvasState}
          onNavigate={(x, y) => updateCanvasTransform(prev => ({ ...prev, translateX: x, translateY: y }))}
        />
        
        {/* Add Components Menu */}
        <AddComponentMenu 
          visible={showAddComponentMenu}
          onClose={() => {
            if (onToggleAddComponentMenu && externalShowAddComponentMenu) {
              onToggleAddComponentMenu()
            } else {
              setInternalShowAddComponentMenu(false)
            }
          }}
          onAddComponent={handleAddComponent}
        />

        {/* Canvas Container */}
        <div
          id="canvas-container"
          className={`relative w-full h-full cursor-grab overflow-hidden ${canvasState.isDragging ? 'cursor-grabbing' : ''}`}
          style={{
            // Isolate canvas painting to avoid cross-layer re-rasterization while dragging
            contain: 'layout paint',
            isolation: 'isolate',
            // Stabilize font rendering during transforms
            WebkitFontSmoothing: 'antialiased',
            textRendering: 'optimizeLegibility',
            // Canvas boundary - thick border around viewport
            outline: 'rgba(99, 102, 241, 0.85) solid 4px',
            outlineOffset: '6px',
          }}
          onMouseDown={handleCanvasMouseDown}
          onWheel={handleWheel}
          onContextMenu={(e) => e.preventDefault()}
        >
          {/* Infinite Canvas */}
          <div
            id="infinite-canvas"
            style={{
              position: 'absolute',
              // Use translate3d without rounding for smooth motion (infinite-canvas approach)
              transform: `translate3d(${canvasState.translateX}px, ${canvasState.translateY}px, 0) scale(${canvasState.zoom})`,
              transformOrigin: '0 0',
              // Critical: NO transition during drag to prevent text blinking
              transition: canvasState.isDragging ? 'none' : 'transform 0.3s ease',
              // Optimize GPU layers only during active drag
              willChange: canvasState.isDragging ? 'transform' : 'auto',
              // Force stable GPU layer composition
              backfaceVisibility: 'hidden' as const,
              transformStyle: 'preserve-3d' as const,
            }}
          >
            {/* Grid Background - Moves with canvas */}
            <div
              style={{
                position: 'absolute',
                left: '-5000px',
                top: '-5000px',
                width: '20000px',
                height: '16000px',
                backgroundImage: `
                  linear-gradient(rgba(255, 255, 255, 0.1) 1px, transparent 1px),
                  linear-gradient(90deg, rgba(255, 255, 255, 0.1) 1px, transparent 1px)
                `,
                backgroundSize: '100px 100px',
                pointerEvents: 'none',
                zIndex: 0,
              }}
            />

            {/* Grid Coordinate Labels - Shows world coordinates */}
            {/* X-axis labels across multiple Y positions */}
            {Array.from({ length: 20 }, (_, xi) => xi * 1000).flatMap(x =>
              Array.from({ length: 10 }, (_, yi) => yi * 1000).map(y => (
                <div
                  key={`label-x${x}-y${y}`}
                  style={{
                    position: 'absolute',
                    left: `${x}px`,
                    top: `${y}px`,
                    color: 'rgba(255, 255, 255, 0.6)',
                    fontSize: '14px',
                    fontWeight: 'bold',
                    fontFamily: 'monospace',
                    pointerEvents: 'none',
                    padding: '4px 8px',
                    backgroundColor: 'rgba(0, 0, 0, 0.5)',
                    borderRadius: '4px',
                    whiteSpace: 'nowrap',
                    zIndex: 1,
                    border: '1px solid rgba(255, 255, 255, 0.2)',
                  }}
                >
                  ({x}, {y})
                </div>
              ))
            )}

            {/* Connection Lines - Widget Studio Style */}
            {canvasState.showConnections && (!isPlainModeActive() || primaryHydrationStatus.success) && (
              <WidgetStudioConnections
                key={canvasContextState.lastUpdate ?? 0}
                canvasItems={canvasItems}
                branchVersion={canvasContextState.lastUpdate ?? 0}
              />
            )}

            {/* Panels */}
        <PanelsRenderer
          defaultNoteId={noteId}
          canvasItems={canvasItems}
          dataStore={dataStore}
          onClose={handlePanelClose}
        />
            
            {/* Component Panels */}
            {floatingComponents.map(component => (
              <ComponentPanel
                key={component.id}
                id={component.id}
                type={component.componentType!}
                position={component.position}
                onClose={handleComponentClose}
                onPositionChange={handleComponentPositionChange}
              />
            ))}
          </div>
        </div>

        {stickyOverlayEl && stickyNoteItems.length > 0 && createPortal(
          stickyNoteItems.map(component => (
            <StickyNoteOverlayPanel
              key={component.id}
              id={component.id}
              position={component.position}
              onClose={handleComponentClose}
              onPositionChange={handleComponentPositionChange}
            />
          )),
          stickyOverlayEl
        )}

        {/* Annotation Toolbar - controlled by Actions button */}
        <AnnotationToolbar />

      </div>
    </>
  )
})

const ModernAnnotationCanvas = forwardRef<CanvasImperativeHandle, ModernAnnotationCanvasProps>((props, ref) => {
  const { getWorkspace } = useCanvasWorkspace()
  const workspace = useMemo(() => getWorkspace(SHARED_WORKSPACE_ID), [getWorkspace])
  const activeNoteId = props.primaryNoteId ?? props.noteIds[0] ?? ""

  useEffect(() => {
    scheduleCanvasSnapshotDedupeMigration()
  }, [])

  return (
    <IsolationProvider config={{ enabled: false }}>
      <LayerManagerProvider manager={workspace.layerManager}>
        <CanvasProvider
          noteId={activeNoteId}
          onRegisterActiveEditor={props.onRegisterActiveEditor}
          externalDataStore={workspace.dataStore}
          externalEvents={workspace.events}
        >
          <ModernAnnotationCanvasInner {...props} ref={ref} />
          {props.children}
        </CanvasProvider>
      </LayerManagerProvider>
    </IsolationProvider>
  )
})

ModernAnnotationCanvas.displayName = 'ModernAnnotationCanvas'

// Renders panels using plain dataStore in plain mode, Yjs map otherwise
function PanelsRenderer({
  defaultNoteId,
  canvasItems,
  dataStore,
  onClose,
}: {
  defaultNoteId: string
  canvasItems: CanvasItem[]
  dataStore: DataStore
  onClose: (id: string, noteId?: string) => void
}) {
  const isPlainMode = isPlainModeActive()
  const seenStoreKeys = new Set<string>()
  
  // Yjs access only when not in plain mode
  const provider = UnifiedProvider.getInstance()
  if (!isPlainMode) {
    provider.setCurrentNote(defaultNoteId)
  }
  const branchesMap = !isPlainMode ? provider.getBranchesMap() : null
  
  const panels = canvasItems.filter(isPanel)
  
  return (
    <>
      {panels.map((panel) => {
        const panelId = panel.panelId!
        const panelNoteId = panel.noteId ?? defaultNoteId
        const storeKey = panel.storeKey ?? ensurePanelKey(panelNoteId, panelId)
        const branch = isPlainMode ? dataStore.get(storeKey) : branchesMap?.get(storeKey)
        if (!branch) {
          console.warn(
            `[PanelsRenderer] Branch ${panelId} (note=${panelNoteId}, storeKey=${storeKey}) not found in ${isPlainMode ? 'plain' : 'yjs'} store`,
          )
          return null
        }

        if (seenStoreKeys.has(storeKey)) {
          console.warn(
            `[PanelsRenderer] Duplicate store key detected; skipping render`,
            { panelId, panelNoteId, storeKey },
          )
          return null
        }
        seenStoreKeys.add(storeKey)

        // Debug: Log branch type being passed to CanvasPanel
        debugLog({
          component: 'AnnotationCanvas',
          action: 'rendering_panel',
          metadata: {
            panelId,
            branchType: branch.type,
            branchDbType: branch.dbType,
            branchMetadata: branch.metadata,
            isPlainMode
          }
        })
        
        console.log(`[PanelsRenderer] Rendering panel ${panelId}:`, {
          hasContent: !!branch.content,
          contentLength: typeof branch.content === 'string' ? branch.content.length : 'N/A',
          isNew: branch.isNew,
          isEditable: branch.isEditable
        })
        
        const position = branch.position || { x: 2000, y: 1500 }
        return (
          <CanvasPanel
            key={storeKey}
            panelId={panelId}
            branch={branch}
            position={position}
            noteId={panelNoteId}
            onClose={() => onClose(panelId, panelNoteId)}
          />
        )
      })}
    </>
  )
}

export default ModernAnnotationCanvas 
