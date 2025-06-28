"use client"

import type React from "react"

import { createContext, useContext, useReducer, useEffect, type ReactNode } from "react"
import type { CanvasState } from "@/types/canvas"
import { DataStore } from "@/lib/data-store"
import { EventEmitter } from "@/lib/event-emitter"
import { initialData } from "@/lib/initial-data"

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
  const dataStore = new DataStore()
  const events = new EventEmitter()

  useEffect(() => {
    // Initialize data store
    Object.entries(initialData).forEach(([id, data]) => {
      dataStore.set(id, data)
    })

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
  }, [dataStore])

  return <CanvasContext.Provider value={{ state, dispatch, dataStore, events, noteId }}>{children}</CanvasContext.Provider>
}

export function useCanvas() {
  const context = useContext(CanvasContext)
  if (!context) {
    throw new Error("useCanvas must be used within a CanvasProvider")
  }
  return context
}
