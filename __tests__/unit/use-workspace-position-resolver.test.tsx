import React, { forwardRef, useImperativeHandle, useState } from "react"
import TestRenderer, { act } from "react-test-renderer"

import { useWorkspacePositionResolver, type WorkspacePositionEntry } from "@/lib/hooks/annotation/use-workspace-position-resolver"

jest.mock("@/lib/utils/debug-logger", () => ({
  debugLog: jest.fn(() => Promise.resolve()),
}))

const { debugLog } = require("@/lib/utils/debug-logger")

type Handler = ReturnType<typeof useWorkspacePositionResolver<WorkspacePositionEntry>>

type HarnessProps = {
  noteId: string
  entries: WorkspacePositionEntry[]
  pending?: Record<string, { x: number; y: number } | null>
  cached?: Record<string, { x: number; y: number } | null>
  defaultOffscreen?: (position: { x: number; y: number } | null | undefined) => boolean
}

const Harness = forwardRef<{ handler: Handler }, HarnessProps>(
  ({ noteId, entries, pending = {}, cached = {}, defaultOffscreen }, ref) => {
    const [map] = useState(() => {
      const workspaceMap = new Map<string, WorkspacePositionEntry>()
      entries.forEach((entry, index) => {
        workspaceMap.set(`note-${index + 1}`, entry)
      })
      return workspaceMap
    })

    const handler = useWorkspacePositionResolver({
      noteId,
      workspaceNoteMap: map,
      getPendingPosition: jest.fn(note => pending[note] ?? null),
      getCachedPosition: jest.fn(note => cached[note] ?? null),
      isDefaultOffscreenPosition: defaultOffscreen ?? (() => false),
    })

    useImperativeHandle(ref, () => ({ handler }), [handler])

    return null
  },
)
Harness.displayName = "WorkspacePositionResolverHarness"

describe("useWorkspacePositionResolver", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("prefers workspace entry positions when available", async () => {
    const ref = React.createRef<{ handler: Handler }>()

    await act(async () => {
      TestRenderer.create(
        <Harness
          ref={ref}
          noteId="note-1"
          entries={[
            { mainPosition: { x: 100, y: 200 } },
            { mainPosition: { x: 50, y: 60 } },
          ]}
        />,
      )
    })

    const { resolveWorkspacePosition, workspaceMainPosition } = ref.current!.handler
    expect(workspaceMainPosition).toEqual({ x: 100, y: 200 })
    expect(resolveWorkspacePosition("note-2")).toEqual({ x: 50, y: 60 })
    expect(debugLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "resolve_workspace_position_from_entry",
      }),
    )
  })

  it("falls back to pending then cached when entry is missing", async () => {
    const ref = React.createRef<{ handler: Handler }>()

    await act(async () => {
      TestRenderer.create(
        <Harness
          ref={ref}
          noteId="note-1"
          entries={[{ mainPosition: null }]}
          pending={{ "note-1": { x: 10, y: 20 } }}
          cached={{ "note-2": { x: 30, y: 40 } }}
        />,
      )
    })

    const { resolveWorkspacePosition, workspaceMainPosition } = ref.current!.handler
    expect(workspaceMainPosition).toEqual({ x: 10, y: 20 })
    expect(resolveWorkspacePosition("note-2")).toEqual({ x: 30, y: 40 })
    expect(debugLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "resolve_workspace_position_from_pending",
      }),
    )
    expect(debugLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "resolve_workspace_position_from_cache",
      }),
    )
  })

  it("returns null when all sources are default/offscreen", async () => {
    const ref = React.createRef<{ handler: Handler }>()
    const isDefault = jest.fn(() => true)

    await act(async () => {
      TestRenderer.create(
        <Harness
          ref={ref}
          noteId="note-1"
          entries={[{ mainPosition: { x: 0, y: 0 } }]}
          pending={{ "note-1": { x: 5, y: 5 } }}
          cached={{ "note-1": { x: 9, y: 9 } }}
          defaultOffscreen={isDefault}
        />,
      )
    })

    const { workspaceMainPosition, resolveWorkspacePosition } = ref.current!.handler
    expect(workspaceMainPosition).toBeNull()
    expect(resolveWorkspacePosition("note-3")).toBeNull()
    expect(debugLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "resolve_workspace_position_null",
      }),
    )
  })
})
