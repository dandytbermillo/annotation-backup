import React, { forwardRef, useImperativeHandle } from "react"
import TestRenderer, { act } from "react-test-renderer"

import type { CanvasViewportState } from "@/lib/canvas/canvas-defaults"
import { useCanvasPointerHandlers } from "@/lib/hooks/annotation/use-canvas-pointer-handlers"

jest.mock("@/lib/canvas/zoom-utils", () => ({
  getWheelZoomMultiplier: jest.fn(() => 1.2),
}))

if (typeof (global as any).Element === "undefined") {
  ;(global as any).Element = class {}
}

type HandlerHandles = ReturnType<typeof useCanvasPointerHandlers>

type HarnessProps = {
  options: Parameters<typeof useCanvasPointerHandlers>[0]
}

const PointerHarness = forwardRef<HandlerHandles, HarnessProps>(({ options }, ref) => {
  const handlers = useCanvasPointerHandlers(options)
  useImperativeHandle(ref, () => handlers)
  return null
})
PointerHarness.displayName = "PointerHarness"

function createCanvasState(): CanvasViewportState {
  return {
    translateX: 0,
    translateY: 0,
    zoom: 1,
    showConnections: true,
    isDragging: false,
    lastMouseX: 0,
    lastMouseY: 0,
  }
}

describe("useCanvasPointerHandlers", () => {
  const enableGuards = jest.fn()
  const disableGuards = jest.fn()
  const updateCanvasTransform = jest.fn()
  const capture = jest.fn()

  const setup = async (overrides: Partial<Parameters<typeof useCanvasPointerHandlers>[0]> = {}) => {
    const canvasState = createCanvasState()
    const options = {
      captureInteractionPoint: capture,
      setCanvasState: jest.fn(),
      canvasStateRef: { current: canvasState },
      updateCanvasTransform,
      enableSelectionGuards: enableGuards,
      disableSelectionGuards: disableGuards,
      canvasState,
      ...overrides,
    }

    const ref = React.createRef<HandlerHandles>()
    await act(async () => {
      TestRenderer.create(<PointerHarness ref={ref} options={options} />)
    })
    return { ref, options }
  }

  beforeEach(() => {
    enableGuards.mockClear()
    disableGuards.mockClear()
    updateCanvasTransform.mockClear()
    capture.mockClear()
  })

  it("enables selection guards on mouse down", async () => {
    const { ref, options } = await setup()
    const preventDefault = jest.fn()
    ref.current!.handleCanvasMouseDown({
      button: 0,
      clientX: 10,
      clientY: 20,
      preventDefault,
      target: null,
    } as unknown as React.MouseEvent)

    expect(options.setCanvasState).toHaveBeenCalled()
    expect(enableGuards).toHaveBeenCalledTimes(1)
    expect(preventDefault).toHaveBeenCalled()
  })

  it("updates transform when dragging", async () => {
    const canvasState = createCanvasState()
    canvasState.isDragging = true
    canvasState.lastMouseX = 5
    canvasState.lastMouseY = 5

    const { ref } = await setup({
      canvasState,
      canvasStateRef: { current: canvasState },
    })

    ref.current!.handleCanvasMouseMove({
      clientX: 15,
      clientY: 25,
    } as MouseEvent)
    expect(updateCanvasTransform).toHaveBeenCalledTimes(1)
  })

  it("disables guards on mouse up", async () => {
    const { ref, options } = await setup()
    ref.current!.handleCanvasMouseUp()
    expect(options.setCanvasState).toHaveBeenCalled()
    expect(disableGuards).toHaveBeenCalledTimes(1)
  })

  it("zooms when wheel + shift held", async () => {
    const canvasState = createCanvasState()
    const { ref } = await setup({ canvasState })
    const preventDefault = jest.fn()
    const currentTarget = {
      getBoundingClientRect: () => ({ left: 0, top: 0 }),
    }
    ref.current!.handleWheel({
      shiftKey: true,
      preventDefault,
      currentTarget,
      clientX: 100,
      clientY: 120,
      nativeEvent: {} as WheelEvent,
    } as React.WheelEvent)

    expect(preventDefault).toHaveBeenCalled()
    expect(updateCanvasTransform).toHaveBeenCalled()
  })
})
