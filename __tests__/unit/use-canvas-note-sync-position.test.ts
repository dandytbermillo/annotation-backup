import { getStoredPanelPosition } from "@/lib/hooks/annotation/use-canvas-note-sync"

describe("getStoredPanelPosition", () => {
  it("returns persisted world position from dataStore", () => {
    const dataStore = {
      get: (key: string) =>
        key === "note-1::child-panel"
          ? {
              worldPosition: { x: 320, y: 180 },
            }
          : null,
    }

    const position = getStoredPanelPosition(dataStore as any, null, "note-1", "child-panel")
    expect(position).toEqual({ x: 320, y: 180 })
  })

  it("falls back to null when no stored position exists", () => {
    const dataStore = {
      get: () => null,
    }

    const position = getStoredPanelPosition(dataStore as any, null, "note-1", "child-panel")
    expect(position).toBeNull()
  })
})
