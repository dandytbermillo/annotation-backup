/**
 * Chat View Panel Context
 *
 * Provides state management for the Universal View Panel.
 * Handles opening/closing, selection, zoom, and search filtering.
 *
 * Note: View panel state is session-only. Optional persistence (localStorage) is future work.
 */

'use client'

import { createContext, useContext, useState, useCallback, type ReactNode } from 'react'
import type {
  ViewPanelState,
  ViewPanelContextValue,
  ViewPanelContent,
  ViewListItem,
} from './view-panel-types'

// =============================================================================
// Default State
// =============================================================================

const defaultState: ViewPanelState = {
  isOpen: false,
  content: null,
  selectedItems: new Set(),
  zoom: 100,
  searchQuery: '',
}

// =============================================================================
// Context
// =============================================================================

export const ViewPanelContext = createContext<ViewPanelContextValue | null>(null)

// =============================================================================
// Provider
// =============================================================================

export function ViewPanelProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ViewPanelState>(defaultState)

  // Open panel with content
  const openPanel = useCallback((content: ViewPanelContent) => {
    setState({
      isOpen: true,
      content,
      selectedItems: new Set(),
      zoom: 100,
      searchQuery: '',
    })
  }, [])

  // Close panel (preserve content for animation)
  const closePanel = useCallback(() => {
    setState(prev => ({ ...prev, isOpen: false }))
  }, [])

  // Update content (for async content updates like file preview)
  const updateContent = useCallback((content: ViewPanelContent) => {
    setState(prev => ({ ...prev, content }))
  }, [])

  // Toggle item selection
  const toggleItemSelection = useCallback((itemId: string) => {
    setState(prev => {
      const newSelected = new Set(prev.selectedItems)
      if (newSelected.has(itemId)) {
        newSelected.delete(itemId)
      } else {
        newSelected.add(itemId)
      }
      return { ...prev, selectedItems: newSelected }
    })
  }, [])

  // Clear all selections
  const clearSelection = useCallback(() => {
    setState(prev => ({ ...prev, selectedItems: new Set() }))
  }, [])

  // Set zoom level (clamped to 50-200)
  const setZoom = useCallback((zoom: number) => {
    setState(prev => ({ ...prev, zoom: Math.max(50, Math.min(200, zoom)) }))
  }, [])

  // Set search query
  const setSearchQuery = useCallback((query: string) => {
    setState(prev => ({ ...prev, searchQuery: query }))
  }, [])

  // Derived: filtered items based on search query
  const filteredItems: ViewListItem[] = state.content?.items?.filter(item =>
    item.name.toLowerCase().includes(state.searchQuery.toLowerCase())
  ) ?? []

  // Derived: list of selected items
  const selectedItemsList: ViewListItem[] = state.content?.items?.filter(item =>
    state.selectedItems.has(item.id)
  ) ?? []

  return (
    <ViewPanelContext.Provider
      value={{
        state,
        openPanel,
        closePanel,
        updateContent,
        toggleItemSelection,
        clearSelection,
        setZoom,
        setSearchQuery,
        filteredItems,
        selectedItemsList,
      }}
    >
      {children}
    </ViewPanelContext.Provider>
  )
}

// =============================================================================
// Hook
// =============================================================================

export function useViewPanel(): ViewPanelContextValue {
  const context = useContext(ViewPanelContext)
  if (!context) {
    throw new Error('useViewPanel must be used within ViewPanelProvider')
  }
  return context
}
