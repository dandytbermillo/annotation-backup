import React from "react"
import TestRenderer, { act } from "react-test-renderer"

import { useWorkspaceSeedRegistry } from "@/lib/hooks/annotation/use-workspace-seed-registry"

type HarnessProps = {
  noteId: string
  workspaceSeededNotesRef: React.MutableRefObject<Set<string>>
  mainPanelSeededRef: React.MutableRefObject<boolean>
  debugLog: jest.Mock
}

const Harness = ({ noteId, workspaceSeededNotesRef, mainPanelSeededRef, debugLog }: HarnessProps) => {
  useWorkspaceSeedRegistry({ noteId, workspaceSeededNotesRef, mainPanelSeededRef, debugLog })
  return null
}

describe("useWorkspaceSeedRegistry", () => {
  const createRefs = () => ({
    workspaceSeededNotesRef: { current: new Set<string>(["seed-1"]) },
    mainPanelSeededRef: { current: true },
  })

  it("clears workspace seeds on the first note and logs reset actions", async () => {
    const { workspaceSeededNotesRef, mainPanelSeededRef } = createRefs()
    const debugLog = jest.fn()

    await act(async () => {
      TestRenderer.create(
        <Harness
          noteId="note-1"
          workspaceSeededNotesRef={workspaceSeededNotesRef}
          mainPanelSeededRef={mainPanelSeededRef}
          debugLog={debugLog}
        />,
      )
    })

    expect(workspaceSeededNotesRef.current.size).toBe(0)
    expect(mainPanelSeededRef.current).toBe(false)
    expect(debugLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: "workspace_seed_reset_all" }),
    )
  })

  it("resets only the per-note references on subsequent note IDs", async () => {
    const { workspaceSeededNotesRef, mainPanelSeededRef } = createRefs()
    const debugLog = jest.fn()

    let renderer: TestRenderer.ReactTestRenderer
    await act(async () => {
      renderer = TestRenderer.create(
        <Harness
          noteId="note-initial"
          workspaceSeededNotesRef={workspaceSeededNotesRef}
          mainPanelSeededRef={mainPanelSeededRef}
          debugLog={debugLog}
        />,
      )
    })

    workspaceSeededNotesRef.current.add("retained-seed")
    mainPanelSeededRef.current = true
    debugLog.mockClear()

    await act(async () => {
      renderer.update(
        <Harness
          noteId="note-next"
          workspaceSeededNotesRef={workspaceSeededNotesRef}
          mainPanelSeededRef={mainPanelSeededRef}
          debugLog={debugLog}
        />,
      )
    })

    expect(workspaceSeededNotesRef.current.has("retained-seed")).toBe(true)
    expect(mainPanelSeededRef.current).toBe(false)

    const actions = debugLog.mock.calls.map(call => call[0].action)
    expect(actions).not.toContain("workspace_seed_reset_all")
    expect(actions.filter(action => action === "workspace_seed_note_cleared").length).toBeGreaterThan(0)
  })
})
