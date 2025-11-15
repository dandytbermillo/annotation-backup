import type { MutableRefObject } from "react"

import { hydrateWorkspace } from "@/lib/hooks/annotation/use-workspace-hydration-loader"
import { DataStore } from "@/lib/data-store"
import type { NoteWorkspace, WorkspacePosition } from "@/lib/workspace/types"

jest.mock("@/lib/utils/debug-logger", () => ({
  debugLog: jest.fn().mockResolvedValue(undefined),
}))

type HydrationOptions = Parameters<typeof hydrateWorkspace>[0]

const createMapRef = <T,>(): MutableRefObject<Map<string, T>> => ({
  current: new Map<string, T>(),
})

const createWorkspace = (): NoteWorkspace => ({
  dataStore: new DataStore(),
  events: {} as any,
  layerManager: {} as any,
  loadedNotes: new Set<string>(),
})

const createBaseOptions = () => {
  const workspace = createWorkspace()

  const options: HydrationOptions = {
    featureEnabled: false,
    sharedWorkspaceId: "shared",
    getWorkspace: jest.fn(() => workspace),
    ensureWorkspaceForOpenNotes: jest.fn(),
    setOpenNotes: jest.fn(),
    workspaceVersionsRef: createMapRef<number>(),
    pendingPersistsRef: createMapRef<WorkspacePosition>(),
    positionCacheRef: createMapRef<WorkspacePosition>(),
    persistWorkspaceVersions: jest.fn(),
    setWorkspaceError: jest.fn(),
    setIsWorkspaceLoading: jest.fn(),
    setIsHydrating: jest.fn(),
    setIsWorkspaceReady: jest.fn(),
    fetchImpl: jest.fn(),
  }

  return { options, workspace }
}

describe("hydrateWorkspace", () => {
  afterEach(() => {
    jest.clearAllMocks()
  })

  it("merges cached and pending positions in legacy mode", async () => {
    const { options } = createBaseOptions()
    options.featureEnabled = false

    options.positionCacheRef.current.set("note-1", { x: 10, y: 20 })
    options.pendingPersistsRef.current.set("note-2", { x: 30, y: 40 })

    options.fetchImpl.mockResolvedValue({
      ok: true,
      json: async () => ({
        openNotes: [
          { noteId: "note-1", mainPosition: { x: 1, y: 2 }, version: 4, updatedAt: "2025-01-01T00:00:00Z" },
          { noteId: "note-2", mainPosition: null, version: 2, updatedAt: null },
        ],
      }),
    })

    await hydrateWorkspace(options)

    expect(options.setIsWorkspaceLoading).toHaveBeenNthCalledWith(1, true)
    expect(options.setIsWorkspaceLoading).toHaveBeenLastCalledWith(false)
    expect(options.setIsHydrating).toHaveBeenNthCalledWith(1, true)
    expect(options.setIsHydrating).toHaveBeenLastCalledWith(false)
    expect(options.setIsWorkspaceReady).toHaveBeenCalledWith(true)
    expect(options.persistWorkspaceVersions).toHaveBeenCalled()
    expect(options.getWorkspace).not.toHaveBeenCalled()

    const merged = options.ensureWorkspaceForOpenNotes.mock.calls[0][0]
    expect(merged).toEqual([
      {
        noteId: "note-1",
        mainPosition: { x: 10, y: 20 },
        updatedAt: "2025-01-01T00:00:00Z",
        version: 4,
      },
      {
        noteId: "note-2",
        mainPosition: { x: 30, y: 40 },
        updatedAt: null,
        version: 2,
      },
    ])
    expect(options.setOpenNotes).toHaveBeenCalledWith(merged)
    expect(options.setWorkspaceError).toHaveBeenCalledWith(null)
  })

  it("hydrates ordered toolbar state with branches and panels when feature flag is enabled", async () => {
    const { options, workspace } = createBaseOptions()
    options.featureEnabled = true

    const workspaceResponse = {
      ok: true,
      json: async () => ({
        openNotes: [{ noteId: "note-1", mainPosition: { x: 5, y: 6 }, version: 7, updatedAt: "2025-01-02T00:00:00Z" }],
        panels: [
          {
            noteId: "note-1",
            panelId: "main",
            type: "main",
            positionXWorld: 100,
            positionYWorld: 200,
            widthWorld: 320,
            heightWorld: 200,
            zIndex: 1,
            metadata: {},
            parentId: null,
          },
          {
            noteId: "note-1",
            panelId: "child-panel",
            type: "branch",
            positionXWorld: 150,
            positionYWorld: 210,
            widthWorld: 320,
            heightWorld: 200,
            zIndex: 2,
            metadata: {},
            parentId: "main",
          },
        ],
      }),
    }

    const branchResponse = {
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => [{ id: "child-panel", parentId: "main", type: "note", title: "Child" }],
    }

    options.fetchImpl.mockImplementation(async (url: any) => {
      if (typeof url === "string" && url.startsWith("/api/postgres-offline/branches")) {
        return branchResponse as any
      }
      return workspaceResponse as any
    })

    await hydrateWorkspace(options)

    expect(options.getWorkspace).toHaveBeenCalledWith("shared")
    expect(workspace.loadedNotes.has("note-1")).toBe(true)
    expect(workspace.dataStore.get("note-1::main")).toBeTruthy()
    expect(workspace.dataStore.get("note-1::branch-child-panel")).toBeTruthy()
    expect(options.ensureWorkspaceForOpenNotes).toHaveBeenCalledWith([
      {
        noteId: "note-1",
        mainPosition: { x: 5, y: 6 },
        updatedAt: "2025-01-02T00:00:00Z",
        version: 7,
      },
    ])
    expect(options.setOpenNotes).toHaveBeenCalled()
    expect(options.setWorkspaceError).toHaveBeenCalledWith(null)
    expect(options.persistWorkspaceVersions).toHaveBeenCalled()
    expect(options.fetchImpl).toHaveBeenCalledTimes(1 + 1) // workspace + branches for note-1
  })

  it("throws and surfaces errors when the workspace request fails", async () => {
    const { options } = createBaseOptions()
    options.fetchImpl.mockResolvedValue({
      ok: false,
      text: async () => "failed to load",
    })

    await expect(hydrateWorkspace(options)).rejects.toThrow("failed to load")

    expect(options.setWorkspaceError).toHaveBeenCalled()
    expect(options.setOpenNotes).not.toHaveBeenCalled()
    expect(options.setIsWorkspaceLoading).toHaveBeenNthCalledWith(1, true)
    expect(options.setIsWorkspaceLoading).toHaveBeenLastCalledWith(false)
    expect(options.setIsWorkspaceReady).toHaveBeenCalledWith(true)
    expect(options.setIsHydrating).toHaveBeenLastCalledWith(false)
  })
})
