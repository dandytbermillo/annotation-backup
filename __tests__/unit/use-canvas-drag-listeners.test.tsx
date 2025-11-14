import React from "react"
import TestRenderer, { act } from "react-test-renderer"

import { useCanvasDragListeners } from "@/lib/hooks/annotation/use-canvas-drag-listeners"

type HarnessProps = {
  isDragging: boolean
  onMouseMove: jest.Mock
  onMouseUp: jest.Mock
}

function DragListenersHarness({ isDragging, onMouseMove, onMouseUp }: HarnessProps) {
  useCanvasDragListeners({
    isDragging,
    onMouseMove,
    onMouseUp,
  })
  return null
}

const originalDocument = global.document

beforeAll(() => {
  const docMock = {
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
  } as unknown as Document
  ;(global as any).document = docMock
})

afterAll(() => {
  ;(global as any).document = originalDocument
})

describe("useCanvasDragListeners", () => {
  beforeEach(() => {
    ;(document as any).addEventListener.mockClear()
    ;(document as any).removeEventListener.mockClear()
  })

  it("registers and cleans up listeners based on dragging state", async () => {
    const move = jest.fn()
    const up = jest.fn()
    let renderer: TestRenderer.ReactTestRenderer

    await act(async () => {
      renderer = TestRenderer.create(
        <DragListenersHarness isDragging={false} onMouseMove={move} onMouseUp={up} />,
      )
    })

    expect((document as any).addEventListener).toHaveBeenCalledWith("mousemove", move)
    expect((document as any).addEventListener).toHaveBeenCalledWith("mouseup", up)

    await act(async () => {
      renderer.update(<DragListenersHarness isDragging={true} onMouseMove={move} onMouseUp={up} />)
    })

    expect((document as any).removeEventListener).toHaveBeenCalledWith("mousemove", move)
    expect((document as any).removeEventListener).toHaveBeenCalledWith("mouseup", up)

    await act(async () => {
      renderer.unmount()
    })

    expect((document as any).removeEventListener).toHaveBeenCalledTimes(4)
  })
})
