import React, { forwardRef, useImperativeHandle } from "react"
import TestRenderer, { act } from "react-test-renderer"

import type { CanvasItem } from "@/types/canvas-items"
import type { HydrationStatus } from "@/lib/hooks/use-canvas-hydration"
import {
  useHydrationPanelMerge,
  useHydrationDispatcher,
  useHydrationNoteTracker,
  useFreshNoteNotifier,
} from "@/lib/hooks/annotation/use-hydration-panel-builder"

type HelperHandles = {
  merge: ReturnType<typeof useHydrationPanelMerge>
  dispatcher: ReturnType<typeof useHydrationDispatcher>
  tracker: ReturnType<typeof useHydrationNoteTracker>
  notifyFresh: (noteId: string) => void
}

type HelperHarnessProps = {
  freshNoteSet?: Set<string>
  onFreshNoteHydrated?: (noteId: string) => void
  dispatchMock: jest.Mock
  workspaceSeededNotesRef: React.MutableRefObject<Set<string>>
}

const HelperHarness = forwardRef<HelperHandles, HelperHarnessProps>(
  ({ freshNoteSet, onFreshNoteHydrated, dispatchMock, workspaceSeededNotesRef }, ref) => {
    const merge = useHydrationPanelMerge({
      getItemNoteId: item => item.noteId ?? null,
    })

    const dispatcher = useHydrationDispatcher({
      dispatch: dispatchMock,
      workspaceSeededNotesRef,
      getItemNoteId: item => item.noteId ?? null,
    })

    const tracker = useHydrationNoteTracker()
    const notifyFresh = useFreshNoteNotifier({
      freshNoteSet: freshNoteSet ?? new Set<string>(),
      onFreshNoteHydrated,
    })

    useImperativeHandle(ref, () => ({
      merge,
      dispatcher,
      tracker,
      notifyFresh,
    }))

    return null
  },
)
HelperHarness.displayName = "HelperHarness"

describe("useHydration helpers", () => {
  const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {})
  afterAll(() => {
    consoleErrorSpy.mockRestore()
  })

  const baseHydrationStatus: HydrationStatus = {
    success: true,
    loading: false,
    error: null,
    panelsLoaded: 1,
    cameraLoaded: true,
    panels: [
      {
        id: "main",
        noteId: "note-1",
        position: { x: 10, y: 20 },
        size: { width: 100, height: 120 },
        zIndex: 0,
        type: "editor",
        state: "active",
        metadata: { annotationType: "main" },
      },
    ],
    refetch: async () => {},
  }

  const renderHarness = (freshNoteSet?: Set<string>, onFresh?: jest.Mock) => {
    const dispatchMock = jest.fn()
    const workspaceSeededNotesRef = { current: new Set<string>() }
    const ref = React.createRef<HelperHandles>()
    act(() => {
      TestRenderer.create(
        <HelperHarness
          ref={ref}
          dispatchMock={dispatchMock}
          workspaceSeededNotesRef={workspaceSeededNotesRef}
          freshNoteSet={freshNoteSet}
          onFreshNoteHydrated={onFresh}
        />,
      )
    })
    return { ref, dispatchMock, workspaceSeededNotesRef }
  }

  it("dedupes panels with identical store keys via merge helper", () => {
    const { ref } = renderHarness()
    const merge = ref.current!.merge
    const prevItems: CanvasItem[] = [
      { id: "p1", itemType: "panel", panelId: "main", noteId: "note-1", position: { x: 0, y: 0 } },
    ]
    const duplicate: CanvasItem = {
      id: "dup",
      itemType: "panel",
      panelId: "main",
      noteId: "note-1",
      position: { x: 5, y: 5 },
      storeKey: "note-1::main",
    }
    const result = merge({
      prevItems,
      newItems: [duplicate],
      targetNoteId: "note-1",
    })

    expect(result.itemsToAdd).toHaveLength(0)
    expect(result.nextItems).toEqual(prevItems)
  })

  it("dispatches hydrated panels and seeds workspace positions", () => {
    const { ref, dispatchMock, workspaceSeededNotesRef } = renderHarness()
    const dispatcher = ref.current!.dispatcher
    const initialItems: CanvasItem[] = [
      {
        id: "main-panel",
        itemType: "panel",
        panelId: "main",
        noteId: "note-1",
        position: { x: 0, y: 0 },
      },
    ]
    const itemsToAdd: CanvasItem[] = [
      {
        id: "main-panel",
        itemType: "panel",
        panelId: "main",
        noteId: "note-1",
        position: { x: 10, y: 10 },
        storeKey: "note-1::main",
      },
    ]
    let updatedItems: CanvasItem[] = initialItems
    const setCanvasItems = jest.fn(updater => {
      updatedItems = updater(initialItems)
      return updatedItems
    })

    dispatcher({
      itemsToAdd,
      workspaceMainPosition: { x: 100, y: 200 },
      mainPanelExists: false,
      targetNoteId: "note-1",
      initialCanvasSetupRef: { current: false },
      setCanvasItems,
    })

    expect(dispatchMock).toHaveBeenCalledWith({
      type: "ADD_PANEL",
      payload: expect.objectContaining({
        id: "note-1::main",
      }),
    })
    expect(updatedItems.find(item => item.panelId === "main")?.position).toEqual({ x: 100, y: 200 })
    expect(workspaceSeededNotesRef.current.has("note-1")).toBe(true)
  })

  it("tracker skips already hydrated notes", () => {
    const { ref } = renderHarness()
    const tracker = ref.current!.tracker

    const firstEval = tracker.evaluateHydration({
      targetNoteId: "note-1",
      hydrationStatus: baseHydrationStatus,
      mainPanelExists: false,
    })
    expect(firstEval.shouldHydrate).toBe(true)

    tracker.markHydrated("note-1")

    const secondEval = tracker.evaluateHydration({
      targetNoteId: "note-1",
      hydrationStatus: baseHydrationStatus,
      mainPanelExists: true,
    })
    expect(secondEval.shouldHydrate).toBe(false)
    expect(secondEval.skipHydration).toBe(true)

    tracker.markNoPanels("note-2", false)
  })

  it("fresh note notifier only fires for tracked ids", async () => {
    const onFresh = jest.fn()
    const freshSet = new Set(["fresh-note"])
    const { ref } = renderHarness(freshSet, onFresh)
    const notify = ref.current!.notifyFresh

    await act(async () => {
      notify("fresh-note")
      await Promise.resolve()
    })
    expect(onFresh).toHaveBeenCalledWith("fresh-note")

    onFresh.mockClear()
    await act(async () => {
      notify("other-note")
      await Promise.resolve()
    })
    expect(onFresh).not.toHaveBeenCalled()
  })
})
