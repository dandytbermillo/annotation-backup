import React, { forwardRef, useImperativeHandle } from "react"
import TestRenderer, { act } from "react-test-renderer"

import type { MutableRefObject } from "react"
import { useCanvasInteractionCapture } from "@/lib/hooks/annotation/use-canvas-interaction-capture"

type InteractionHandlers = ReturnType<typeof useCanvasInteractionCapture>

type HarnessProps = {
  lastInteractionRef: MutableRefObject<{ x: number; y: number } | null>
}

const InteractionCaptureHarness = forwardRef<InteractionHandlers, HarnessProps>(
  ({ lastInteractionRef }, ref) => {
    const handlers = useCanvasInteractionCapture({ lastInteractionRef })
    useImperativeHandle(ref, () => handlers)
    return null
  },
)
InteractionCaptureHarness.displayName = "InteractionCaptureHarness"

describe("useCanvasInteractionCapture", () => {
  it("updates refs and window metadata when capturing interactions", async () => {
    const lastInteractionRef: MutableRefObject<{ x: number; y: number } | null> = {
      current: null,
    }
    const ref = React.createRef<InteractionHandlers>()

    await act(async () => {
      TestRenderer.create(<InteractionCaptureHarness ref={ref} lastInteractionRef={lastInteractionRef} />)
    })

    expect(ref.current).toBeTruthy()
    ref.current!.captureInteractionPoint({ clientX: 10, clientY: 20 })
    expect(lastInteractionRef.current).toEqual({ x: 10, y: 20 })
    expect((window as any).__canvasLastInteraction).toEqual({ x: 10, y: 20 })

    ref.current!.handleMouseMoveCapture({ clientX: 30, clientY: 40 } as React.MouseEvent)
    expect(lastInteractionRef.current).toEqual({ x: 30, y: 40 })

    ref.current!.handleWheelCapture({ clientX: 50, clientY: 60 } as React.WheelEvent)
    expect(lastInteractionRef.current).toEqual({ x: 50, y: 60 })
  })
})
