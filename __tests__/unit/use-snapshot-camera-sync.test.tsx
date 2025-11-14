import React, { forwardRef, useImperativeHandle } from "react"
import TestRenderer, { act } from "react-test-renderer"

import { useSnapshotCameraSync } from "@/lib/hooks/annotation/use-snapshot-camera-sync"
import { createDefaultCanvasState } from "@/lib/canvas/canvas-defaults"

jest.mock("@/lib/utils/debug-logger", () => ({
  debugLog: jest.fn(),
}))

type ApplyHandles = ReturnType<typeof useSnapshotCameraSync>

type HarnessProps = {
  noteId: string
  setCanvasState: ReturnType<typeof createSetStateHarness>["setter"]
  persistCameraSnapshot?: jest.Mock
}

const Harness = forwardRef<ApplyHandles, HarnessProps>(({ noteId, setCanvasState, persistCameraSnapshot }, ref) => {
  const applyCamera = useSnapshotCameraSync({ noteId, setCanvasState, persistCameraSnapshot })
  useImperativeHandle(ref, () => applyCamera)
  return null
})
Harness.displayName = "SnapshotCameraSyncHarness"

const createSetStateHarness = () => {
  const prev = createDefaultCanvasState()
  const setter = jest.fn((updater: any) => {
    if (typeof updater === "function") {
      return updater(prev)
    }
    return updater
  })
  return { setter, prev }
}

describe("useSnapshotCameraSync", () => {
  it("skips translation and persistence when the note is newly opened", async () => {
    const { setter, prev } = createSetStateHarness()
    const ref = React.createRef<ApplyHandles>()

    await act(async () => {
      TestRenderer.create(<Harness ref={ref} noteId="note-1" setCanvasState={setter} />)
    })

    await act(async () => {
      await ref.current?.({
        translateX: -50,
        translateY: 25,
        zoom: 1.2,
        showConnections: true,
        isNewlyOpened: true,
      })
    })

    expect(setter).toHaveBeenCalledTimes(1)
    const updater = setter.mock.calls[0][0] as (state: typeof prev) => typeof prev
    const next = updater(prev)
    expect(next).toMatchObject({
      zoom: 1.2,
      showConnections: true,
      translateX: prev.translateX,
      translateY: prev.translateY,
    })
  })

  it("persists and logs when restoring an existing note", async () => {
    const { setter, prev } = createSetStateHarness()
    const persist = jest.fn()
    const ref = React.createRef<ApplyHandles>()

    await act(async () => {
      TestRenderer.create(<Harness ref={ref} noteId="note-1" setCanvasState={setter} persistCameraSnapshot={persist} />)
    })

    await act(async () => {
      await ref.current?.({
        translateX: -120,
        translateY: 80,
        zoom: 0.9,
        isNewlyOpened: false,
      })
    })

    const updater = setter.mock.calls[0][0] as (state: typeof prev) => typeof prev
    const next = updater(prev)
    expect(next.translateX).toBe(-120)
    expect(next.translateY).toBe(80)
    expect(next.zoom).toBe(0.9)
    expect(persist).toHaveBeenCalledWith({ x: -120, y: 80, zoom: 0.9 })
  })
})
