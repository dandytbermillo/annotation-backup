"use client"

import type React from "react"

import { createContext, useContext, useReducer, useEffect, useRef, useCallback, type ReactNode } from "react"
import type { CanvasState } from "@/types/canvas"
import { DataStore } from "@/lib/data-store"
import { EventEmitter } from "@/lib/event-emitter"
import { initialData } from "@/lib/initial-data"
import { getPlainProvider } from "@/lib/provider-switcher"
import { buildBranchPreview } from "@/lib/utils/branch-preview"
import { debugLog } from "@/lib/utils/debug-logger"
import type { AnnotationType } from "@/lib/models/annotation"
import { ensurePanelKey, parsePanelKey } from "@/lib/canvas/composite-id"

interface CanvasContextType {
  state: CanvasState
  dispatch: React.Dispatch<any>
  dataStore: DataStore
  events: EventEmitter
  noteId?: string
  onRegisterActiveEditor?: (editorRef: any, panelId: string) => void
  updateAnnotationType?: (branchId: string, newType: AnnotationType) => void
}

const CanvasContext = createContext<CanvasContextType | null>(null)

const PLAIN_SNAPSHOT_VERSION = 2

const initialState: CanvasState = {
  canvasState: {
    zoom: 1,
    translateX: -1000,
    translateY: -1200,
    isDragging: false,
    lastMouseX: 0,
    lastMouseY: 0,
    showConnections: true,
  },
  panels: new Map(),
  panelOrder: [],
  selectedText: "",
  selectedRange: null,
  currentPanel: null,
  panelZIndex: 10,
  childPositions: new Map(),
  branchFilters: new Map(),
}

const normalizeBranchId = (branchId: string | null | undefined): string => {
  if (!branchId) return ''
  if (branchId === 'main') return 'main'
  if (branchId.startsWith('branch-')) return branchId
  return `branch-${branchId}`
}

const normalizeParentId = (parentId: string | null | undefined): string | null => {
  if (!parentId || parentId === 'main') return parentId ? 'main' : null
  if (parentId.startsWith('branch-')) return parentId
  return `branch-${parentId}`
}

const normalizePanelId = (panelId: string, panelType?: string): string => {
  if (!panelId) return panelId
  if (panelId === 'main') return 'main'
  if (panelId.startsWith('branch-')) return panelId
  if (panelType && ['branch', 'context', 'annotation'].includes(panelType)) {
    return `branch-${panelId}`
  }
  return panelId
}

function canvasReducer(state: CanvasState, action: any): CanvasState {
  switch (action.type) {
    case "SET_CANVAS_STATE":
      return {
        ...state,
        canvasState: { ...state.canvasState, ...action.payload },
      }
    case "ADD_PANEL":
      const newPanels = new Map(state.panels)
      newPanels.set(action.payload.id, action.payload.panel)
      return {
        ...state,
        panels: newPanels,
        panelOrder: [...state.panelOrder, action.payload.id],
      }
    case "REMOVE_PANEL":
      const updatedPanels = new Map(state.panels)
      updatedPanels.delete(action.payload.id)
      return {
        ...state,
        panels: updatedPanels,
        panelOrder: state.panelOrder.filter((id) => id !== action.payload.id),
      }
    case "SET_SELECTION":
      return {
        ...state,
        selectedText: action.payload.text,
        selectedRange: action.payload.range,
        currentPanel: action.payload.panel,
      }
    case "UPDATE_PANEL_Z_INDEX":
      return {
        ...state,
        panelZIndex: action.payload,
      }
    case "SET_FILTER":
      const newFilters = new Map(state.branchFilters)
      newFilters.set(action.payload.panelId, action.payload.filterType)
      return {
        ...state,
        branchFilters: newFilters,
      }
    case "BRANCH_UPDATED":
      // This action is just to trigger a re-render
      // The actual data is stored in the dataStore
      return {
        ...state,
        // Force a new object to trigger re-render
        lastUpdate: Date.now(),
      }
    case "SET_PANELS":
      // Bulk set all panels (used for loading saved state)
      return {
        ...state,
        panels: action.payload,
        panelOrder: Array.from(action.payload.keys()),
      }
    default:
      return state
  }
}

interface CanvasProviderProps {
  children: ReactNode
  noteId?: string
  onRegisterActiveEditor?: (editorRef: any, panelId: string) => void
  externalDataStore?: DataStore
  externalEvents?: EventEmitter
}

export function CanvasProvider({ children, noteId, onRegisterActiveEditor, externalDataStore, externalEvents }: CanvasProviderProps) {
  console.log('[CanvasProvider] Component render', {
    noteId,
    hasExternalDataStore: !!externalDataStore,
    timestamp: Date.now()
  })

  const [state, dispatch] = useReducer(canvasReducer, initialState)

  // Create stable instances that survive re-renders
  const dataStoreRef = useRef<DataStore | null>(null)
  const eventsRef = useRef<EventEmitter | null>(null)

  if (externalDataStore) {
    dataStoreRef.current = externalDataStore
  } else if (!dataStoreRef.current) {
    dataStoreRef.current = new DataStore()
  }

  if (externalEvents) {
    eventsRef.current = externalEvents
  } else if (!eventsRef.current) {
    eventsRef.current = new EventEmitter()
  }

  const dataStore = dataStoreRef.current!
  const events = eventsRef.current!

  // Get loadedNotes from external dataStore's workspace (survives unmount/remount)
  // This is critical: if CanvasProvider unmounts/remounts, we don't lose track of which notes are loaded
  const loadedNotesSet = (dataStore as any).__loadedNotes as Set<string> | undefined
  if (!loadedNotesSet) {
    (dataStore as any).__loadedNotes = new Set<string>()
  }
  const loadedNotes = (dataStore as any).__loadedNotes as Set<string>

  // Track editor instances for annotation updates
  const editorsRef = useRef<Map<string, any>>(new Map())

  // Log mount/unmount to detect if component is being recreated
  useEffect(() => {
    const mountId = Math.random().toString(36).substring(7)
    console.log('[CanvasProvider] Component MOUNTED', {
      mountId,
      noteId,
      timestamp: Date.now(),
      loadedNotes: Array.from(loadedNotes)
    })
    return () => {
      console.log('[CanvasProvider] Component UNMOUNTING', {
        mountId,
        noteId,
        loadedNotes: Array.from(loadedNotes),
        timestamp: Date.now()
      })
    }
  }, []) // Empty deps = mount/unmount only
  
  useEffect(() => {
    // Check if we're in plain mode
    const plainProvider = getPlainProvider()
    const isPlainMode = !!plainProvider

    // Check if dataStore already has data for this note's main panel
    const mainStoreKey = ensurePanelKey(noteId || '', 'main')
    const existingMainPanel = noteId ? dataStore.get(mainStoreKey) : null
    const shouldSkipInit = loadedNotes.has(noteId || '') || !!existingMainPanel

    // DEBUG: Log every time effect runs
    console.log('[CanvasProvider] useEffect triggered', {
      noteId,
      isPlainMode,
      hasLoadedBefore: noteId ? loadedNotes.has(noteId) : null,
      hasExistingData: !!existingMainPanel,
      shouldSkipInit,
      loadedNotes: Array.from(loadedNotes),
      willRunInitialization: isPlainMode && noteId && !shouldSkipInit
    })

    if (isPlainMode && noteId && !shouldSkipInit) {
      // Plain mode: Initialize main panel and load branches from database
      console.log('[CanvasProvider] Plain mode: Initializing main panel and loading branches for FIRST TIME')
      
      // Restore any cached snapshot before building data
      const snapshotMap = new Map<string, any>()
      if (typeof window !== 'undefined') {
        try {
          const rawSnapshot = window.localStorage.getItem(`note-data-${noteId}`)
          if (rawSnapshot) {
            const parsedSnapshot = JSON.parse(rawSnapshot)
            const snapshotVersion = typeof parsedSnapshot?.version === 'number'
              ? parsedSnapshot.version
              : 1
            const parsedPanels = parsedSnapshot?.panels && typeof parsedSnapshot.panels === 'object'
              ? parsedSnapshot.panels
              : parsedSnapshot

            if (snapshotVersion < PLAIN_SNAPSHOT_VERSION) {
              console.log('[CanvasProvider] Ignoring outdated plain snapshot', {
                noteId,
                snapshotVersion,
                requiredVersion: PLAIN_SNAPSHOT_VERSION
              })
            } else if (parsedPanels && typeof parsedPanels === 'object') {
              Object.entries(parsedPanels).forEach(([branchId, value]) => {
                const entry = value as Record<string, any>
                if ((entry?.state ?? 'active') !== 'active') {
                  if (process.env.NODE_ENV !== 'production') {
                    console.debug('[CanvasProvider] Skipping cached branch with inactive state', {
                      branchId,
                      state: entry?.state
                    })
                  }
                  return
                }
                snapshotMap.set(branchId, entry)
              })
            }
          }
        } catch (snapshotError) {
          console.warn('[CanvasProvider] Failed to parse cached plain snapshot:', snapshotError)
        }
      }

      // Initialize main panel in dataStore
      const persistPlainBranchSnapshot = () => {
        if (typeof window === 'undefined' || !noteId) return

        // Check for invalidation tombstone with timestamp expiry (5 seconds)
        const tombstoneKey = `note-data-${noteId}:invalidated`
        const tombstoneValue = window.localStorage.getItem(tombstoneKey)

        if (tombstoneValue) {
          const tombstoneAge = Date.now() - parseInt(tombstoneValue, 10)

          if (tombstoneAge < 5000) {
            // Tombstone is fresh - skip persistence
            console.log('[CanvasProvider] Skipping snapshot persist - cache invalidated')
            return
          } else {
            // Tombstone expired - clean it up and continue
            window.localStorage.removeItem(tombstoneKey)
            console.log('[CanvasProvider] Tombstone expired, resuming cache persistence')
          }
        }

        const snapshot: Record<string, any> = {}
        dataStore.forEach((value, key) => {
          snapshot[key] = {
            title: value.title || '',
            type: value.type,
            originalText: value.originalText || '',
            content: value.content,
            preview: value.preview || '',
            hasHydratedContent: !!value.hasHydratedContent,
            branches: value.branches || [],
            parentId: value.parentId ?? null,
            position: value.position,
            dimensions: value.dimensions,
            isEditable: value.isEditable,
            state: value.state ?? 'active',
            closedAt: value.closedAt ?? null,
          }
        })
        try {
          const payload = JSON.stringify({
            version: PLAIN_SNAPSHOT_VERSION,
            panels: snapshot
          })
          window.localStorage.setItem(`note-data-${noteId}`, payload)
          window.dispatchEvent(new CustomEvent('plain-branch-snapshot', {
            detail: {
              noteId,
              snapshot: {
                version: PLAIN_SNAPSHOT_VERSION,
                panels: snapshot
              }
            }
          }))
          try {
            fetch('/api/debug-log', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                component: 'CanvasProvider',
                action: 'PLAIN_BRANCH_SNAPSHOT',
                noteId,
                metadata: { branchCount: Object.keys(snapshot).length }
              })
            })
          } catch (logError) {
            console.warn('[CanvasProvider] Failed to log snapshot:', logError)
          }
        } catch (error) {
          console.warn('[CanvasProvider] Failed to persist plain snapshot:', error)
        }
      }

      const cachedMain = snapshotMap.get('main') as Record<string, any> | undefined
      const mainStoreKey = ensurePanelKey(noteId || '', 'main')

      const titleValue = cachedMain?.title || 'Main Document'
      const positionValue = cachedMain?.position || { x: 2000, y: 1500 }
      const mainBranches = Array.isArray(cachedMain?.branches)
        ? cachedMain!.branches.map(normalizeBranchId).filter(Boolean)
        : []

      console.log('[CanvasProvider] Setting initial dataStore for main panel', {
        noteId,
        mainStoreKey,
        hasCachedMain: !!cachedMain,
        titleValue,
        positionValue,
        usingDefaultTitle: titleValue === 'Main Document',
        usingDefaultPosition: positionValue.x === 2000 && positionValue.y === 1500
      })

      dataStore.set(mainStoreKey, {
        id: 'main',
        type: 'main' as const,
        title: titleValue,
        position: positionValue,
        dimensions: cachedMain?.dimensions || { width: 420, height: 350 },
        originalText: cachedMain?.originalText || '',
        isEditable: cachedMain?.isEditable ?? true,
        branches: mainBranches,
        parentId: null,
        content: cachedMain?.content,
        preview: cachedMain?.preview || '',
        hasHydratedContent: cachedMain?.hasHydratedContent ?? false,
        state: 'active',
        closedAt: null,
      })

      // Pre-populate additional branches from cache before remote load
      snapshotMap.forEach((value, rawKey) => {
        if (rawKey === 'main') return
        const cachedBranch = value as Record<string, any>
        if ((cachedBranch.state ?? 'active') !== 'active') {
          if (process.env.NODE_ENV !== 'production') {
            console.debug('[CanvasProvider] Skipping cached branch during preload', {
              branchId: rawKey,
              state: cachedBranch.state
            })
          }
          return
        }
        const parsedKey = rawKey.includes('::') ? parsePanelKey(rawKey) : { noteId: noteId || '', panelId: rawKey }
        const sourceNoteId = parsedKey.noteId || noteId || ''
        const normalizedPanelId = normalizePanelId(parsedKey.panelId, cachedBranch.type)
        const branchStoreKey = ensurePanelKey(sourceNoteId, normalizedPanelId)
        const legacyStoreKey = ensurePanelKey(sourceNoteId, parsedKey.panelId)

        let existing = dataStore.get(branchStoreKey)
        if (!existing && legacyStoreKey !== branchStoreKey) {
          const legacy = dataStore.get(legacyStoreKey)
          if (legacy) {
            dataStore.delete(legacyStoreKey)
            existing = legacy
          }
        }

        const normalizedParentId = normalizeParentId(cachedBranch.parentId)
        const normalizedBranches = Array.isArray(cachedBranch.branches)
          ? cachedBranch.branches.map(normalizeBranchId).filter(Boolean)
          : []

        const mergedMetadata = {
          ...(existing?.metadata || {}),
          ...(cachedBranch.metadata || {}),
          displayId: normalizedPanelId,
        } as Record<string, any>

        if (normalizedParentId) {
          mergedMetadata.parentId = normalizedParentId
          mergedMetadata.parentPanelId = normalizedParentId
        } else {
          delete mergedMetadata.parentId
          delete mergedMetadata.parentPanelId
        }

        const merged = {
          ...existing,
          id: normalizedPanelId,
          type: cachedBranch.type,
          title: cachedBranch.title || '',
          originalText: cachedBranch.originalText || '',
          content: cachedBranch.content,
          preview: cachedBranch.preview || '',
          hasHydratedContent: cachedBranch.hasHydratedContent ?? false,
          branches: normalizedBranches,
          parentId: normalizedParentId,
          position: cachedBranch.position || existing?.position || { x: 2500 + Math.random() * 500, y: 1500 + Math.random() * 500 },
          dimensions: cachedBranch.dimensions || existing?.dimensions || { width: 400, height: 300 },
          isEditable: cachedBranch.isEditable ?? true,
          metadata: mergedMetadata,
          worldPosition: existing?.worldPosition ?? cachedBranch.worldPosition,
          worldSize: existing?.worldSize ?? cachedBranch.worldSize,
          state: 'active',
          closedAt: null
        }
        dataStore.set(branchStoreKey, merged)
      })

      persistPlainBranchSnapshot()

      let snapshotTimeout: NodeJS.Timeout | null = null
      const scheduleSnapshotSave = () => {
        if (snapshotTimeout) clearTimeout(snapshotTimeout)
        snapshotTimeout = setTimeout(() => {
          persistPlainBranchSnapshot()
        }, 150)
      }

      const handleDataStoreChange = () => scheduleSnapshotSave()
      dataStore.on('set', handleDataStoreChange)
      dataStore.on('update', handleDataStoreChange)
      dataStore.on('delete', handleDataStoreChange)

      // Update main panel title from the note metadata (keep familiar title like
      // 'AI in Healthcare Research' in Option A without Yjs involvement)
      try {
        const plainAdapter = (plainProvider as any)?.adapter
        plainAdapter?.getNote?.(noteId).then((note: any) => {
          if (note && note.title) {
            const main = dataStore.get(mainStoreKey)
            if (main) {
              main.title = note.title
              dataStore.set(mainStoreKey, main)
              // Trigger a re-render to reflect the updated title
              dispatch({ type: 'BRANCH_UPDATED' })
              persistPlainBranchSnapshot()
            }
          }
        }).catch(() => { /* non-fatal: keep default title */ })
      } catch {
        // ignore; default title remains
      }
      
      // Make dataStore globally accessible
      if (typeof window !== 'undefined') {
        ;(window as any).canvasDataStore = dataStore
        ;(window as any).canvasState = state
        ;(window as any).canvasDispatch = dispatch
      }

      // Mark this note as loaded
      loadedNotes.add(noteId)
      console.log('[CanvasProvider] Marked note as loaded', {
        noteId,
        loadedNotes: Array.from(loadedNotes)
      })
      
      // Load existing branches from database
      const plainAdapter = (plainProvider as any)?.adapter
      plainAdapter?.listBranches?.(noteId).then((branches: any[]) => {
        console.log(`[CanvasProvider] Loading ${branches.length} branches from database`)
        
        // Track which branches belong to main panel
        const mainBranches: string[] = []
        const branchesByParent = new Map<string, string[]>()
        const activeBranchStoreKeys = new Set<string>()
        
        branches.forEach(branch => {
          if ((branch.state ?? 'active') !== 'active') {
            if (process.env.NODE_ENV !== 'production') {
              console.debug('[CanvasProvider] Skipping non-active branch from DB', {
                branchId: branch.id,
                state: branch.state
              })
            }
            return
          }
          // Transform database format to UI format
          const uiId = `branch-${branch.id}`

          // Normalize parentId in DB (TEXT) to UI id:
          // - 'main' stays 'main'
          // - 'branch-...' stays as-is
          // - raw UUID becomes 'branch-<uuid>'
          let parentId: string = 'main'
          if (branch.parentId) {
            const raw = String(branch.parentId)
            if (raw === 'main') parentId = 'main'
            else if (raw.startsWith('branch-')) parentId = raw
            else parentId = `branch-${raw}`
          }

          if (process.env.NODE_ENV !== 'production') {
            console.debug('[CanvasProvider] branch loader raw parent', {
              branchId: uiId,
              dbParentId: branch.parentId,
              normalizedParentId: parentId,
            })
          }
          
          const metadata = branch.metadata || {}
          const cachedBranch = snapshotMap.get(uiId) as Record<string, any> | undefined

          const normalizeSoft = (value: string | undefined | null) =>
            value ? value.replace(/\s+/g, ' ').trim() : ''

          const normalizedOriginal = normalizeSoft(branch.originalText)

          const rawCachedPreview = normalizeSoft(cachedBranch?.preview)
          const previewFromCache = rawCachedPreview && rawCachedPreview.toLowerCase() === normalizedOriginal.toLowerCase()
            ? ''
            : rawCachedPreview

          const metadataPreviewRaw = typeof metadata.preview === 'string' ? normalizeSoft(metadata.preview) : ''
          const sanitizedMetadataPreview = metadataPreviewRaw && metadataPreviewRaw.toLowerCase() === normalizedOriginal.toLowerCase()
            ? ''
            : metadataPreviewRaw

          const previewSource = previewFromCache
            || sanitizedMetadataPreview
            || buildBranchPreview(cachedBranch?.content)
            || ''
          const normalizedPreview = previewSource ? previewSource.replace(/\s+/g, ' ').trim() : ''

          // Create branch data for dataStore
          const branchMetadata = {
            ...metadata,
            databaseId: branch.id,  // Keep reference to database UUID
            displayId: branch.metadata?.displayId || uiId,
          }

          if (normalizedPreview) {
            branchMetadata.preview = normalizedPreview
          } else {
            delete branchMetadata.preview
          }

          const branchStoreKey = ensurePanelKey(noteId || '', uiId)
          const existing = dataStore.get(branchStoreKey)
          activeBranchStoreKeys.add(branchStoreKey)

          debugLog({
            component: 'CanvasContext',
            action: 'branch_loader_reading_existing',
            metadata: {
              branchId: uiId,
              hasExisting: !!existing,
              existingWorldPosition: existing?.worldPosition,
              existingPosition: existing?.position,
              cachedWorldPosition: cachedBranch?.worldPosition,
              cachedPosition: cachedBranch?.position
            }
          })

          // CRITICAL: Branch loader should NEVER set position data
          // Hydration handles ALL position data. Branch loader only updates annotation fields.
          // If existing data exists (from hydration or previous load), only update annotation fields
          if (existing) {
            // Update only annotation-related fields, preserve all position data
            dataStore.update(branchStoreKey, {
              id: uiId,
              type: branch.type as 'note' | 'explore' | 'promote',
              originalText: branch.originalText || '',
              title: branch.title || cachedBranch?.title || '',
              content: cachedBranch?.content,
              preview: normalizedPreview,
              hasHydratedContent: cachedBranch?.hasHydratedContent ?? false,
              isEditable: true,
              branches: existing.branches || [],
              parentId,
              metadata: branchMetadata,
              state: 'active',
              closedAt: null
              // DO NOT touch: position, worldPosition, dimensions, worldSize, zIndex
            })

            debugLog({
              component: 'CanvasContext',
              action: 'branch_loader_updated_existing',
              metadata: {
                branchId: uiId,
                preservedWorldPosition: existing.worldPosition,
                preservedPosition: existing.position
              }
            })
          } else {
            // No existing data - this is a NEW branch, set minimal data
            // Position will be handled by panel creation in annotation-canvas-modern.tsx
            dataStore.set(branchStoreKey, {
              id: uiId,
              type: branch.type as 'note' | 'explore' | 'promote',
              originalText: branch.originalText || '',
              title: branch.title || cachedBranch?.title || '',
              content: cachedBranch?.content,
              preview: normalizedPreview,
              hasHydratedContent: cachedBranch?.hasHydratedContent ?? false,
              isEditable: true,
              branches: [],
              parentId,
              metadata: branchMetadata,
              state: 'active',
              closedAt: null
              // Position will be set by handleCreatePanel in annotation-canvas-modern.tsx
            })

            debugLog({
              component: 'CanvasContext',
              action: 'branch_loader_created_new',
              metadata: {
                branchId: uiId,
                note: 'Position will be set by panel creation'
              }
            })
          }
          
          // Track parent-child relationships
          if (parentId === 'main') {
            mainBranches.push(uiId)
          } else {
            if (!branchesByParent.has(parentId)) {
              branchesByParent.set(parentId, [])
            }
            branchesByParent.get(parentId)?.push(uiId)
          }
          
          // Also add panel entry
          // CRITICAL FIX: Use composite key (branchStoreKey) not just uiId
          dispatch({
            type: "ADD_PANEL",
            payload: {
              id: branchStoreKey,  // Use composite key "noteId::panelId" not just "uiId"
              panel: { element: null, branchId: uiId },
            },
          })
        })
        
        // Remove any stale or closed branches that weren't returned by the server
        const keysToRemove: string[] = []
        dataStore.forEach((value, key) => {
          const parsedKey = parsePanelKey(key)
          const belongsToCurrentNote = parsedKey.noteId
            ? parsedKey.noteId === noteId
            : (noteId ? key === 'main' || key.startsWith('branch-') : false)

          if (!belongsToCurrentNote) {
            return
          }

          const isMainPanel = key === ensurePanelKey(noteId || '', 'main') || parsedKey.panelId === 'main'
          if (isMainPanel) {
            return
          }

          const panelState = value?.state ?? 'active'
          if (panelState === 'closed' || !activeBranchStoreKeys.has(key)) {
            keysToRemove.push(key)
          }
        })

        if (keysToRemove.length > 0) {
          keysToRemove.forEach(key => {
            dataStore.delete(key)
          })

          debugLog({
            component: 'CanvasContext',
            action: 'removed_stale_plain_branches',
            metadata: {
              noteId,
              removedKeys: keysToRemove
            }
          })

          persistPlainBranchSnapshot()
        }

        // Update main panel's branches
        const mainStoreKey = ensurePanelKey(noteId || '', 'main')
        const mainPanel = dataStore.get(mainStoreKey)
        if (mainPanel) {
          mainPanel.branches = mainBranches
          dataStore.set(mainStoreKey, mainPanel)
        }

        // Update all parent branches arrays
        branchesByParent.forEach((childIds, parentId) => {
          const parentStoreKey = ensurePanelKey(noteId || '', parentId)
          const parent = dataStore.get(parentStoreKey)
          if (parent) {
            parent.branches = childIds
            dataStore.set(parentStoreKey, parent)
          }
        })
        
        // Force re-render
        dispatch({ type: "BRANCH_UPDATED" })
        persistPlainBranchSnapshot()
      }).catch((error: unknown) => {
        console.error('[CanvasProvider] Failed to load branches:', error)
        if (typeof window !== 'undefined') {
          window.localStorage.removeItem(`note-data-${noteId}`)
        }
      })

      return () => {
        dataStore.off('set', handleDataStoreChange)
        dataStore.off('update', handleDataStoreChange)
        dataStore.off('delete', handleDataStoreChange)
        if (snapshotTimeout) clearTimeout(snapshotTimeout)
      }
    } else if (isPlainMode && noteId) {
      // Plain mode but note already loaded - SKIP initialization
      console.log('[CanvasProvider] Skipping initialization - note already loaded', {
        noteId,
        loadedNotes: Array.from(loadedNotes)
      })
    } else {
      // Yjs mode: Initialize data store with initial data
      Object.entries(initialData).forEach(([id, data]) => {
        const storeKey = ensurePanelKey(noteId || '', id)
        dataStore.set(storeKey, data)
      })
    }

    // Initialize main panel
    setTimeout(() => {
      // CRITICAL FIX: Use composite key for main panel too
      const mainKey = noteId ? ensurePanelKey(noteId, 'main') : 'main'
      dispatch({
        type: "ADD_PANEL",
        payload: {
          id: mainKey,  // Use composite key "noteId::main" if noteId available
          panel: { element: null, branchId: "main" },
        },
      })
    }, 100)
  }, [noteId])

  // Keep global state reference fresh (update whenever state changes)
  // Note: FloatingToolbar now subscribes to DataStore events directly instead of canvas state events
  useEffect(() => {
    if (typeof window !== 'undefined') {
      ;(window as any).canvasState = state
      ;(window as any).canvasDispatch = dispatch
    }
  }, [state, dispatch])

  /**
   * Register an editor instance for annotation updates
   * This allows updateAnnotationType to call commands on the correct editor
   */
  const registerEditor = useCallback((editor: any, panelId: string) => {
    editorsRef.current.set(panelId, editor)

    // Clean up on unmount
    return () => {
      editorsRef.current.delete(panelId)
    }
  }, [])

  /**
   * Update annotation type in the main editor
   * Type-safe, uses TipTap commands with fallback to direct manipulation
   */
  const updateAnnotationType = useCallback((branchId: string, newType: AnnotationType) => {
    if (!branchId || !newType) {
      console.warn('[CanvasProvider] updateAnnotationType: Invalid parameters', { branchId, newType })
      return
    }

    try {
      // Get the main editor instance
      const mainEditor = editorsRef.current.get('main')

      if (!mainEditor) {
        console.warn('[CanvasProvider] updateAnnotationType: Main editor not registered')
        return
      }

      // Use TipTap extension command (production-quality)
      const success = mainEditor.commands.updateAnnotationType(branchId, newType)

      if (!success) {
        console.warn('[CanvasProvider] Failed to update annotation type')
      }
    } catch (error) {
      console.error('[CanvasProvider] updateAnnotationType: Error', error)
    }
  }, [])

  const contextValue = {
    state,
    dispatch,
    dataStore,
    events,
    noteId,
    onRegisterActiveEditor: (editorRef: any, panelId: string) => {
      registerEditor(editorRef, panelId)
      onRegisterActiveEditor?.(editorRef, panelId)
    },
    updateAnnotationType,
  }

  return <CanvasContext.Provider value={contextValue}>{children}</CanvasContext.Provider>
}

export function useCanvas() {
  const context = useContext(CanvasContext)
  if (!context) {
    throw new Error("useCanvas must be used within a CanvasProvider")
  }
  return context
}
