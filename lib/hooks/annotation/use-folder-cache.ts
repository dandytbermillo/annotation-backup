import { useMemo, useRef } from "react"
import { appendWorkspaceParam } from "@/lib/workspaces/client-utils"
import { debugLog } from "@/lib/utils/debug-logger"

export type FolderCacheEntry = {
  folder?: any | null
  children?: any[] | null
  fetchedAt?: number
}

type FolderCacheOptions = {
  workspaceId: string | null
  cacheMaxAgeMs?: number
  fetcher?: typeof fetch
  logger?: typeof debugLog
}

export type FolderCacheApi = {
  getEntry: (folderId: string) => FolderCacheEntry | null
  updateFolderSnapshot: (folderId: string, folder: any | null) => void
  updateChildrenSnapshot: (folderId: string, children: any[] | null) => void
  invalidate: (folderId?: string | null) => void
  isChildrenStale: (folderId: string) => boolean
  fetchFolder: (folderId: string) => Promise<any | null>
  fetchChildren: (folderId: string, options?: { forceRefresh?: boolean }) => Promise<any[] | null>
}

const noopLogger: typeof debugLog = async () => {}

type FolderCacheFactoryOptions = {
  workspaceId: string | null
  cache: Map<string, FolderCacheEntry>
  cacheMaxAgeMs: number
  fetcher?: typeof fetch
  logger?: typeof debugLog
  now?: () => number
}

export function createFolderCacheApi({
  workspaceId,
  cache,
  cacheMaxAgeMs,
  fetcher = fetch,
  logger = debugLog,
  now,
}: FolderCacheFactoryOptions): FolderCacheApi {
  const resolvedLogger = logger ?? noopLogger
  const clock = now ?? (() => Date.now())

  const mergeEntry = (folderId: string, partial: Partial<FolderCacheEntry>) => {
    cache.set(folderId, {
      ...(cache.get(folderId) ?? {}),
      ...partial,
    })
  }

  const getEntry = (folderId: string): FolderCacheEntry | null => cache.get(folderId) ?? null

  const updateFolderSnapshot = (folderId: string, folder: any | null) => {
    mergeEntry(folderId, { folder })
  }

  const updateChildrenSnapshot = (folderId: string, children: any[] | null) => {
    mergeEntry(folderId, { children, fetchedAt: clock() })
  }

  const invalidate = (folderId?: string | null) => {
    if (!folderId) return
    cache.delete(folderId)
  }

  const isChildrenStale = (folderId: string) => {
    const entry = cache.get(folderId)
    if (!entry?.children || typeof entry.fetchedAt !== "number") return true
    return clock() - entry.fetchedAt > cacheMaxAgeMs
  }

  const fetchFolder = async (folderId: string): Promise<any | null> => {
    const cached = cache.get(folderId)
    if (cached?.folder) {
      return cached.folder
    }
    try {
      const response = await fetcher(appendWorkspaceParam(`/api/items/${folderId}`, workspaceId))
      if (!response.ok) {
        resolvedLogger({
          component: "useFolderCache",
          action: "fetch_folder_failed",
          metadata: { folderId, status: response.status },
        })
        return null
      }
      const payload = await response.json()
      updateFolderSnapshot(folderId, payload)
      return payload
    } catch (error) {
      resolvedLogger({
        component: "useFolderCache",
        action: "fetch_folder_failed",
        metadata: {
          folderId,
          status: "network_error",
          error: error instanceof Error ? error.message : "Unknown error",
        },
      })
      return null
    }
  }

  const fetchChildren = async (
    folderId: string,
    options?: { forceRefresh?: boolean },
  ): Promise<any[] | null> => {
    const cached = cache.get(folderId)
    const canUseCache = Boolean(cached?.children) && !isChildrenStale(folderId)

    if (!options?.forceRefresh && canUseCache) {
      return cached?.children ?? null
    }

    try {
      const response = await fetcher(
        appendWorkspaceParam(`/api/items?parentId=${folderId}`, workspaceId),
      )
      if (!response.ok) {
        return cached?.children ?? null
      }
      const data = await response.json().catch(() => ({ items: [] }))
      const childItems = Array.isArray(data.items) ? data.items : []
      updateChildrenSnapshot(folderId, childItems)
      return childItems
    } catch {
      return cached?.children ?? null
    }
  }

  return {
    getEntry,
    updateFolderSnapshot,
    updateChildrenSnapshot,
    invalidate,
    isChildrenStale,
    fetchFolder,
    fetchChildren,
  }
}

/**
 * Encapsulates the folder cache Map and fetch helpers so consumers can read/update folder data
 * without duplicating TTL logic inside components.
 */
export function useFolderCache({
  workspaceId,
  cacheMaxAgeMs = 30_000,
  fetcher = fetch,
  logger = debugLog,
}: FolderCacheOptions): FolderCacheApi {
  const cacheRef = useRef<Map<string, FolderCacheEntry>>(new Map())

  return useMemo(
    () =>
      createFolderCacheApi({
        workspaceId,
        cache: cacheRef.current,
        cacheMaxAgeMs,
        fetcher,
        logger,
      }),
    [cacheMaxAgeMs, fetcher, logger, workspaceId],
  )
}
