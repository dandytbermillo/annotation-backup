import React from "react"
import TestRenderer, { act } from "react-test-renderer"

import { useCanvasSnapshotLifecycle } from "@/lib/hooks/annotation/use-canvas-snapshot-lifecycle"
import { DataStore } from "@/lib/data-store"
import { createDefaultCanvasState } from "@/lib/canvas/canvas-defaults"
import type { UseCanvasSnapshotOptions } from "@/lib/hooks/annotation/use-canvas-snapshot"

jest.mock("@/lib/hooks/annotation/use-canvas-snapshot", () => {
  const actual = jest.requireActual("@/lib/hooks/annotation/use-canvas-snapshot")
  return {
    ...actual,
    useCanvasSnapshot: jest.fn(),
  }
})

const { useCanvasSnapshot } = jest.requireMock("@/lib/hooks/annotation/use-canvas-snapshot") as {
  useCanvasSnapshot: jest.Mock
}

const createBaseOptions = (): Omit<UseCanvasSnapshotOptions, "skipSnapshotForNote"> => ({
  noteId: "note-1",
  activeWorkspaceVersion: 2,
  workspaceMainPosition: { x: 0, y: 0 },
  workspaceSnapshotRevision: 0,
  canvasState: createDefaultCanvasState(),
  canvasStateRef: { current: createDefaultCanvasState() },
  canvasItems: [],
  getItemNoteId: () => null,
  isDefaultOffscreenPosition: () => false,
  setCanvasState: jest.fn(),
  setCanvasItems: jest.fn(),
  setIsStateLoaded: jest.fn(),
  autoSaveTimerRef: { current: null },
  initialCanvasSetupRef: { current: false },
  skipNextContextSyncRef: { current: false },
  isRestoringSnapshotRef: { current: false },
  getPendingPosition: () => null,
  getCachedPosition: () => null,
  freshNoteSet: new Set(),
  freshNoteSeeds: {},
  onSnapshotLoadComplete: jest.fn(),
  onSnapshotSettled: jest.fn(),
  pendingSaveMaxAgeMs: 1000,
  dispatch: jest.fn(),
  updateDedupeWarnings: jest.fn(),
  primaryHydrationStatus: { success: true, panels: [] },
  dataStore: new DataStore(),
})

const Harness = ({ options }: { options: Parameters<typeof useCanvasSnapshotLifecycle>[0] }) => {
  useCanvasSnapshotLifecycle(options)
  return null
}

async function render(options: Parameters<typeof useCanvasSnapshotLifecycle>[0]) {
  await act(async () => {
    TestRenderer.create(<Harness options={options} />)
  })
}

describe("useCanvasSnapshotLifecycle", () => {
  beforeEach(() => {
    useCanvasSnapshot.mockClear()
  })

  it("normalizes undefined skipSnapshotForNote to null", async () => {
    const baseOptions = createBaseOptions()
    await render({ ...baseOptions })

    expect(useCanvasSnapshot).toHaveBeenCalledTimes(1)
    expect(useCanvasSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        skipSnapshotForNote: null,
      }),
    )
  })

  it("passes through provided skipSnapshotForNote values", async () => {
    const baseOptions = createBaseOptions()
    await render({ ...baseOptions, skipSnapshotForNote: "note-2" })

    expect(useCanvasSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        skipSnapshotForNote: "note-2",
      }),
    )
  })
})
