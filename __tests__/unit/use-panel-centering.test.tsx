import React, { forwardRef, useImperativeHandle } from "react"
import TestRenderer, { act } from "react-test-renderer"

import { usePanelCentering } from "@/lib/hooks/annotation/use-panel-centering"
import { createDefaultCanvasState } from "@/lib/canvas/canvas-defaults"
import { ensurePanelKey } from "@/lib/canvas/composite-id"
import type { CanvasItem } from "@/types/canvas-items"

jest.mock("react-dom", () => ({
  flushSync: (cb: () => void) => cb(),
}))

type PanelCenteringHandles = ReturnType<typeof usePanelCentering>

type HarnessProps = {
  options: Parameters<typeof usePanelCentering>[0]
}

const Harness = forwardRef<PanelCenteringHandles, HarnessProps>(({ options }, ref) => {
  const handlers = usePanelCentering(options)
  useImperativeHandle(ref, () => handlers, [handlers])
  return null
})
Harness.displayName = "PanelCenteringHarness"

function createOptions(): Parameters<typeof usePanelCentering>[0] {
  const canvasState = createDefaultCanvasState()
  const canvasStateRef = { current: canvasState }
  const setCanvasState = jest.fn((updater: any) => {
    canvasStateRef.current =
      typeof updater === "function" ? updater(canvasStateRef.current) : updater
    return canvasStateRef.current
  })
  return {
    noteId: "note-1",
    canvasItemsRef: { current: [] as CanvasItem[] },
    dataStore: null,
    resolveWorkspacePosition: () => null,
    isDefaultOffscreenPosition: () => false,
    canvasStateRef,
    setCanvasState,
    dispatch: jest.fn(),
  }
}

describe("usePanelCentering", () => {
  const originalDocument = (global as any).document
  const originalWindow = (global as any).window

  beforeEach(() => {
    ;(global as any).document = {
      body: { innerHTML: "" },
      querySelector: jest.fn(),
      getElementById: jest.fn(),
    }
    ;(global as any).window = {
      innerWidth: 1000,
      innerHeight: 800,
    }
  })

  afterEach(() => {
    if (originalDocument === undefined) {
      delete (global as any).document
    } else {
      (global as any).document = originalDocument
    }

    if (originalWindow === undefined) {
      delete (global as any).window
    } else {
      (global as any).window = originalWindow
    }
  })

  it("resolves stored panel positions", async () => {
    const options = createOptions()
    const storeKey = ensurePanelKey("note-1", "main")
    options.canvasItemsRef.current = [
      {
        itemType: "panel",
        panelId: "main",
        position: { x: 15, y: 30 },
        storeKey,
      } as CanvasItem,
    ]

    const ref = React.createRef<PanelCenteringHandles>()
    await act(async () => {
      TestRenderer.create(<Harness ref={ref} options={options} />)
    })

    expect(ref.current?.resolvePanelPosition("main")).toEqual({ x: 15, y: 30 })
  })

  it("centers on a panel and updates canvas transforms", async () => {
    jest.useFakeTimers()
    const options = createOptions()
    const storeKey = ensurePanelKey("note-1", "main")
    options.canvasItemsRef.current = [
      {
        itemType: "panel",
        panelId: "main",
        position: { x: 100, y: 50 },
        storeKey,
      } as CanvasItem,
    ]

    const panelElement = { offsetWidth: 400, offsetHeight: 300 }
    ;(document as any).querySelector = jest.fn((selector: string) => {
      if (selector === '[data-panel-id="main"]') {
        return panelElement
      }
      return null
    })
    const canvasEl = { style: { transition: "" }, offsetHeight: 0 }
    ;(document as any).getElementById = jest.fn((id: string) => (id === "infinite-canvas" ? canvasEl : null))

    const ref = React.createRef<PanelCenteringHandles>()
    await act(async () => {
      TestRenderer.create(<Harness ref={ref} options={options} />)
    })

    ref.current?.centerOnPanel("main")
    jest.runOnlyPendingTimers()
    jest.useRealTimers()

    expect(options.setCanvasState).toHaveBeenCalled()
    expect(options.dispatch).toHaveBeenCalledWith({
      type: "SET_CANVAS_STATE",
      payload: expect.objectContaining({ translateX: 200, translateY: 200 }),
    })
    expect(options.canvasStateRef.current.translateX).toBe(200)
    expect(options.canvasStateRef.current.translateY).toBe(200)
  })
})
