import React from "react"
import TestRenderer, { act } from "react-test-renderer"

import { useCanvasContextSync, type UseCanvasContextSyncOptions } from "@/lib/hooks/annotation/use-canvas-context-sync"
import { createDefaultCanvasState } from "@/lib/canvas/canvas-defaults"

const Harness = ({ options }: { options: UseCanvasContextSyncOptions }) => {
  useCanvasContextSync(options)
  return null
}

const createCanvasContextState = (overrides: Partial<UseCanvasContextSyncOptions["canvasContextState"]["canvasState"]> = {}) => ({
  canvasState: {
    translateX: 0,
    translateY: 0,
    zoom: 1,
    ...overrides,
  },
})

const createSetStateHarness = () => {
  const prevState = { ...createDefaultCanvasState() }
  const setter = jest.fn((updater: any) => {
    if (typeof updater === "function") {
      return updater(prevState)
    }
    return updater
  })
  return { setter, prevState }
}

const renderContextSyncHook = async (
  overrides: Partial<UseCanvasContextSyncOptions> = {},
) => {
  const { setter, prevState } = createSetStateHarness()
  const options: UseCanvasContextSyncOptions = {
    canvasContextState: createCanvasContextState(),
    setCanvasState: setter,
    isRestoringSnapshotRef: { current: false },
    skipNextContextSyncRef: { current: false },
    noteId: "note-1",
    debugLog: jest.fn(),
    ...overrides,
    setCanvasState: overrides.setCanvasState ?? setter,
  }

  await act(async () => {
    TestRenderer.create(<Harness options={options} />)
  })

  return { options, prevState, setCanvasStateMock: setter }
}

describe("useCanvasContextSync", () => {
  it("logs and skips syncing while restoring a snapshot", async () => {
    const { options, setCanvasStateMock } = await renderContextSyncHook({
      isRestoringSnapshotRef: { current: true },
    })

    expect(setCanvasStateMock).not.toHaveBeenCalled()
    expect(options.debugLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "skip_context_sync_during_snapshot_restore",
      }),
    )
  })

  it("consumes skipNextContextSyncRef exactly once", async () => {
    const skipRef = { current: true }
    const { options, setCanvasStateMock } = await renderContextSyncHook({
      skipNextContextSyncRef: skipRef,
    })

    expect(setCanvasStateMock).not.toHaveBeenCalled()
    expect(skipRef.current).toBe(false)
    expect(options.debugLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "skip_context_sync_after_snapshot_skip",
      }),
    )
  })

  it("applies canvas transform updates when the context changes", async () => {
    const contextState = createCanvasContextState({
      translateX: 25,
      translateY: -10,
      zoom: 1.2,
    })
    const { prevState, setCanvasStateMock } = await renderContextSyncHook({
      canvasContextState: contextState,
    })

    expect(setCanvasStateMock).toHaveBeenCalledTimes(1)
    const updater = setCanvasStateMock.mock.calls[0][0] as (state: typeof prevState) => typeof prevState
    const result = updater(prevState)

    expect(result).toMatchObject({
      translateX: 25,
      translateY: -10,
      zoom: 1.2,
    })
    expect(result).not.toBe(prevState)
  })

  it("returns the previous state when there is no transform delta", async () => {
    const { prevState, setCanvasStateMock } = await renderContextSyncHook()

    expect(setCanvasStateMock).toHaveBeenCalledTimes(1)
    const updater = setCanvasStateMock.mock.calls[0][0] as (state: typeof prevState) => typeof prevState
    const result = updater(prevState)

    expect(result).toBe(prevState)
  })
})
