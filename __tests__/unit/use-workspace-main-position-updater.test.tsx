import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react"
import TestRenderer, { act } from "react-test-renderer"

import { useWorkspaceMainPositionUpdater } from "@/lib/hooks/annotation/use-workspace-main-position-updater"
import type { OpenWorkspaceNote, WorkspacePosition } from "@/lib/workspace/types"
import type { WorkspaceVersionUpdate } from "@/lib/workspace/persist-workspace"

jest.mock("@/lib/utils/debug-logger", () => ({
  debugLog: jest.fn().mockResolvedValue(undefined),
}))

type ManagerHandle = {
  update: (noteId: string, position: WorkspacePosition, persist?: boolean) => Promise<void>
  getOpenNotes: () => OpenWorkspaceNote[]
}

type HarnessProps = {
  persistWorkspace: jest.Mock<Promise<WorkspaceVersionUpdate[]>, any>
  applyVersionUpdates: jest.Mock
  clearScheduledPersist: jest.Mock
  scheduleWorkspacePersist: jest.Mock
  positionCacheRef: React.MutableRefObject<Map<string, WorkspacePosition>>
  syncPositionCacheToStorage: jest.Mock
}

const WorkspaceMainPositionHarness = forwardRef<ManagerHandle, HarnessProps>(
  ({ persistWorkspace, applyVersionUpdates, clearScheduledPersist, scheduleWorkspacePersist, positionCacheRef, syncPositionCacheToStorage }, ref) => {
    const [openNotes, setOpenNotes] = useState<OpenWorkspaceNote[]>([
      { noteId: "note-1", mainPosition: { x: 0, y: 0 }, updatedAt: null, version: 1 },
    ])
    const openNotesRef = useRef(openNotes)

    useEffect(() => {
      openNotesRef.current = openNotes
    }, [openNotes])

    const { updateMainPosition } = useWorkspaceMainPositionUpdater({
      setOpenNotes,
      positionCacheRef,
      syncPositionCacheToStorage,
      persistWorkspace,
      applyVersionUpdates,
      clearScheduledPersist,
      scheduleWorkspacePersist,
    })

    useImperativeHandle(ref, () => ({
      update: updateMainPosition,
      getOpenNotes: () => openNotesRef.current,
    }))

    return null
  },
)
WorkspaceMainPositionHarness.displayName = "WorkspaceMainPositionHarness"

const createHarnessProps = (): HarnessProps => ({
  persistWorkspace: jest.fn().mockResolvedValue([{ noteId: "note-1", version: 2 }]),
  applyVersionUpdates: jest.fn(),
  clearScheduledPersist: jest.fn(),
  scheduleWorkspacePersist: jest.fn(),
  positionCacheRef: { current: new Map<string, WorkspacePosition>() },
  syncPositionCacheToStorage: jest.fn(),
})

const renderHarness = async (props: HarnessProps) => {
  const ref = React.createRef<ManagerHandle>()
  await act(async () => {
    TestRenderer.create(<WorkspaceMainPositionHarness {...props} ref={ref} />)
  })
  return ref
}

describe("useWorkspaceMainPositionUpdater", () => {
  it("caches positions and persists updates when successful", async () => {
    const props = createHarnessProps()
    const ref = await renderHarness(props)

    await act(async () => {
      await ref.current!.update("note-1", { x: 40, y: 60 })
    })

    expect(props.positionCacheRef.current.get("note-1")).toEqual({ x: 40, y: 60 })
    expect(props.syncPositionCacheToStorage).toHaveBeenCalled()
    expect(props.persistWorkspace).toHaveBeenCalledWith([{ noteId: "note-1", isOpen: true, mainPosition: { x: 40, y: 60 } }])
    expect(props.applyVersionUpdates).toHaveBeenCalledWith([{ noteId: "note-1", version: 2 }])
    expect(props.clearScheduledPersist).toHaveBeenCalledWith("note-1")
    expect(ref.current!.getOpenNotes()[0].mainPosition).toEqual({ x: 40, y: 60 })
  })

  it("schedules a retry when persistence fails", async () => {
    const props = createHarnessProps()
    props.persistWorkspace.mockRejectedValueOnce(new Error("fail"))
    const ref = await renderHarness(props)

    await act(async () => {
      await ref.current!.update("note-1", { x: 10, y: 20 })
    })

    expect(props.scheduleWorkspacePersist).toHaveBeenCalledWith("note-1", { x: 10, y: 20 })
  })

  it("skips persistence when persist flag is false", async () => {
    const props = createHarnessProps()
    const ref = await renderHarness(props)

    await act(async () => {
      await ref.current!.update("note-1", { x: 5, y: 5 }, false)
    })

    expect(props.persistWorkspace).not.toHaveBeenCalled()
    expect(props.scheduleWorkspacePersist).not.toHaveBeenCalled()
  })
})
