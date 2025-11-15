import React from "react"
import TestRenderer, { act } from "react-test-renderer"

import { useWorkspaceUnloadPersistence } from "@/lib/hooks/annotation/use-workspace-unload-persistence"
import type { WorkspacePosition } from "@/lib/workspace/types"

type Options = Parameters<typeof useWorkspaceUnloadPersistence>[0]

const Harness = (props: Options) => {
  useWorkspaceUnloadPersistence(props)
  return null
}

const createRefs = () => ({
  pendingPersistsRef: { current: new Map<string, WorkspacePosition>() },
  pendingBatchRef: { current: null as ReturnType<typeof setTimeout> | null },
  scheduledPersistRef: { current: new Map<string, ReturnType<typeof setTimeout>>() },
})

const originalSendBeacon = window.navigator.sendBeacon
const originalFetch = global.fetch

describe("useWorkspaceUnloadPersistence", () => {
  afterEach(() => {
    jest.restoreAllMocks()
    if (originalSendBeacon) {
      Object.defineProperty(window.navigator, "sendBeacon", {
        value: originalSendBeacon,
        configurable: true,
        writable: true,
      })
    } else {
      delete (window.navigator as any).sendBeacon
    }
    if (originalFetch) {
      ;(global as any).fetch = originalFetch
    } else {
      delete (global as any).fetch
    }
  })

  it("flushes pending persists via sendBeacon when the feature flag is enabled", () => {
    const refs = createRefs()
    refs.pendingPersistsRef.current.set("note-1", { x: 10, y: 20 })

    const sendBeaconMock = jest.fn().mockReturnValue(true)
    Object.defineProperty(window.navigator, "sendBeacon", {
      value: sendBeaconMock,
      configurable: true,
      writable: true,
    })

    let root: TestRenderer.ReactTestRenderer
    await act(async () => {
      root = TestRenderer.create(
        <Harness
          pendingPersistsRef={refs.pendingPersistsRef}
          pendingBatchRef={refs.pendingBatchRef}
          scheduledPersistRef={refs.scheduledPersistRef}
          featureEnabled={true}
          openNotes={[]}
        />,
      )
    })

    window.dispatchEvent(new Event("beforeunload"))
    expect(sendBeaconMock).toHaveBeenCalled()

    root.unmount()
    expect(refs.pendingBatchRef.current).toBeNull()
  })

  it("falls back to keepalive fetch when the feature flag is disabled", () => {
    const refs = createRefs()
    refs.pendingPersistsRef.current.set("note-2", { x: 5, y: 6 })

    const fetchMock = jest.fn().mockResolvedValue({ ok: true })
    ;(global as any).fetch = fetchMock

    let root: TestRenderer.ReactTestRenderer
    await act(async () => {
      root = TestRenderer.create(
        <Harness
          pendingPersistsRef={refs.pendingPersistsRef}
          pendingBatchRef={refs.pendingBatchRef}
          scheduledPersistRef={refs.scheduledPersistRef}
          featureEnabled={false}
          openNotes={[]}
        />,
      )
    })

    window.dispatchEvent(new Event("beforeunload"))
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/canvas/workspace",
      expect.objectContaining({ method: "PATCH", keepalive: true }),
    )

    root.unmount()
  })
})
