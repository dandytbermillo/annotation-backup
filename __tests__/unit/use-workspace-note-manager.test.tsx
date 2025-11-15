import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react"
import TestRenderer, { act } from "react-test-renderer"

import { useWorkspaceNoteManager } from "@/lib/hooks/annotation/use-workspace-note-manager"
import type { NoteWorkspace, OpenWorkspaceNote, WorkspacePosition } from "@/lib/workspace/types"
import type { WorkspaceVersionUpdate } from "@/lib/workspace/persist-workspace"
import { getSmartWorkspacePosition } from "@/lib/workspace/get-smart-workspace-position"

jest.mock("@/lib/workspace/get-smart-workspace-position", () => ({
  getSmartWorkspacePosition: jest.fn(() => ({ x: 480, y: 320 })),
}))

type ManagerHandle = {
  openNote: (noteId: string, options?: any) => Promise<void>
  closeNote: (noteId: string, options?: any) => Promise<void>
  getOpenNotes: () => OpenWorkspaceNote[]
  seedOpenNotes: (notes: OpenWorkspaceNote[]) => void
}

type HarnessProps = {
  ensureWorkspaceForOpenNotes: jest.Mock
  workspaceVersionsRef: React.MutableRefObject<Map<string, number>>
  positionCacheRef: React.MutableRefObject<Map<string, WorkspacePosition>>
  pendingPersistsRef: React.MutableRefObject<Map<string, WorkspacePosition>>
  persistWorkspace: jest.Mock<Promise<WorkspaceVersionUpdate[]>, any>
  scheduleWorkspacePersist: jest.Mock
  clearScheduledPersist: jest.Mock
  applyVersionUpdates: jest.Mock
  syncPositionCacheToStorage: jest.Mock
  workspacesRef: React.MutableRefObject<Map<string, NoteWorkspace>>
  invalidateLocalSnapshot: jest.Mock
  fetchImpl?: typeof fetch
}

const WorkspaceNoteManagerHarness = forwardRef<ManagerHandle, HarnessProps>((props, ref) => {
  const [openNotes, setOpenNotes] = useState<OpenWorkspaceNote[]>([])
  const openNotesRef = useRef(openNotes)

  useEffect(() => {
    openNotesRef.current = openNotes
  }, [openNotes])

  const manager = useWorkspaceNoteManager({
    setOpenNotes,
    ensureWorkspaceForOpenNotes: props.ensureWorkspaceForOpenNotes,
    workspaceVersionsRef: props.workspaceVersionsRef,
    positionCacheRef: props.positionCacheRef,
    pendingPersistsRef: props.pendingPersistsRef,
    persistWorkspace: props.persistWorkspace,
    scheduleWorkspacePersist: props.scheduleWorkspacePersist,
    clearScheduledPersist: props.clearScheduledPersist,
    applyVersionUpdates: props.applyVersionUpdates,
    syncPositionCacheToStorage: props.syncPositionCacheToStorage,
    workspacesRef: props.workspacesRef,
    invalidateLocalSnapshot: props.invalidateLocalSnapshot,
    fetchImpl: props.fetchImpl,
  })

  useImperativeHandle(ref, () => ({
    openNote: manager.openNote,
    closeNote: manager.closeNote,
    getOpenNotes: () => openNotesRef.current,
    seedOpenNotes: (notes: OpenWorkspaceNote[]) => {
      setOpenNotes(notes)
    },
  }))

  return null
})
WorkspaceNoteManagerHarness.displayName = "WorkspaceNoteManagerHarness"

const createRefs = () => ({
  workspaceVersionsRef: { current: new Map<string, number>() },
  positionCacheRef: { current: new Map<string, WorkspacePosition>() },
  pendingPersistsRef: { current: new Map<string, WorkspacePosition>() },
  workspacesRef: { current: new Map<string, NoteWorkspace>() },
})

const createHarnessProps = (): HarnessProps => {
  const refs = createRefs()
  return {
    ensureWorkspaceForOpenNotes: jest.fn(),
    workspaceVersionsRef: refs.workspaceVersionsRef,
    positionCacheRef: refs.positionCacheRef,
    pendingPersistsRef: refs.pendingPersistsRef,
    persistWorkspace: jest.fn().mockResolvedValue([]),
    scheduleWorkspacePersist: jest.fn(),
    clearScheduledPersist: jest.fn(),
    applyVersionUpdates: jest.fn(),
    syncPositionCacheToStorage: jest.fn(),
    workspacesRef: refs.workspacesRef,
    invalidateLocalSnapshot: jest.fn(),
    fetchImpl: jest.fn().mockResolvedValue({ ok: true }),
  }
}

const renderManager = async (props: HarnessProps) => {
  const ref = React.createRef<ManagerHandle>()
  await act(async () => {
    TestRenderer.create(<WorkspaceNoteManagerHarness {...props} ref={ref} />)
  })
  return ref
}

describe("useWorkspaceNoteManager", () => {
  afterEach(() => {
    jest.clearAllMocks()
  })

  it("prefers pending positions when opening a note and persists immediately", async () => {
    const props = createHarnessProps()
    const ref = await renderManager(props)

    props.pendingPersistsRef.current.set("note-1", { x: 25, y: 75 })
    props.workspaceVersionsRef.current.set("note-1", 3)

    await act(async () => {
      await ref.current!.openNote("note-1")
    })

    expect(props.positionCacheRef.current.get("note-1")).toEqual({ x: 25, y: 75 })
    expect(props.syncPositionCacheToStorage).toHaveBeenCalled()
    expect(props.ensureWorkspaceForOpenNotes).toHaveBeenCalledWith([
      expect.objectContaining({
        noteId: "note-1",
        mainPosition: { x: 25, y: 75 },
        version: 3,
      }),
    ])
    expect(props.persistWorkspace).toHaveBeenCalledTimes(1)
    expect(props.clearScheduledPersist).toHaveBeenCalledWith("note-1")
    expect(ref.current!.getOpenNotes()).toHaveLength(1)
  })

  it("schedules a retry when persistence fails during openNote", async () => {
    const props = createHarnessProps()
    const ref = await renderManager(props)

    props.persistWorkspace.mockRejectedValue(new Error("network down"))
    props.workspaceVersionsRef.current.set("note-2", 2)

    await act(async () => {
      await ref.current!.openNote("note-2", { mainPosition: { x: 10, y: 10 } })
    })

    expect(props.scheduleWorkspacePersist).toHaveBeenCalledWith("note-2", { x: 10, y: 10 })
    expect(props.pendingPersistsRef.current.get("note-2")).toEqual({ x: 10, y: 10 })
  })

  it("removes notes and invalidates caches when closing", async () => {
    const props = createHarnessProps()
    const ref = await renderManager(props)

    const workspace: NoteWorkspace = {
      dataStore: {} as any,
      events: {} as any,
      layerManager: {} as any,
      loadedNotes: new Set(),
    }
    props.workspacesRef.current.set("note-3", workspace)

    await act(async () => {
      ref.current!.seedOpenNotes([
        { noteId: "note-3", mainPosition: { x: 0, y: 0 }, updatedAt: null, version: 1 },
      ])
    })

    await act(async () => {
      await ref.current!.closeNote("note-3")
    })

    expect(props.persistWorkspace).toHaveBeenCalledWith([{ noteId: "note-3", isOpen: false }])
    expect(props.applyVersionUpdates).toHaveBeenCalled()
    expect(props.invalidateLocalSnapshot).toHaveBeenCalledWith("note-3")
    expect(props.fetchImpl).toHaveBeenCalledWith(
      "/api/canvas/layout/note-3",
      expect.objectContaining({ method: "PATCH" }),
    )
    expect(ref.current!.getOpenNotes()).toHaveLength(0)
    expect(props.workspacesRef.current.has("note-3")).toBe(false)
  })

  it("uses the shared smart workspace position when no cached coordinates exist", async () => {
    const props = createHarnessProps()
    const ref = await renderManager(props)

    ;(getSmartWorkspacePosition as jest.Mock).mockReturnValue({ x: 111, y: 222 })

    await act(async () => {
      await ref.current!.openNote("note-4")
    })

    expect(props.positionCacheRef.current.get("note-4")).toEqual({ x: 111, y: 222 })
  })
})
