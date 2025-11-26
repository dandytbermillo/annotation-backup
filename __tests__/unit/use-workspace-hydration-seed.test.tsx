import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react"
import TestRenderer, { act } from "react-test-renderer"

import type { CanvasItem } from "@/types/canvas-items"
import { useWorkspaceHydrationSeed } from "@/lib/hooks/annotation/use-workspace-hydration-seed"

jest.mock("@/lib/utils/debug-logger", () => ({
  debugLog: jest.fn(),
}))

type WorkspaceSeedHarnessProps = {
  noteId: string
  workspaceMainPosition: { x: number; y: number } | null
  hydrationSuccess: boolean
  initialItems: CanvasItem[]
  workspaceSeededNotesRef: React.MutableRefObject<Set<string>>
  workspaceSnapshotRevision?: number
}

type WorkspaceSeedHarnessHandle = {
  getItems: () => CanvasItem[]
}

const WorkspaceSeedHarness = forwardRef<WorkspaceSeedHarnessHandle, WorkspaceSeedHarnessProps>(
  (
    {
      noteId,
      workspaceMainPosition,
      hydrationSuccess,
      initialItems,
      workspaceSeededNotesRef,
      workspaceSnapshotRevision = 0,
    },
    ref,
  ) => {
    const [items, setItems] = useState<CanvasItem[]>(initialItems)
    const itemsRef = useRef(items)

    useEffect(() => {
      itemsRef.current = items
    }, [items])

    useWorkspaceHydrationSeed({
      noteId,
      workspaceMainPosition,
      hydrationSuccess,
      canvasItems: items,
      setCanvasItems: setItems,
      getItemNoteId: item => item.noteId ?? null,
      workspaceSeededNotesRef,
      workspaceSnapshotRevision,
    })

    useImperativeHandle(ref, () => ({
      getItems: () => itemsRef.current,
    }))

    return null
  },
)
WorkspaceSeedHarness.displayName = "WorkspaceSeedHarness"

describe("useWorkspaceHydrationSeed", () => {
  const basePanel: CanvasItem = {
    id: "panel-1",
    itemType: "panel",
    panelId: "main",
    noteId: "note-1",
    position: { x: 0, y: 0 },
  }

  it("updates the main panel position and marks the note as seeded", async () => {
    const workspaceSeededNotesRef = { current: new Set<string>() }
    const ref = React.createRef<WorkspaceSeedHarnessHandle>()

    await act(async () => {
      TestRenderer.create(
        <WorkspaceSeedHarness
          ref={ref}
          noteId="note-1"
          workspaceMainPosition={{ x: 120, y: 240 }}
          hydrationSuccess={false}
          initialItems={[basePanel]}
          workspaceSeededNotesRef={workspaceSeededNotesRef}
        />,
      )
    })

    expect(workspaceSeededNotesRef.current.has("note-1")).toBe(true)
    const updatedItems = ref.current!.getItems()
    expect(updatedItems[0].position).toEqual({ x: 120, y: 240 })
  })

  it("skips seeding when hydration already succeeded", async () => {
    const workspaceSeededNotesRef = { current: new Set<string>() }
    const ref = React.createRef<WorkspaceSeedHarnessHandle>()

    await act(async () => {
      TestRenderer.create(
        <WorkspaceSeedHarness
          ref={ref}
          noteId="note-1"
          workspaceMainPosition={{ x: 300, y: 400 }}
          hydrationSuccess={true}
          initialItems={[basePanel]}
          workspaceSeededNotesRef={workspaceSeededNotesRef}
        />,
      )
    })

    expect(workspaceSeededNotesRef.current.size).toBe(0)
    const updatedItems = ref.current!.getItems()
    expect(updatedItems[0].position).toEqual({ x: 0, y: 0 })
  })

  it("marks the note as seeded immediately when snapshot revision changes", async () => {
    const workspaceSeededNotesRef = { current: new Set<string>() }
    const ref = React.createRef<WorkspaceSeedHarnessHandle>()

    let renderer: TestRenderer.ReactTestRenderer | null = null
    await act(async () => {
      renderer = TestRenderer.create(
        <WorkspaceSeedHarness
          ref={ref}
          noteId="note-1"
          workspaceMainPosition={{ x: 200, y: 300 }}
          hydrationSuccess={false}
          initialItems={[basePanel]}
          workspaceSeededNotesRef={workspaceSeededNotesRef}
          workspaceSnapshotRevision={0}
        />,
      )
    })

    expect(workspaceSeededNotesRef.current.has("note-1")).toBe(true)
    const itemsAfterInitial = ref.current!.getItems()
    expect(itemsAfterInitial[0].position).toEqual({ x: 200, y: 300 })

    workspaceSeededNotesRef.current.clear()

    await act(async () => {
      renderer!.update(
        <WorkspaceSeedHarness
          ref={ref}
          noteId="note-1"
          workspaceMainPosition={{ x: 50, y: 75 }}
          hydrationSuccess={false}
          initialItems={[itemsAfterInitial[0]]}
          workspaceSeededNotesRef={workspaceSeededNotesRef}
          workspaceSnapshotRevision={1}
        />,
      )
    })

    expect(workspaceSeededNotesRef.current.has("note-1")).toBe(true)
    const itemsAfterRevision = ref.current!.getItems()
    expect(itemsAfterRevision[0].position).toEqual({ x: 200, y: 300 })
  })
})
