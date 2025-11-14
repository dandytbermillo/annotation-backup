import React, { forwardRef, useImperativeHandle } from "react"
import TestRenderer, { act } from "react-test-renderer"

import { usePanelCreationHandler } from "@/lib/hooks/annotation/use-panel-creation-handler"
import { createDefaultCanvasState } from "@/lib/canvas/canvas-defaults"
import type { CanvasItem } from "@/types/canvas-items"
import type { DataStore } from "@/lib/data-store"

jest.mock("@/lib/collab-mode", () => ({
  isPlainModeActive: jest.fn(),
}))

jest.mock("@/lib/utils/debug-logger", () => ({
  debugLog: jest.fn(() => Promise.resolve()),
  isDebugEnabled: jest.fn(() => false),
}))

jest.mock("@/lib/canvas/coordinate-utils", () => ({
  screenToWorld: jest.fn(({ x, y }) => ({ x: x + 10, y: y + 20 })),
}))

const { isPlainModeActive } = require("@/lib/collab-mode")

type Handler = ReturnType<typeof usePanelCreationHandler>["handleCreatePanel"]

type HarnessProps = {
  options: Parameters<typeof usePanelCreationHandler>[0]
}

const Harness = forwardRef<Handler, HarnessProps>(({ options }, ref) => {
  const { handleCreatePanel } = usePanelCreationHandler(options)
  useImperativeHandle(ref, () => handleCreatePanel, [handleCreatePanel])
  return null
})
Harness.displayName = "PanelCreationHandlerHarness"

function createOptions() {
  let items: CanvasItem[] = []
  const setCanvasItems = jest.fn((updater: any) => {
    if (typeof updater === "function") {
      items = updater(items)
    } else {
      items = updater
    }
    return items
  })

  const dataStore = {
    get: jest.fn(() => undefined),
    set: jest.fn(),
    update: jest.fn(),
  } as unknown as DataStore

  const branchesMap = new Map<string, any>()
  const provider = {
    setCurrentNote: jest.fn(),
    getBranchesMap: jest.fn(() => new Map<string, any>()),
  }

  const persistPanelCreate = jest.fn(() => Promise.resolve())
  const persistPanelUpdate = jest.fn(() => Promise.resolve())

  const options = {
    noteId: "note-1",
    canvasState: createDefaultCanvasState(),
    getItemNoteId: (item: CanvasItem) => item.noteId ?? null,
    setCanvasItems,
    dataStore,
    branchesMap,
    provider,
    persistPanelCreate,
    persistPanelUpdate,
  }

  return { options, setCanvasItems, provider, persistPanelCreate, persistPanelUpdate, branchesMap, getItems: () => items }
}

describe("usePanelCreationHandler", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    isPlainModeActive.mockReturnValue(true)
  })

  it("creates a panel in plain mode and persists it", async () => {
    const { options, persistPanelCreate, persistPanelUpdate, getItems } = createOptions()
    const ref = React.createRef<Handler>()

    await act(async () => {
      TestRenderer.create(<Harness ref={ref} options={options} />)
    })

    await act(async () => {
      ref.current?.("panel-main", undefined, { x: 100, y: 50 })
    })

    expect(getItems()).toHaveLength(1)
    expect(getItems()[0].panelId).toBe("panel-main")
    expect(persistPanelCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        panelId: "panel-main",
        coordinateSpace: "world",
      }),
    )
    expect(persistPanelUpdate).toHaveBeenCalled()
  })

  it("uses provider branches when not in plain mode", async () => {
    isPlainModeActive.mockReturnValue(false)
    const { options, provider, branchesMap } = createOptions()
    const panelStoreKey = "note-1::panel-branch"
    branchesMap.set(panelStoreKey, { type: "note", position: { x: 5, y: 5 } })
    provider.getBranchesMap = jest.fn(() => branchesMap)

    const ref = React.createRef<Handler>()
    await act(async () => {
      TestRenderer.create(<Harness ref={ref} options={options} />)
    })

    await act(async () => {
      ref.current?.("panel-branch", undefined, { x: 20, y: 30 }, "note-1", false, "screen")
    })

    expect(provider.setCurrentNote).toHaveBeenCalledWith("note-1")
  })
})
