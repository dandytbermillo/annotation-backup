import { useEffect, useMemo, useReducer, useRef, useCallback, useState } from "react"
import { ensurePanelKey } from "@/lib/canvas/composite-id"
import type { OrganizationSidebarItem } from "@/components/sidebar/organization-sidebar-content"

type SidebarLoaderDeps = {
  appendWorkspaceParam: (url: string, workspaceId: string | null) => string
  fetchWithWorkspace: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
  knowledgeBaseWorkspaceId: string | null
  resolveWorkspaceId: (workspaceId: string | null) => void
  updateFolderCacheEntry: (folderId: string, data: any) => void
  updateFolderCacheChildren: (folderId: string, children: any[]) => void
}

type NoteTitleDeps = {
  fetchWithKnowledgeBase: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
}

export function useKnowledgeBaseSidebar({
  loader,
  noteTitles,
  sharedWorkspace,
  enabled = true,
}: {
  loader: SidebarLoaderDeps
  noteTitles: NoteTitleDeps
  sharedWorkspace: { dataStore?: any } | null
  enabled?: boolean
}) {
  const [organizationFolders, setOrganizationFolders] = useState<OrganizationSidebarItem[]>([])
  const [knowledgeBaseId, setKnowledgeBaseId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    if (!enabled) {
      setOrganizationFolders([])
      setKnowledgeBaseId(null)
      return () => {
        cancelled = true
      }
    }

    const mapCount = (item: any): number => {
      if (typeof item?.itemCount === "number") return item.itemCount
      if (typeof item?.itemsCount === "number") return item.itemsCount
      if (typeof item?.childrenCount === "number") return item.childrenCount
      if (typeof item?.childCount === "number") return item.childCount
      if (typeof item?.stats?.itemCount === "number") return item.stats.itemCount
      if (Array.isArray(item?.children)) return item.children.length
      return 0
    }

    const deriveFromPath = (path: string | undefined | null): string | null => {
      if (!path || typeof path !== "string") return null
      const trimmed = path.trim()
      if (!trimmed) return null
      const normalized = trimmed.replace(/\/+$/, "")
      if (!normalized) return null
      const segments = normalized.split("/")
      const lastSegment = segments[segments.length - 1]
      return lastSegment && lastSegment.trim() ? lastSegment.trim() : null
    }

    const toSidebarItem = (item: any): OrganizationSidebarItem => ({
      id: item.id,
      name: item.name ?? deriveFromPath(item.path) ?? "Untitled",
      icon: item.icon || (item.type === "folder" ? "📁" : "📄"),
      count: mapCount(item),
      color: item.color ?? null,
      path: item.path ?? null,
      level: typeof item.level === "number" ? item.level : 0,
      type: item.type === "note" ? "note" : "folder",
      parentId: item.parentId ?? null,
      hasChildren: item.hasChildren ?? Boolean(item.children?.length || mapCount(item)),
    })

    const loadOrganizationSidebar = async () => {
      try {
        const rootResponse = await loader.fetchWithWorkspace(
          loader.appendWorkspaceParam("/api/items?parentId=null", loader.knowledgeBaseWorkspaceId),
        )
        if (!rootResponse.ok) return
        const rootData = await rootResponse.json().catch(() => ({ items: [] }))
        const rootItems: any[] = Array.isArray(rootData?.items) ? rootData.items : []
        const resolvedWorkspaceId =
          typeof rootData?.workspaceId === "string" && rootData.workspaceId.length > 0
            ? rootData.workspaceId
            : null
        loader.resolveWorkspaceId(resolvedWorkspaceId)

        const knowledgeBase = rootItems.find(
          (item) => typeof item?.name === "string" && item.name.toLowerCase() === "knowledge base",
        )

        let sidebarItems: OrganizationSidebarItem[] = []

        if (knowledgeBase) {
          let children: any[] = []
          try {
            const workspaceScopedUrl = loader.appendWorkspaceParam(
              `/api/items?parentId=${knowledgeBase.id}`,
              resolvedWorkspaceId ?? loader.knowledgeBaseWorkspaceId,
            )
            const childResponse = await loader.fetchWithWorkspace(workspaceScopedUrl)
            if (childResponse.ok) {
              const childData = await childResponse.json().catch(() => ({ items: [] }))
              if (Array.isArray(childData?.items)) {
                children = childData.items
              }
            }
          } catch (error) {
            console.error("[AnnotationApp] Failed to fetch Knowledge Base children:", error)
          }

          const formattedChildren = children.map(toSidebarItem)
          loader.updateFolderCacheEntry(knowledgeBase.id, knowledgeBase)
          loader.updateFolderCacheChildren(knowledgeBase.id, children)
          const knowledgeBaseCount = mapCount(knowledgeBase)

          sidebarItems = [
            {
              id: knowledgeBase.id,
              name: knowledgeBase.name ?? "Knowledge Base",
              icon: knowledgeBase.icon || "🗃️",
              count: knowledgeBaseCount,
              interactive: false,
            },
            ...formattedChildren.map((child) => ({ ...child, interactive: true })),
          ]
          setKnowledgeBaseId(knowledgeBase.id)
        } else {
          sidebarItems = rootItems.map((item) => ({ ...toSidebarItem(item), interactive: true }))
          setKnowledgeBaseId(null)
        }

        if (!cancelled) {
          setOrganizationFolders(sidebarItems)
        }
      } catch (error) {
        console.error("[AnnotationApp] Failed to load organization sidebar items:", error)
        if (!cancelled) {
          setOrganizationFolders([])
          setKnowledgeBaseId(null)
        }
      }
    }

    loadOrganizationSidebar()
    return () => {
      cancelled = true
    }
  }, [enabled, loader])

  const organizationSidebarData = useMemo(() => {
    return { organizationFolders, knowledgeBaseId }
  }, [organizationFolders, knowledgeBaseId])

  const noteTitleMapRef = useRef<Map<string, string>>(new Map())
  const [, forceNoteTitleUpdate] = useReducer((count: number) => count + 1, 0)
  const pendingTitleFetchesRef = useRef<Map<string, Promise<string | null>>>(new Map())

  const setTitleForNote = useCallback(
    (noteId: string, title: string | null) => {
      if (!noteId) return
      const map = noteTitleMapRef.current
      if (title && title.trim()) {
        const normalized = title.trim()
        if (map.get(noteId) !== normalized) {
          map.set(noteId, normalized)
          forceNoteTitleUpdate()
        }
        return
      }

      if (map.has(noteId)) {
        map.delete(noteId)
        forceNoteTitleUpdate()
      }
    },
    [],
  )

  const ensureTitleFromServer = useCallback(
    (noteId: string) => {
      if (!noteId) return
      const fetches = pendingTitleFetchesRef.current
      if (fetches.has(noteId)) {
        return
      }

      const fetchPromise = (async () => {
        try {
          const response = await noteTitles.fetchWithKnowledgeBase(`/api/items/${encodeURIComponent(noteId)}`)
          if (!response.ok) {
            console.warn("[AnnotationApp] Failed to fetch note metadata for title", {
              noteId,
              status: response.status,
            })
            return null
          }
          const data = await response.json()
          const rawName = data?.item?.name
          if (typeof rawName === "string") {
            const trimmed = rawName.trim()
            if (trimmed.length > 0) {
              return trimmed
            }
          }
          return null
        } catch (error) {
          console.warn("[AnnotationApp] Error fetching note title", { noteId, error })
          return null
        }
      })()

      fetches.set(noteId, fetchPromise)

      fetchPromise
        .then((title) => {
          fetches.delete(noteId)
          if (!title) return

          setTitleForNote(noteId, title)

          const dataStore = sharedWorkspace?.dataStore
          if (!dataStore) return

          const storeKey = ensurePanelKey(noteId, "main")
          const existing = dataStore.get(storeKey)
          if (existing) {
            dataStore.update(storeKey, { title })
          }
        })
        .catch((error) => {
          fetches.delete(noteId)
          console.warn("[AnnotationApp] Failed to resolve note title fetch promise", { noteId, error })
        })
    },
    [noteTitles.fetchWithKnowledgeBase, sharedWorkspace, setTitleForNote],
  )

  return {
    organizationSidebarData,
    knowledgeBaseId,
    noteTitleMapRef,
    forceNoteTitleUpdate,
    setTitleForNote,
    ensureTitleFromServer,
  }
}
