import React, { forwardRef, useImperativeHandle, useState } from "react"
import TestRenderer, { act } from "react-test-renderer"

import { useMainPanelRestore } from "@/lib/hooks/annotation/use-main-panel-restore"
import type { CanvasItem } from "@/types/canvas-items"
import type { DataStore } from "@/lib/data-store"

jest.mock("@/lib/utils/debug-logger", () => ({
  debugLog: jest.fn(() => Promise.resolve()),
}))

const { debugLog } = require("@/lib/utils/debug-logger")

type Handler = ReturnType<typeof useMainPanelRestore> & {
  getItems: () => CanvasItem[]
}

type HarnessProps = {
  initialItems: CanvasItem[]
  dataStore?: DataStore | null
  persistPanelUpdate: jest.Mock
  updateMainPosition: jest.Mock
  onMainOnlyLayoutHandled?: jest.Mock
  centerOnPanel: jest.Mock
}

const Harness = forwardRef<Handler, HarnessProps>(
  (
    {
      initialItems,
      dataStore = null,
      persistPanelUpdate,
      updateMainPosition,
      onMainOnlyLayoutHandled,
      centerOnPanel,
    },
    ref,
  ) => {
    const [items, setItems] = useState(initialItems)

    const handlers = useMainPanelRestore({
      setCanvasItems: setItems,
      getItemNoteId: (item: CanvasItem) => item.noteId ?? null,
      dataStore,
      persistPanelUpdate,
      updateMainPosition,
      onMainOnlyLayoutHandled,
      centerOnPanel,
    })

    useImperativeHandle(
      ref,
      () => ({
        ...handlers,
        getItems: () => items,
      }),
      [handlers, items],
    )

    return null
  },
)
Harness.displayName = "MainPanelRestoreHarness"

const createPanel = (noteId: string, overrides: Partial<CanvasItem> = {}): CanvasItem => ({
  id: `panel-${noteId}`,
  itemType: "panel",
  panelId: "main",
  noteId,
  position: { x: 0, y: 0 },
  ...overrides,
})

describe("useMainPanelRestore", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("updates main panel position, persists changes, and centers on the panel", async () => {
    const dataStore = {
      update: jest.fn(),
    } as unknown as DataStore

    const persistPanelUpdate = jest.fn(() => Promise.resolve())
    const updateMainPosition = jest.fn(() => Promise.resolve())
    const onMainOnlyLayoutHandled = jest.fn()
    const centerOnPanel = jest.fn()

    const ref = React.createRef<Handler>()
    const initialItems = [createPanel("note-1"), createPanel("note-2", { position: { x: 10, y: 10 } })]

    await act(async () => {
      TestRenderer.create(
        <Harness
          ref={ref}
          initialItems={initialItems}
          dataStore={dataStore}
          persistPanelUpdate={persistPanelUpdate}
          updateMainPosition={updateMainPosition}
          onMainOnlyLayoutHandled={onMainOnlyLayoutHandled}
          centerOnPanel={centerOnPanel}
        />,
      )
    })

    await act(async () => {
      ref.current?.handleRestoreMainPosition("note-1", { x: 400, y: 250 })
    })

    const items = ref.current?.getItems() ?? []
    expect(items[0]?.position).toEqual({ x: 400, y: 250 })
    expect(items[1]?.position).toEqual({ x: 10, y: 10 })

    expect(dataStore.update).toHaveBeenCalledWith("note-1::main", { position: { x: 400, y: 250 } })
    expect(persistPanelUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        panelId: "main",
        storeKey: "note-1::main",
        coordinateSpace: "world",
        position: { x: 400, y: 250 },
      }),
    )
    expect(updateMainPosition).toHaveBeenCalledWith("note-1", { x: 400, y: 250 })
    expect(onMainOnlyLayoutHandled).toHaveBeenCalledWith("note-1")
    expect(centerOnPanel).toHaveBeenCalledWith("note-1::main")
    expect(debugLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "restore_main_position",
        metadata: { noteId: "note-1", position: { x: 400, y: 250 } },
      }),
    )
  })

  it("gracefully handles missing dataStore and non-matching panels", async () => {
    const persistPanelUpdate = jest.fn(() => Promise.resolve())
    const updateMainPosition = jest.fn(() => Promise.resolve())
    const centerOnPanel = jest.fn()

    const ref = React.createRef<Handler>()
    const initialItems = [createPanel("note-2")]

    await act(async () => {
      TestRenderer.create(
        <Harness
          ref={ref}
          initialItems={initialItems}
          persistPanelUpdate={persistPanelUpdate}
          updateMainPosition={updateMainPosition}
          centerOnPanel={centerOnPanel}
        />,
      )
    })

    await act(async () => {
      ref.current?.handleRestoreMainPosition("note-1", { x: 50, y: 60 })
    })

    const items = ref.current?.getItems() ?? []
    expect(items[0]?.position).toEqual({ x: 0, y: 0 })
    expect(persistPanelUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        storeKey: "note-1::main",
        position: { x: 50, y: 60 },
      }),
    )
    expect(updateMainPosition).toHaveBeenCalledWith("note-1", { x: 50, y: 60 })
    expect(centerOnPanel).toHaveBeenCalledWith("note-1::main")
  })
})
