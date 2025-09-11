"use client"

import type React from "react"

import { createContext, useContext, useReducer, useEffect, useRef, type ReactNode } from "react"
import type { CanvasState } from "@/types/canvas"
import { DataStore } from "@/lib/data-store"
import { EventEmitter } from "@/lib/event-emitter"
import { initialData } from "@/lib/initial-data"
import { getPlainProvider } from "@/lib/provider-switcher"

interface CanvasContextType {
  state: CanvasState
  dispatch: React.Dispatch<any>
  dataStore: DataStore
  events: EventEmitter
  noteId?: string
}

const CanvasContext = createContext<CanvasContextType | null>(null)

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
    default:
      return state
  }
}

interface CanvasProviderProps {
  children: ReactNode
  noteId?: string
}

export function CanvasProvider({ children, noteId }: CanvasProviderProps) {
  const [state, dispatch] = useReducer(canvasReducer, initialState)
  
  // Create stable instances that survive re-renders
  const dataStoreRef = useRef<DataStore>()
  const eventsRef = useRef<EventEmitter>()
  
  if (!dataStoreRef.current) dataStoreRef.current = new DataStore()
  if (!eventsRef.current) eventsRef.current = new EventEmitter()
  
  const dataStore = dataStoreRef.current
  const events = eventsRef.current

  // Track if branches have been loaded for current note
  const loadedNotesRef = useRef(new Set<string>())
  
  useEffect(() => {
    // Check if we're in plain mode
    const plainProvider = getPlainProvider()
    const isPlainMode = !!plainProvider
    
    if (isPlainMode && noteId && !loadedNotesRef.current.has(noteId)) {
      // Plain mode: Initialize main panel and load branches from database
      console.log('[CanvasProvider] Plain mode: Initializing main panel and loading branches')
      
      // Initialize main panel in dataStore
      dataStore.set('main', {
        id: 'main',
        type: 'main' as const,
        title: 'Main Document',
        position: { x: 2000, y: 1500 },
        dimensions: { width: 420, height: 350 },
        originalText: '',
        isEditable: true,
        branches: []
      })

      // Update main panel title from the note metadata (keep familiar title like
      // 'AI in Healthcare Research' in Option A without Yjs involvement)
      try {
        plainProvider.adapter.getNote(noteId).then((note) => {
          if (note && note.title) {
            const main = dataStore.get('main')
            if (main) {
              main.title = note.title
              dataStore.set('main', main)
              // Trigger a re-render to reflect the updated title
              dispatch({ type: 'BRANCH_UPDATED' })
            }
          }
        }).catch(() => { /* non-fatal: keep default title */ })
      } catch {
        // ignore; default title remains
      }
      
      // Make dataStore globally accessible
      if (typeof window !== 'undefined') {
        ;(window as any).canvasDataStore = dataStore
      }
      
      // Mark this note as loaded
      loadedNotesRef.current.add(noteId)
      
      // Load existing branches from database
      plainProvider.adapter.listBranches(noteId).then(branches => {
        console.log(`[CanvasProvider] Loading ${branches.length} branches from database`)
        
        // Track which branches belong to main panel
        const mainBranches: string[] = []
        const branchesByParent = new Map<string, string[]>()
        
        branches.forEach(branch => {
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
          
          // Create branch data for dataStore
          const branchData = {
            id: uiId,
            type: branch.type as 'note' | 'explore' | 'promote',
            originalText: branch.originalText || '',
            position: branch.metadata?.position || { 
              x: 2500 + Math.random() * 500, 
              y: 1500 + Math.random() * 500 
            },
            dimensions: branch.metadata?.dimensions || { width: 400, height: 300 },
            isEditable: true,
            branches: [],
            metadata: {
              ...branch.metadata,
              databaseId: branch.id,  // Keep reference to database UUID
              displayId: branch.metadata?.displayId || uiId
            }
          }
          
          // Add to dataStore
          dataStore.set(uiId, branchData)
          
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
          dispatch({
            type: "ADD_PANEL",
            payload: {
              id: uiId,
              panel: { element: null, branchId: uiId },
            },
          })
        })
        
        // Update main panel's branches
        const mainPanel = dataStore.get('main')
        if (mainPanel) {
          mainPanel.branches = mainBranches
          dataStore.set('main', mainPanel)
        }
        
        // Update all parent branches arrays
        branchesByParent.forEach((childIds, parentId) => {
          const parent = dataStore.get(parentId)
          if (parent) {
            parent.branches = childIds
            dataStore.set(parentId, parent)
          }
        })
        
        // Force re-render
        dispatch({ type: "BRANCH_UPDATED" })
      }).catch(error => {
        console.error('[CanvasProvider] Failed to load branches:', error)
      })
    } else {
      // Yjs mode: Initialize data store with initial data
      Object.entries(initialData).forEach(([id, data]) => {
        dataStore.set(id, data)
      })
    }

    // Initialize main panel
    setTimeout(() => {
      dispatch({
        type: "ADD_PANEL",
        payload: {
          id: "main",
          panel: { element: null, branchId: "main" },
        },
      })
    }, 100)
  }, [noteId])

  return <CanvasContext.Provider value={{ state, dispatch, dataStore, events, noteId }}>{children}</CanvasContext.Provider>
}

export function useCanvas() {
  const context = useContext(CanvasContext)
  if (!context) {
    throw new Error("useCanvas must be used within a CanvasProvider")
  }
  return context
}
