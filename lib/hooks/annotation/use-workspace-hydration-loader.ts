"use client"

import { useCallback } from "react"
import type { MutableRefObject } from "react"

import { debugLog } from "@/lib/utils/debug-logger"
import type { NoteWorkspace, OpenWorkspaceNote, WorkspacePosition } from "@/lib/workspace/types"

type WorkspacePositionMapRef = MutableRefObject<Map<string, WorkspacePosition>>

interface WorkspaceHydrationLoaderOptions {
  featureEnabled: boolean
  sharedWorkspaceId: string
  getWorkspace: (noteId: string) => NoteWorkspace
  ensureWorkspaceForOpenNotes: (notes: OpenWorkspaceNote[]) => void
  setOpenNotes: (notes: OpenWorkspaceNote[]) => void
  workspaceVersionsRef: MutableRefObject<Map<string, number>>
  pendingPersistsRef: WorkspacePositionMapRef
  positionCacheRef: WorkspacePositionMapRef
  persistWorkspaceVersions: () => void
  setWorkspaceError: (error: Error | null) => void
  setIsWorkspaceLoading: (value: boolean) => void
  setIsHydrating: (value: boolean) => void
  setIsWorkspaceReady: (value: boolean) => void
  fetchImpl?: typeof fetch
}

type HydrationRuntimeOptions = WorkspaceHydrationLoaderOptions & { fetchImpl: typeof fetch }

export function useWorkspaceHydrationLoader({
  featureEnabled,
  sharedWorkspaceId,
  getWorkspace,
  ensureWorkspaceForOpenNotes,
  setOpenNotes,
  workspaceVersionsRef,
  pendingPersistsRef,
  positionCacheRef,
  persistWorkspaceVersions,
  setWorkspaceError,
  setIsWorkspaceLoading,
  setIsHydrating,
  setIsWorkspaceReady,
  fetchImpl,
}: WorkspaceHydrationLoaderOptions) {
  return useCallback(() => {
    return hydrateWorkspace({
      featureEnabled,
      sharedWorkspaceId,
      getWorkspace,
      ensureWorkspaceForOpenNotes,
      setOpenNotes,
      workspaceVersionsRef,
      pendingPersistsRef,
      positionCacheRef,
      persistWorkspaceVersions,
      setWorkspaceError,
      setIsWorkspaceLoading,
      setIsHydrating,
      setIsWorkspaceReady,
      fetchImpl: fetchImpl ?? fetch,
    })
  }, [
    ensureWorkspaceForOpenNotes,
    featureEnabled,
    fetchImpl,
    getWorkspace,
    persistWorkspaceVersions,
    setIsHydrating,
    setIsWorkspaceLoading,
    setIsWorkspaceReady,
    setOpenNotes,
    setWorkspaceError,
    sharedWorkspaceId,
    positionCacheRef,
    pendingPersistsRef,
    workspaceVersionsRef,
  ])
}

export async function hydrateWorkspace({
  featureEnabled,
  sharedWorkspaceId,
  getWorkspace,
  ensureWorkspaceForOpenNotes,
  setOpenNotes,
  workspaceVersionsRef,
  pendingPersistsRef,
  positionCacheRef,
  persistWorkspaceVersions,
  setWorkspaceError,
  setIsWorkspaceLoading,
  setIsHydrating,
  setIsWorkspaceReady,
  fetchImpl,
}: HydrationRuntimeOptions) {
  const hydrationStartTime = Date.now()
  setIsWorkspaceLoading(true)
  setIsHydrating(true)

  try {
    const response = await fetchImpl("/api/canvas/workspace", {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
    })

    if (!response.ok) {
      const message = await response.text()
      throw new Error(message || "Failed to load canvas workspace")
    }

    const result = await response.json()
    const notes = Array.isArray(result?.openNotes) ? result.openNotes : []

    if (featureEnabled) {
      await hydrateFeatureWorkspace({
        notes,
        panels: Array.isArray(result?.panels) ? result.panels : [],
        getWorkspace,
        sharedWorkspaceId,
        ensureWorkspaceForOpenNotes,
        setOpenNotes,
        workspaceVersionsRef,
        persistWorkspaceVersions,
        fetchImpl,
        hydrationStartTime,
      })
    } else {
      hydrateLegacyWorkspace({
        notes,
        ensureWorkspaceForOpenNotes,
        setOpenNotes,
        workspaceVersionsRef,
        pendingPersistsRef,
        positionCacheRef,
        persistWorkspaceVersions,
      })
    }

    setWorkspaceError(null)
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    setWorkspaceError(err)
    throw err
  } finally {
    setIsWorkspaceLoading(false)
    setIsWorkspaceReady(true)
    setIsHydrating(false)
  }
}

function normalizeOpenNotes(rawNotes: any[]): OpenWorkspaceNote[] {
  return rawNotes.map((note: any) => {
    const rawPosition = note?.mainPosition
    const rawX = Number(rawPosition?.x)
    const rawY = Number(rawPosition?.y)
    const hasValidPosition = Number.isFinite(rawX) && Number.isFinite(rawY)
    const versionValue = Number(note?.version ?? 0)
    const version = Number.isFinite(versionValue) ? versionValue : 0

    return {
      noteId: String(note.noteId),
      mainPosition: hasValidPosition ? { x: rawX, y: rawY } : null,
      updatedAt: note?.updatedAt ? String(note.updatedAt) : null,
      version,
    }
  })
}

function applyVersionSnapshot(
  notes: OpenWorkspaceNote[],
  workspaceVersionsRef: MutableRefObject<Map<string, number>>,
  persistWorkspaceVersions: () => void,
) {
  workspaceVersionsRef.current.clear()
  notes.forEach(entry => {
    workspaceVersionsRef.current.set(entry.noteId, entry.version)
  })
  persistWorkspaceVersions()
}

function mergeWithLocalPositions({
  normalized,
  positionCacheRef,
  pendingPersistsRef,
  workspaceVersionsRef,
}: {
  normalized: OpenWorkspaceNote[]
  positionCacheRef: WorkspacePositionMapRef
  pendingPersistsRef: WorkspacePositionMapRef
  workspaceVersionsRef: MutableRefObject<Map<string, number>>
}) {
  const merged: OpenWorkspaceNote[] = [...normalized]

  positionCacheRef.current.forEach((position, noteId) => {
    if (!position) return
    const existingIndex = merged.findIndex(note => note.noteId === noteId)
    if (existingIndex >= 0) {
      merged[existingIndex] = {
        ...merged[existingIndex],
        mainPosition: position,
      }
    }
  })

  pendingPersistsRef.current.forEach((position, noteId) => {
    if (!position) return
    const existingIndex = merged.findIndex(note => note.noteId === noteId)
    if (existingIndex >= 0) {
      merged[existingIndex] = {
        ...merged[existingIndex],
        mainPosition: position,
      }
    } else {
      console.log(`[DEBUG refreshWorkspace] Adding note ${noteId} from pending only:`, position)
      merged.push({
        noteId,
        mainPosition: position,
        updatedAt: null,
        version: workspaceVersionsRef.current.get(noteId) ?? 0,
      })
    }
  })

  return merged
}

async function hydrateFeatureWorkspace({
  notes,
  panels,
  getWorkspace,
  sharedWorkspaceId,
  ensureWorkspaceForOpenNotes,
  setOpenNotes,
  workspaceVersionsRef,
  persistWorkspaceVersions,
  fetchImpl,
  hydrationStartTime,
}: {
  notes: any[]
  panels: any[]
  getWorkspace: (noteId: string) => NoteWorkspace
  sharedWorkspaceId: string
  ensureWorkspaceForOpenNotes: (notes: OpenWorkspaceNote[]) => void
  setOpenNotes: (notes: OpenWorkspaceNote[]) => void
  workspaceVersionsRef: MutableRefObject<Map<string, number>>
  persistWorkspaceVersions: () => void
  fetchImpl: typeof fetch
  hydrationStartTime: number
}) {
  const normalized = normalizeOpenNotes(notes)
  applyVersionSnapshot(normalized, workspaceVersionsRef, persistWorkspaceVersions)

  const workspace = getWorkspace(sharedWorkspaceId)
  const uniqueNoteIds = [...new Set(panels.map((p: any) => String(p.noteId)))] as string[]
  const branchesByNote = new Map<string, any[]>()

  console.log("[Workspace] Loading branches for notes:", uniqueNoteIds)
  console.log(
    "[Workspace] All panels:",
    panels.map((p: any) => ({
      noteId: p.noteId,
      panelId: p.panelId,
      type: p.type,
    })),
  )

  for (const noteId of uniqueNoteIds) {
    try {
      const url = `/api/postgres-offline/branches?noteId=${noteId}`
      console.log(`[Workspace] Fetching branches from: ${url}`)
      const response = await fetchImpl(url)
      console.log("[Workspace] Response status:", response.status, response.statusText)

      if (response.ok) {
        const data = await response.json()
        console.log(`[Workspace] Response data for ${noteId}:`, data)
        console.log("[Workspace] Data is array?", Array.isArray(data))
        console.log("[Workspace] Data type:", typeof data)
        console.log("[Workspace] Data.branches:", data.branches)

        const branches = Array.isArray(data) ? data : data.branches || []
        console.log("[Workspace] Extracted branches:", branches)
        branchesByNote.set(noteId, branches)
        console.log(`[Workspace] Loaded ${branches.length} branches for note ${noteId}:`, branches)
      } else {
        console.warn(
          `[Workspace] Failed to load branches for ${noteId}: ${response.status} ${response.statusText}`,
        )
      }
    } catch (error) {
      console.warn(`[Workspace] Failed to load branches for note ${noteId}:`, error)
    }
  }

  console.log("[Workspace] All branches loaded:", branchesByNote)

  const normalizeBranchId = (rawId: string | null | undefined): string => {
    if (!rawId) return ""
    if (rawId === "main") return "main"
    if (rawId.startsWith("branch-")) return rawId
    return `branch-${rawId}`
  }

  const normalizeParentId = (rawId: string | null | undefined): string => {
    if (!rawId || rawId === "main") return "main"
    if (rawId.startsWith("branch-")) return rawId
    return `branch-${rawId}`
  }

  const normalizePanelId = (rawId: string, panelType?: string): string => {
    if (!rawId) return rawId
    if (rawId === "main") return "main"
    if (rawId.startsWith("branch-")) return rawId
    if (panelType && ["branch", "context", "annotation"].includes(panelType)) {
      return `branch-${rawId}`
    }
    return rawId
  }

  branchesByNote.forEach((branches, noteId) => {
    branches.forEach((branchObj: any) => {
      const branchPanelId = normalizeBranchId(branchObj.id)
      const branchKey = `${noteId}::${branchPanelId}`
      const normalizedParent = normalizeParentId(branchObj.parentId)

      workspace.dataStore.set(branchKey, {
        id: branchPanelId,
        type: branchObj.type || "note",
        title: branchObj.title || "",
        originalText: branchObj.originalText || "",
        metadata: branchObj.metadata || {},
        anchors: branchObj.anchors,
        parentId: normalizedParent,
        branches: [],
      })
    })
  })

  panels.forEach((panel: any) => {
    const normalizedPanelId = normalizePanelId(panel.panelId, panel.type)
    const normalizedParentId = normalizeParentId(panel.parentId)
    const legacyPanelKey = `${panel.noteId}::${panel.panelId}`
    const panelKey = `${panel.noteId}::${normalizedPanelId}`

    let existing = workspace.dataStore.get(panelKey)
    if (!existing && legacyPanelKey !== panelKey) {
      const legacyEntry = workspace.dataStore.get(legacyPanelKey)
      if (legacyEntry) {
        workspace.dataStore.delete(legacyPanelKey)
        existing = legacyEntry
      }
    }

    if (existing) {
      return
    }

    const noteBranches = branchesByNote.get(panel.noteId) || []
    console.log("[Workspace] Looking up branches for panel", panelKey, {
      panelNoteId: panel.noteId,
      hasBranchesInMap: branchesByNote.has(panel.noteId),
      branchesMapKeys: Array.from(branchesByNote.keys()),
      noteBranches,
      noteBranchesCount: noteBranches.length,
    })

    const expectedParentId = normalizedPanelId === "main" ? "main" : normalizedPanelId
    const branchIds = noteBranches
      .filter((branchObj: any) => normalizeParentId(branchObj.parentId) === expectedParentId)
      .map((branchObj: any) => normalizeBranchId(branchObj.id))

    console.log("[Workspace] Matched branches for panel", panelKey, {
      expectedParentId,
      branchCount: branchIds.length,
      branchIds,
      allBranchesForNote: noteBranches.map((b: any) => ({ id: b.id, parentId: b.parentId })),
    })

    workspace.dataStore.set(panelKey, {
      id: normalizedPanelId,
      type: panel.type,
      title: panel.title || "",
      position: { x: panel.positionXWorld, y: panel.positionYWorld },
      dimensions: { width: panel.widthWorld, height: panel.heightWorld },
      zIndex: panel.zIndex,
      metadata: {
        ...(panel.metadata || {}),
        ...(normalizedPanelId !== "main" && normalizedParentId
          ? { parentId: normalizedParentId, parentPanelId: normalizedParentId }
          : {}),
      },
      parentId: normalizedPanelId === "main" ? null : normalizedParentId,
      worldPosition: { x: panel.positionXWorld, y: panel.positionYWorld },
      worldSize: { width: panel.widthWorld, height: panel.heightWorld },
      branches: branchIds,
    })

    workspace.loadedNotes.add(panel.noteId)
  })

  ensureWorkspaceForOpenNotes(normalized)
  setOpenNotes(normalized)

  const hydrationDuration = Date.now() - hydrationStartTime
  const componentBreakdown: Record<string, number> = {}

  panels.forEach((panel: any) => {
    const type = panel.type === "main" || panel.type === "branch" ? "note" : panel.type
    componentBreakdown[type] = (componentBreakdown[type] || 0) + 1
  })

  try {
    await debugLog({
      component: "CanvasWorkspace",
      action: "workspace_toolbar_state_rehydrated",
      metadata: {
        workspaceId: sharedWorkspaceId,
        focusedNoteId: notes.find((n: any) => n.isFocused)?.noteId || null,
        tabOrder: notes.map((n: any) => n.noteId),
        panelCount: panels.length,
        componentBreakdown,
        snapshotTimestamp: new Date().toISOString(),
        hydrationDurationMs: hydrationDuration,
      },
    })
  } catch (logError) {
    console.warn("[CanvasWorkspace] Failed to emit hydration telemetry:", logError)
  }
}

function hydrateLegacyWorkspace({
  notes,
  ensureWorkspaceForOpenNotes,
  setOpenNotes,
  workspaceVersionsRef,
  pendingPersistsRef,
  positionCacheRef,
  persistWorkspaceVersions,
}: {
  notes: any[]
  ensureWorkspaceForOpenNotes: (notes: OpenWorkspaceNote[]) => void
  setOpenNotes: (notes: OpenWorkspaceNote[]) => void
  workspaceVersionsRef: MutableRefObject<Map<string, number>>
  pendingPersistsRef: WorkspacePositionMapRef
  positionCacheRef: WorkspacePositionMapRef
  persistWorkspaceVersions: () => void
}) {
  const normalized = normalizeOpenNotes(notes)
  applyVersionSnapshot(normalized, workspaceVersionsRef, persistWorkspaceVersions)

  const merged = mergeWithLocalPositions({
    normalized,
    positionCacheRef,
    pendingPersistsRef,
    workspaceVersionsRef,
  })

  ensureWorkspaceForOpenNotes(merged)
  setOpenNotes(merged)
}
