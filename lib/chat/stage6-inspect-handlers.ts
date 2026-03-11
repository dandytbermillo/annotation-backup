/**
 * Stage 6: Agent Tool Loop — Inspect Tools (Slice 6.2)
 *
 * Read-only inspect tool handlers. Each function maps live app state
 * onto the typed snapshot/response shapes from stage6-tool-contracts.ts.
 *
 * Client-side tools (snapshot-registry–backed):
 *   1. inspect_dashboard — visible widgets + dashboard metadata
 *   2. inspect_active_widget — currently focused widget
 *   3. inspect_visible_items — flat list of items in viewport
 *
 * Server-side tools (API-backed, fail-open):
 *   4. inspect_recent_items — recently accessed items
 *   5. inspect_search — name/label search
 *
 * Not wired to the loop yet (Slice 6.3).
 * Design note: stage6-agent-tool-loop-design.md
 */

import type {
  S6InspectRequest,
  S6InspectResponse,
  S6InspectActiveWidgetResponse,
  S6InspectDashboardResponse,
  S6InspectVisibleItemsResponse,
  S6InspectRecentItemsResponse,
  S6InspectSearchResponse,
  S6InspectErrorResponse,
  S6DashboardWidget,
  S6WidgetSnapshot,
  S6WidgetItem,
  S6VisibleItem,
  S6RecentItem,
  S6SearchResult,
} from './stage6-tool-contracts'
import { S6_INSPECT_LIMITS } from './stage6-tool-contracts'
import {
  getAllVisibleSnapshots,
  getActiveWidgetId,
  getWidgetSnapshot,
} from '../widgets/ui-snapshot-registry'
import type { WidgetSnapshot } from '../widgets/ui-snapshot-registry'

// ============================================================================
// Dispatch
// ============================================================================

/**
 * Route an inspect request to the appropriate handler.
 * Single entry point for the loop controller (Slice 6.3).
 */
export async function handleInspect(
  request: S6InspectRequest,
): Promise<S6InspectResponse> {
  try {
    switch (request.tool) {
      case 'inspect_dashboard':
        return await handleInspectDashboard()
      case 'inspect_active_widget':
        return handleInspectActiveWidget()
      case 'inspect_visible_items':
        return handleInspectVisibleItems()
      case 'inspect_recent_items':
        return await handleInspectRecentItems(request.windowDays)
      case 'inspect_search':
        return await handleInspectSearch(request.query, request.limit)
      default: {
        const tool =
          ((request as Record<string, unknown>).tool as string) ?? 'unknown'
        return {
          tool,
          status: 'error' as const,
          error: `Unknown inspect tool: ${tool}`,
        }
      }
    }
  } catch (err) {
    return {
      tool: request.tool,
      status: 'error' as const,
      error: `Inspect handler failed: ${(err as Error).message}`,
    }
  }
}

// ============================================================================
// §1 inspect_dashboard
// ============================================================================

async function handleInspectDashboard(): Promise<S6InspectDashboardResponse> {
  const now = Date.now()
  const visibleSnapshots = getAllVisibleSnapshots()

  const info = await fetchDashboardInfo()

  const widgets: S6DashboardWidget[] = visibleSnapshots.map((ws) => ({
    widgetId: ws.widgetId,
    label: ws.title,
    panelId: ws.panelId ?? '',
    itemCount: countWidgetItems(ws),
  }))

  return {
    tool: 'inspect_dashboard',
    status: 'ok',
    data: {
      dashboardId: info?.id ?? 'unknown',
      dashboardName: info?.name ?? 'Dashboard',
      widgets,
      widgetCount: widgets.length,
      capturedAtMs: now,
    },
  }
}

// ============================================================================
// §2 inspect_active_widget
// ============================================================================

function handleInspectActiveWidget(): S6InspectActiveWidgetResponse {
  const now = Date.now()
  const activeId = getActiveWidgetId()

  if (!activeId) {
    return { tool: 'inspect_active_widget', status: 'ok', data: null }
  }

  const ws = getWidgetSnapshot(activeId)
  if (!ws) {
    return { tool: 'inspect_active_widget', status: 'ok', data: null }
  }

  return {
    tool: 'inspect_active_widget',
    status: 'ok',
    data: mapToS6WidgetSnapshot(ws, now),
  }
}

// ============================================================================
// §3 inspect_visible_items
// ============================================================================

function handleInspectVisibleItems(): S6InspectVisibleItemsResponse {
  const now = Date.now()
  const visibleSnapshots = getAllVisibleSnapshots()
  const items: S6VisibleItem[] = []

  for (const ws of visibleSnapshots) {
    for (const segment of ws.segments) {
      if (segment.segmentType !== 'list') continue
      for (let i = 0; i < segment.items.length; i++) {
        const item = segment.items[i]
        const inViewport =
          i >= segment.visibleItemRange.start &&
          i < segment.visibleItemRange.end
        if (inViewport) {
          items.push({
            id: item.itemId,
            label: item.label,
            type: 'entry',
            visible: true,
            widgetId: ws.widgetId,
            widgetLabel: ws.title,
          })
        }
      }
    }
  }

  return {
    tool: 'inspect_visible_items',
    status: 'ok',
    data: { items, totalCount: items.length, capturedAtMs: now },
  }
}

// ============================================================================
// §4 inspect_recent_items
// ============================================================================

async function handleInspectRecentItems(
  windowDays?: number,
): Promise<S6InspectRecentItemsResponse> {
  const now = Date.now()
  const days = Math.min(
    windowDays ?? S6_INSPECT_LIMITS.RECENT_ITEMS_DEFAULT_DAYS,
    S6_INSPECT_LIMITS.RECENT_ITEMS_MAX_DAYS,
  )
  const cutoffMs = now - days * 24 * 60 * 60 * 1000

  try {
    const res = await fetch('/api/panels/recent/list', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ params: { limit: 50, type: 'entry' } }),
    })

    if (!res.ok) {
      return {
        tool: 'inspect_recent_items',
        status: 'ok',
        data: { items: [], windowDays: days, capturedAtMs: now },
      }
    }

    const body = await res.json()
    const rawItems: Array<Record<string, unknown>> = body.items ?? []

    const items: S6RecentItem[] = []
    for (const raw of rawItems) {
      const accessedAt = raw.accessedAt as string | undefined
      // Filter by windowDays cutoff
      if (accessedAt) {
        const accessedMs = new Date(accessedAt).getTime()
        if (accessedMs < cutoffMs) continue
      }
      items.push({
        id: raw.id as string,
        label: (raw.title as string) || (raw.name as string) || '',
        widgetId: findWidgetForItem(raw.id as string),
        lastAccessedAt: accessedAt ?? new Date(now).toISOString(),
      })
    }

    return {
      tool: 'inspect_recent_items',
      status: 'ok',
      data: { items, windowDays: days, capturedAtMs: now },
    }
  } catch {
    // Fail-open: return empty results
    return {
      tool: 'inspect_recent_items',
      status: 'ok',
      data: { items: [], windowDays: days, capturedAtMs: now },
    }
  }
}

// ============================================================================
// §5 inspect_search
// ============================================================================

async function handleInspectSearch(
  query: string,
  limit?: number,
): Promise<S6InspectSearchResponse> {
  const now = Date.now()
  const maxResults = Math.min(
    limit ?? S6_INSPECT_LIMITS.SEARCH_DEFAULT_RESULTS,
    S6_INSPECT_LIMITS.SEARCH_MAX_RESULTS,
  )

  if (!query.trim()) {
    return {
      tool: 'inspect_search',
      status: 'ok',
      data: { query, results: [], totalMatches: 0, capturedAtMs: now },
    }
  }

  try {
    const params = new URLSearchParams({
      search: query,
      limit: String(maxResults),
    })
    const res = await fetch(`/api/items?${params}`)

    if (!res.ok) {
      return {
        tool: 'inspect_search',
        status: 'ok',
        data: { query, results: [], totalMatches: 0, capturedAtMs: now },
      }
    }

    const body = await res.json()
    const rawItems: Array<Record<string, unknown>> = body.items ?? []
    const queryLower = query.toLowerCase()

    const results: S6SearchResult[] = rawItems.map((raw) => {
      const name = (raw.name as string) || ''
      const nameLower = name.toLowerCase()

      // Synthesize relevance score from match quality
      let score: number
      if (nameLower === queryLower) score = 1.0
      else if (nameLower.startsWith(queryLower)) score = 0.9
      else if (nameLower.includes(queryLower)) score = 0.7
      else score = 0.4 // path-only match

      return {
        id: raw.id as string,
        label: name,
        widgetId: findWidgetForItem(raw.id as string),
        snippet: name.slice(0, S6_INSPECT_LIMITS.SEARCH_SNIPPET_MAX_CHARS),
        score,
      }
    })

    return {
      tool: 'inspect_search',
      status: 'ok',
      data: { query, results, totalMatches: results.length, capturedAtMs: now },
    }
  } catch {
    // Fail-open: return empty results
    return {
      tool: 'inspect_search',
      status: 'ok',
      data: { query, results: [], totalMatches: 0, capturedAtMs: now },
    }
  }
}

// ============================================================================
// Helpers
// ============================================================================

/** Map a registry WidgetSnapshot to the S6 contract shape. */
function mapToS6WidgetSnapshot(
  ws: WidgetSnapshot,
  capturedAtMs: number,
): S6WidgetSnapshot {
  const items: S6WidgetItem[] = []
  let totalCount = 0

  for (const segment of ws.segments) {
    if (segment.segmentType !== 'list') continue
    totalCount += segment.totalCount ?? segment.items.length
    for (let i = 0; i < segment.items.length; i++) {
      const item = segment.items[i]
      items.push({
        id: item.itemId,
        label: item.label,
        type: 'entry',
        visible:
          i >= segment.visibleItemRange.start &&
          i < segment.visibleItemRange.end,
      })
    }
  }

  return {
    widgetId: ws.widgetId,
    label: ws.title,
    panelId: ws.panelId ?? '',
    items,
    itemCount: totalCount,
    // scrollPosition omitted — the snapshot registry (ui-snapshot-registry.ts)
    // does not track scroll state. When scroll tracking is added to
    // WidgetSnapshot, this mapping should propagate it here.
    capturedAtMs,
  }
}

/** Sum item counts across all list segments in a widget. */
function countWidgetItems(ws: WidgetSnapshot): number {
  let count = 0
  for (const segment of ws.segments) {
    if (segment.segmentType !== 'list') continue
    count += segment.totalCount ?? segment.items.length
  }
  return count
}

/**
 * Cross-reference an item ID against visible widget snapshots.
 * Returns the widgetId that contains this item, or '' if not found.
 *
 * Limitation: only checks currently visible snapshots. Items that exist
 * in the system but aren't displayed in any open widget return ''.
 * This is intentional for Stage 6 scope — the model can only act on
 * items visible in the current workspace. Callers (inspect_recent_items,
 * inspect_search) surface items with widgetId='' as "known but not
 * currently actionable."
 */
function findWidgetForItem(itemId: string): string {
  const snapshots = getAllVisibleSnapshots()
  for (const ws of snapshots) {
    for (const segment of ws.segments) {
      if (segment.segmentType !== 'list') continue
      for (const item of segment.items) {
        if (item.itemId === itemId) return ws.widgetId
      }
    }
  }
  return ''
}

/** Fetch dashboard workspace metadata. Fail-open: returns null. */
async function fetchDashboardInfo(): Promise<{
  id: string
  name: string
} | null> {
  try {
    const res = await fetch('/api/dashboard/info')
    if (!res.ok) return null
    const data = await res.json()
    return {
      id: data.dashboardWorkspaceId ?? '',
      name: data.dashboardWorkspaceName ?? 'Dashboard',
    }
  } catch {
    return null
  }
}
