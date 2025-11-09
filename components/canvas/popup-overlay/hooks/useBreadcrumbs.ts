import { useCallback, useEffect, useRef, useState } from 'react'
import type { PopupChildNode, PopupData } from '../types'

type FetchWithKnowledgeBase = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
type DebugLogFn = typeof import('@/lib/utils/debug-logger').debugLog

export interface BreadcrumbFolderPreview {
  folderId: string
  folderName: string
  folderColor?: string
  position: { x: number; y: number }
  children: PopupChildNode[]
  isLoading: boolean
}

interface UseBreadcrumbsOptions {
  fetchWithKnowledgeBase: FetchWithKnowledgeBase
  debugLog: DebugLogFn
  folderPreviewDelayMs: number
}

export function useBreadcrumbs({
  fetchWithKnowledgeBase,
  debugLog,
  folderPreviewDelayMs,
}: UseBreadcrumbsOptions) {
  const [breadcrumbDropdownOpen, setBreadcrumbDropdownOpen] = useState<string | null>(null)
  const [ancestorCache, setAncestorCache] = useState<Map<string, PopupChildNode[]>>(new Map())
  const [loadingAncestors, setLoadingAncestors] = useState<Set<string>>(new Set())
  const [breadcrumbFolderPreview, setBreadcrumbFolderPreview] = useState<BreadcrumbFolderPreview | null>(null)
  const breadcrumbPreviewTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  const fetchAncestors = useCallback(async (folderId: string, popupId: string): Promise<PopupChildNode[]> => {
    const cached = ancestorCache.get(folderId)
    if (cached) {
      void debugLog({
        component: 'PopupOverlay',
        action: 'using_cached_ancestors',
        metadata: { folderId },
      })
      return cached
    }

    void debugLog({
      component: 'PopupOverlay',
      action: 'fetching_ancestors_for_folder',
      metadata: { folderId },
    })
    setLoadingAncestors(prev => new Set(prev).add(popupId))

    try {
      const ancestors: PopupChildNode[] = []
      let currentId: string | null = folderId
      let depth = 0
      const maxDepth = 10

      while (currentId && depth < maxDepth) {
        const response = await fetchWithKnowledgeBase(`/api/items/${currentId}`)
        if (!response.ok) {
          console.error('[fetchAncestors] Failed to fetch folder:', currentId, response.status)
          break
        }

        const data = await response.json()
        const folder = data.item || data

        ancestors.unshift({
          id: folder.id,
          name: folder.name,
          type: 'folder',
          icon: folder.icon || '📁',
          color: folder.color,
          path: folder.path,
          createdAt: folder.createdAt,
          updatedAt: folder.updatedAt,
          hasChildren: true,
          level: depth,
          children: [],
          parentId: folder.parentId,
        })

        void debugLog({
          component: 'PopupOverlay',
          action: 'added_ancestor',
          metadata: {
            folderName: folder.name,
            path: folder.path,
            depth,
          },
        })

        if (!folder.parentId || folder.path === '/knowledge-base') {
          void debugLog({
            component: 'PopupOverlay',
            action: 'reached_root_ancestor',
            metadata: { folderId },
          })
          break
        }

        currentId = folder.parentId
        depth += 1
      }

      void debugLog({
        component: 'PopupOverlay',
        action: 'fetched_ancestors',
        metadata: { folderId, ancestorCount: ancestors.length },
      })

      setAncestorCache(prev => new Map(prev).set(folderId, ancestors))
      return ancestors
    } catch (error) {
      console.error('[fetchAncestors] Error fetching ancestors:', error)
      return []
    } finally {
      setLoadingAncestors(prev => {
        const next = new Set(prev)
        next.delete(popupId)
        return next
      })
    }
  }, [ancestorCache, fetchWithKnowledgeBase, debugLog])

  const handleToggleBreadcrumbDropdown = useCallback(async (popup: PopupData) => {
    const isOpen = breadcrumbDropdownOpen === popup.id

    if (isOpen) {
      void debugLog({
        component: 'PopupOverlay',
        action: 'closing_breadcrumb_dropdown',
        metadata: { popupId: popup.id, folderName: popup.folderName },
      })
      setBreadcrumbDropdownOpen(null)
      return
    }

    void debugLog({
      component: 'PopupOverlay',
      action: 'opening_breadcrumb_dropdown',
      metadata: { popupId: popup.id, folderName: popup.folderName },
    })
    setBreadcrumbDropdownOpen(popup.id)

    if (popup.folder?.id) {
      await fetchAncestors(popup.folder.id, popup.id)
    }
  }, [breadcrumbDropdownOpen, debugLog, fetchAncestors])

  useEffect(() => {
    if (!breadcrumbDropdownOpen) return

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement
      if (!target.closest('[data-breadcrumb-dropdown]') && !target.closest('[data-breadcrumb-toggle]')) {
        setBreadcrumbDropdownOpen(null)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [breadcrumbDropdownOpen])

  const handleBreadcrumbFolderHover = useCallback(async (ancestor: PopupChildNode, event: React.MouseEvent) => {
    event.stopPropagation()

    if (breadcrumbPreviewTimeoutRef.current) {
      clearTimeout(breadcrumbPreviewTimeoutRef.current)
      breadcrumbPreviewTimeoutRef.current = null
    }

    const rect = event.currentTarget.getBoundingClientRect()
    const spaceRight = window.innerWidth - rect.right
    const position =
      spaceRight > 320
        ? { x: rect.right + 10, y: rect.top }
        : { x: rect.left, y: rect.bottom + 10 }

    setBreadcrumbFolderPreview({
      folderId: ancestor.id,
      folderName: ancestor.name || 'Untitled',
      folderColor: ancestor.color || undefined,
      position,
      children: [],
      isLoading: true,
    })

    try {
      const response = await fetchWithKnowledgeBase(`/api/items?parentId=${ancestor.id}`)
      if (!response.ok) {
        throw new Error('Failed to fetch folder contents')
      }

      const data = await response.json()
      const children = (data.items || []).map((item: any) => ({
        id: item.id,
        name: item.name,
        type: item.type,
        icon: item.icon || (item.type === 'folder' ? '📁' : '📄'),
        color: item.color || ancestor.color,
        hasChildren: item.type === 'folder',
      }))

      setBreadcrumbFolderPreview(prev => (prev ? { ...prev, children, isLoading: false } : null))
    } catch (error) {
      console.error('[BreadcrumbPreview] Error fetching folder contents:', error)
      setBreadcrumbFolderPreview(null)
    }
  }, [fetchWithKnowledgeBase])

  const clearPreviewTimeout = useCallback(() => {
    if (breadcrumbPreviewTimeoutRef.current) {
      clearTimeout(breadcrumbPreviewTimeoutRef.current)
      breadcrumbPreviewTimeoutRef.current = null
    }
  }, [])

  const handleBreadcrumbFolderHoverLeave = useCallback(() => {
    breadcrumbPreviewTimeoutRef.current = setTimeout(() => {
      setBreadcrumbFolderPreview(null)
    }, folderPreviewDelayMs)
  }, [folderPreviewDelayMs])

  const handleBreadcrumbPreviewHover = useCallback(() => {
    clearPreviewTimeout()
  }, [clearPreviewTimeout])

  useEffect(() => {
    return () => {
      clearPreviewTimeout()
      setBreadcrumbFolderPreview(null)
    }
  }, [clearPreviewTimeout])

  return {
    breadcrumbDropdownOpen,
    ancestorCache,
    loadingAncestors,
    breadcrumbFolderPreview,
    handleToggleBreadcrumbDropdown,
    handleBreadcrumbFolderHover,
    handleBreadcrumbFolderHoverLeave,
    handleBreadcrumbPreviewHover,
  }
}
