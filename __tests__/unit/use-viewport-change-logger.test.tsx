import React from "react"
import TestRenderer, { act } from "react-test-renderer"

import { useViewportChangeLogger } from "@/lib/hooks/annotation/use-viewport-change-logger"
import { createDefaultCanvasState } from "@/lib/canvas/canvas-defaults"

jest.mock("@/lib/utils/debug-logger", () => ({
  debugLog: jest.fn(() => Promise.resolve()),
}))

const { debugLog } = require("@/lib/utils/debug-logger")

type Props = {
  translateX: number
  translateY: number
  isDragging?: boolean
}

function Harness({ translateX, translateY, isDragging = false }: Props) {
  const canvasState = {
    ...createDefaultCanvasState(),
    translateX,
    translateY,
    isDragging,
  }

  useViewportChangeLogger({
    noteId: "note-1",
    canvasState,
  })

  return null
}

describe("useViewportChangeLogger", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("logs when viewport translation changes", async () => {
    let renderer: TestRenderer.ReactTestRenderer

    await act(async () => {
      renderer = TestRenderer.create(<Harness translateX={0} translateY={0} />)
    })

    await act(async () => {
      renderer!.update(<Harness translateX={50} translateY={-20} />)
    })

    expect(debugLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "viewport_changed",
        metadata: expect.objectContaining({
          from: { x: 0, y: 0 },
          to: { x: 50, y: -20 },
          delta: { x: 50, y: -20 },
          noteId: "note-1",
        }),
      }),
    )
  })

  it("does not log when translation is unchanged", async () => {
    let renderer: TestRenderer.ReactTestRenderer

    await act(async () => {
      renderer = TestRenderer.create(<Harness translateX={0} translateY={0} />)
    })

    await act(async () => {
      renderer!.update(<Harness translateX={0} translateY={0} isDragging />)
    })

    expect(debugLog).not.toHaveBeenCalled()
  })
})
