import { useCallback, useMemo, useRef } from "react"
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

const noopLogger: typeof debugLog = () => {}

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
  const resolvedLogger = logger ?? noopLogger
  const cacheRef = useRef<Map<string, FolderCacheEntry>>(new Map())

  const mergeEntry = useCallback((folderId: string, partial: Partial<FolderCacheEntry>) => {
    cacheRef.current.set(folderId, {
      ...(cacheRef.current.get(folderId) ?? {}),
      ...partial,
    })
  }, [])

  const getEntry = useCallback(
    (folderId: string): FolderCacheEntry | null => cacheRef.current.get(folderId) ?? null,
    [],
  )

  const updateFolderSnapshot = useCallback(
    (folderId: string, folder: any | null) => {
      mergeEntry(folderId, { folder })
    },
    [mergeEntry],
  )

  const updateChildrenSnapshot = useCallback(
    (folderId: string, children: any[] | null) => {
      mergeEntry(folderId, { children, fetchedAt: Date.now() })
    },
    [mergeEntry],
  )

  const invalidate = useCallback((folderId?: string | null) => {
    if (!folderId) return
    cacheRef.current.delete(folderId)
  }, [])

  const isChildrenStale = useCallback(
    (folderId: string) => {
      const entry = cacheRef.current.get(folderId)
      if (!entry?.children || typeof entry.fetchedAt !== "number") return true
      return Date.now() - entry.fetchedAt > cacheMaxAgeMs
    },
    [cacheMaxAgeMs],
  )

  const fetchFolder = useCallback(
    async (folderId: string): Promise<any | null> => {
      const cached = cacheRef.current.get(folderId)
      if (cached?.folder) {
        return cached.folder
      }
      try {
        const response = await fetcher(
          appendWorkspaceParam(`/api/items/${folderId}`, workspaceId),
        )
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
    },
    [fetcher, resolvedLogger, updateFolderSnapshot, workspaceId],
  )

  const fetchChildren = useCallback(
    async (folderId: string, options?: { forceRefresh?: boolean }): Promise<any[] | null> => {
      const cached = cacheRef.current.get(folderId)
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
    },
    [fetcher, isChildrenStale, updateChildrenSnapshot, workspaceId],
  )

  return useMemo(
    () => ({
      getEntry,
      updateFolderSnapshot,
      updateChildrenSnapshot,
      invalidate,
      isChildrenStale,
      fetchFolder,
      fetchChildren,
    }),
    [
      fetchChildren,
      fetchFolder,
      getEntry,
      invalidate,
      isChildrenStale,
      updateChildrenSnapshot,
      updateFolderSnapshot,
    ],
  )
}

