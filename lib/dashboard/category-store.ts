/**
 * Category Store
 * Client-side state management for category panels and category navigator
 * Also provides panel refresh event system for Links Overview
 */

import type { CategoryPanelData, CategoryEntryReference } from './panel-registry'

// Panel refresh event listeners
const panelRefreshListeners = new Set<() => void>()

// In-memory cache for category data
let categoriesCache: {
  data: { categories: CategoryPanelData[]; entries: CategoryEntryReference[] } | null
  timestamp: number
  workspaceId: string | null
} = {
  data: null,
  timestamp: 0,
  workspaceId: null,
}

const CACHE_TTL = 30000 // 30 seconds

/**
 * Fetch all categories and their entries
 */
export async function fetchCategories(
  workspaceId?: string,
  forceRefresh = false
): Promise<{ categories: CategoryPanelData[]; entries: CategoryEntryReference[] }> {
  const now = Date.now()

  // Check cache
  if (
    !forceRefresh &&
    categoriesCache.data &&
    now - categoriesCache.timestamp < CACHE_TTL &&
    categoriesCache.workspaceId === (workspaceId || null)
  ) {
    return categoriesCache.data
  }

  // Fetch from API
  const url = new URL('/api/dashboard/categories', window.location.origin)
  if (workspaceId) {
    url.searchParams.set('workspaceId', workspaceId)
  }

  const response = await fetch(url.toString())
  if (!response.ok) {
    throw new Error('Failed to fetch categories')
  }

  const data = await response.json()

  // Update cache
  const result = {
    categories: data.categories || [],
    entries: data.entries || [],
  }

  categoriesCache = {
    data: result,
    timestamp: now,
    workspaceId: workspaceId || null,
  }

  return result
}

/**
 * Add an entry to a category
 */
export async function addEntryToCategory(
  categoryPanelId: string,
  entryId: string,
  position?: number
): Promise<void> {
  const response = await fetch('/api/dashboard/categories', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ categoryPanelId, entryId, position }),
  })

  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.error || 'Failed to add entry to category')
  }

  // Invalidate cache
  invalidateCategoriesCache()
}

/**
 * Remove an entry from a category
 */
export async function removeEntryFromCategory(
  categoryPanelId: string,
  entryId: string
): Promise<void> {
  const url = new URL('/api/dashboard/categories', window.location.origin)
  url.searchParams.set('categoryPanelId', categoryPanelId)
  url.searchParams.set('entryId', entryId)

  const response = await fetch(url.toString(), { method: 'DELETE' })

  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.error || 'Failed to remove entry from category')
  }

  // Invalidate cache
  invalidateCategoriesCache()
}

/**
 * Move an entry between categories
 */
export async function moveEntryBetweenCategories(
  entryId: string,
  fromCategoryPanelId: string | null,
  toCategoryPanelId: string,
  position?: number
): Promise<void> {
  // Remove from source category if exists
  if (fromCategoryPanelId) {
    await removeEntryFromCategory(fromCategoryPanelId, entryId)
  }

  // Add to target category
  await addEntryToCategory(toCategoryPanelId, entryId, position)
}

/**
 * Invalidate the categories cache
 */
export function invalidateCategoriesCache(): void {
  categoriesCache = {
    data: null,
    timestamp: 0,
    workspaceId: null,
  }
}

/**
 * Get entry by ID from cached data
 */
export function getCachedEntry(entryId: string): CategoryEntryReference | undefined {
  return categoriesCache.data?.entries.find(e => e.entryId === entryId)
}

/**
 * Get category by panel ID from cached data
 */
export function getCachedCategory(panelId: string): CategoryPanelData | undefined {
  return categoriesCache.data?.categories.find(c => c.panelId === panelId)
}

/**
 * Request that dashboard panels be refreshed
 * Call this when a panel is updated (title change, content change, etc.)
 */
export function requestDashboardPanelRefresh(): void {
  panelRefreshListeners.forEach((listener) => {
    try {
      listener()
    } catch {
      // Ignore listener errors
    }
  })
}

/**
 * Subscribe to dashboard panel refresh requests
 * Used by Links Overview to know when to refetch panel data
 */
export function subscribeToDashboardPanelRefresh(listener: () => void): () => void {
  panelRefreshListeners.add(listener)
  return () => {
    panelRefreshListeners.delete(listener)
  }
}
