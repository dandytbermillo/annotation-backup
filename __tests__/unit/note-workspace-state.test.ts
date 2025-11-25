import type * as WorkspaceStateModule from "@/lib/note-workspaces/state"

describe("note workspace snapshot state", () => {
  let state: typeof WorkspaceStateModule

  beforeEach(() => {
    jest.resetModules()
    state = require("@/lib/note-workspaces/state") as typeof WorkspaceStateModule
  })

  it("emits workspace_ready only after all pending panels and components settle", async () => {
    const events: WorkspaceStateModule.WorkspaceSnapshotEvent[] = []
    const unsubscribe = state.subscribeToWorkspaceSnapshotState((event) => {
      events.push(event)
    })

    state.setActiveWorkspaceContext("ws-ready-test")
    state.setNoteWorkspaceOwner("note-alpha", "ws-ready-test")

    state.markPanelPersistencePending("note-alpha", "panel-x")
    state.markComponentPersistencePending("ws-ready-test", "component-calc")

    const waitPromise = state.waitForWorkspaceSnapshotReady("ws-ready-test", 250)

    expect(events.filter((event) => event.type === "workspace_ready")).toHaveLength(0)

    state.markPanelPersistenceReady("note-alpha", "panel-x")
    state.markComponentPersistenceReady("ws-ready-test", "component-calc")

    await expect(waitPromise).resolves.toBe(true)

    const readyEvents = events.filter((event) => event.type === "workspace_ready")
    expect(readyEvents).toHaveLength(1)
    expect(readyEvents[0]).toEqual(
      expect.objectContaining({
        workspaceId: "ws-ready-test",
        pendingCount: 0,
      }),
    )

    unsubscribe()
  })

  it("keeps cached snapshots isolated per workspace with panels and components", () => {
    const workspaceA: WorkspaceStateModule.NoteWorkspaceSnapshot = {
      workspaceId: "browser-tab-A",
      openNotes: [{ noteId: "note-default", mainPosition: { x: 10, y: 10 } }],
      panels: [
        {
          noteId: "note-default",
          panelId: "panel-main",
          type: "note",
          position: { x: 10, y: 10 },
          size: { width: 200, height: 160 },
          zIndex: 1,
        },
        {
          noteId: "note-default",
          panelId: "panel-non-main",
          type: "branch",
          position: { x: 420, y: 120 },
          size: { width: 240, height: 180 },
          zIndex: 2,
        },
      ],
      components: [
        {
          id: "component-calculator",
          type: "calculator",
          position: { x: 600, y: 150 },
          size: { width: 300, height: 320 },
          zIndex: 3,
          metadata: { componentType: "calculator" },
        },
      ],
      camera: { x: 0, y: 0, scale: 1 },
      activeNoteId: "note-default",
      revision: "1",
    }

    const workspaceB: WorkspaceStateModule.NoteWorkspaceSnapshot = {
      workspaceId: "browser-tab-B",
      openNotes: [{ noteId: "note-secondary", mainPosition: { x: -50, y: 90 } }],
      panels: [
        {
          noteId: "note-secondary",
          panelId: "panel-b-primary",
          type: "note",
          position: { x: -50, y: 90 },
          size: { width: 220, height: 180 },
          zIndex: 1,
        },
      ],
      components: [
        {
          id: "component-alarm",
          type: "alarm",
          position: { x: 100, y: 400 },
          size: { width: 320, height: 240 },
          zIndex: 4,
          metadata: { componentType: "alarm" },
        },
      ],
      camera: { x: 10, y: 20, scale: 0.95 },
      activeNoteId: "note-secondary",
      revision: "2",
    }

    state.cacheWorkspaceSnapshot(workspaceA)
    state.cacheWorkspaceSnapshot(workspaceB)

    const cachedA = state.getWorkspaceSnapshot("browser-tab-A")
    const cachedB = state.getWorkspaceSnapshot("browser-tab-B")

    expect(cachedA).toBeDefined()
    expect(cachedB).toBeDefined()
    expect(cachedA?.panels.map((panel) => panel.noteId)).toEqual(["note-default", "note-default"])
    expect(cachedB?.panels.map((panel) => panel.noteId)).toEqual(["note-secondary"])
    expect(cachedA?.components?.map((component) => component.type)).toEqual(["calculator"])
    expect(cachedB?.components?.map((component) => component.type)).toEqual(["alarm"])
    expect(cachedA?.openNotes.map((note) => note.noteId)).toEqual(["note-default"])
    expect(cachedB?.openNotes.map((note) => note.noteId)).toEqual(["note-secondary"])
  })
})
