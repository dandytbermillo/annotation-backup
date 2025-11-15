import React, { forwardRef, useImperativeHandle, useState } from "react"
import TestRenderer, { act } from "react-test-renderer"

import { useComponentCreationHandler } from "@/lib/hooks/annotation/use-component-creation-handler"
import { createDefaultCanvasState, type CanvasViewportState } from "@/lib/canvas/canvas-defaults"
import type { CanvasItem } from "@/types/canvas-items"

type Handler = ReturnType<typeof useComponentCreationHandler> & {
  getItems: () => CanvasItem[]
}

type HarnessProps = {
  canvasState: CanvasViewportState
  initialItems?: CanvasItem[]
}

const Harness = forwardRef<Handler, HarnessProps>(({ canvasState, initialItems = [] }, ref) => {
  const [items, setItems] = useState<CanvasItem[]>(initialItems)
  const handlers = useComponentCreationHandler({
    canvasState,
    canvasItems: items,
    setCanvasItems: setItems,
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
})
Harness.displayName = "ComponentCreationHandlerHarness"

describe("useComponentCreationHandler", () => {
  let dateSpy: jest.SpyInstance<number, []>
  let randomSpy: jest.SpyInstance<number, []>
  const originalInnerWidth = window.innerWidth
  const originalInnerHeight = window.innerHeight

  beforeEach(() => {
    dateSpy = jest.spyOn(Date, "now").mockReturnValue(1730000000000)
    randomSpy = jest.spyOn(Math, "random").mockReturnValue(0.123456789)
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 1200,
      writable: true,
    })
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: 800,
      writable: true,
    })
  })

  afterEach(() => {
    dateSpy.mockRestore()
    randomSpy.mockRestore()
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: originalInnerWidth,
      writable: true,
    })
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: originalInnerHeight,
      writable: true,
    })
  })

  it("adds a floating component centered in world space when no position is provided", async () => {
    const canvasState: CanvasViewportState = {
      ...createDefaultCanvasState(),
      translateX: -300,
      translateY: -150,
      zoom: 2,
    }

    const ref = React.createRef<Handler>()
    await act(async () => {
      TestRenderer.create(<Harness ref={ref} canvasState={canvasState} />)
    })

    await act(async () => {
      ref.current?.handleAddComponent("timer")
    })

    const items = ref.current?.getItems() ?? []
    expect(items).toHaveLength(1)
    expect(items[0]?.componentType).toBe("timer")
    expect(items[0]?.position).toEqual({ x: 275, y: 125 })
    expect(ref.current?.floatingComponents).toHaveLength(1)
    expect(ref.current?.stickyNoteItems).toHaveLength(0)
  })

  it("adds sticky notes using screen-space positioning", async () => {
    const canvasState = createDefaultCanvasState()
    const ref = React.createRef<Handler>()

    await act(async () => {
      TestRenderer.create(<Harness ref={ref} canvasState={canvasState} />)
    })

    await act(async () => {
      ref.current?.handleAddComponent("sticky-note")
    })

    const items = ref.current?.getItems() ?? []
    expect(items[0]?.componentType).toBe("sticky-note")
    expect(items[0]?.position).toEqual({ x: 425, y: 250 })
    expect(ref.current?.stickyNoteItems).toHaveLength(1)
    expect(ref.current?.floatingComponents).toHaveLength(0)
  })

  it("updates component positions and removes them on close", async () => {
    const canvasState = createDefaultCanvasState()
    const ref = React.createRef<Handler>()

    await act(async () => {
      TestRenderer.create(<Harness ref={ref} canvasState={canvasState} />)
    })

    await act(async () => {
      ref.current?.handleAddComponent("calculator")
    })

    const initialItems = ref.current?.getItems() ?? []
    const firstId = initialItems[0]?.id
    expect(firstId).toBeDefined()

    await act(async () => {
      if (firstId) {
        ref.current?.handleComponentPositionChange(firstId, { x: 500, y: 480 })
      }
    })

    const updatedItems = ref.current?.getItems() ?? []
    expect(updatedItems[0]?.position).toEqual({ x: 500, y: 480 })

    await act(async () => {
      if (firstId) {
        ref.current?.handleComponentClose(firstId)
      }
    })

    expect(ref.current?.getItems() ?? []).toHaveLength(0)
    expect(ref.current?.componentItems).toHaveLength(0)
  })
})
