import { resolvePanelDimensions, DEFAULT_PANEL_DIMENSIONS } from "@/lib/canvas/panel-metrics"
import { DataStore } from "@/lib/data-store"
import type { CanvasItem } from "@/types/canvas-items"

describe("resolvePanelDimensions", () => {
  const noteId = "test-note"
  const panelId = "main"
  let dataStore: DataStore

  beforeEach(() => {
    dataStore = new DataStore()
  })

  it("prefers live DOM measurement when available", () => {
    const fakeDoc = {
      querySelector: (selector: string) => {
        if (selector === `[data-panel-id="${panelId}"]`) {
          return {
            offsetWidth: 640,
            offsetHeight: 480,
          }
        }
        return null
      }
    } as unknown as Document

    const result = resolvePanelDimensions({
      noteId,
      panelId,
      dataStore,
      doc: fakeDoc
    })

    expect(result).toEqual({ width: 640, height: 480 })
  })

  it("falls back to dataStore dimensions when DOM measurement is unavailable", () => {
    dataStore.set(`${noteId}::${panelId}`, {
      dimensions: { width: 420, height: 360 }
    })

    const result = resolvePanelDimensions({ noteId, panelId, dataStore })

    expect(result).toEqual({ width: 420, height: 360 })
  })

  it("uses canvasItems dimensions when dataStore is missing values", () => {
    const canvasItems: CanvasItem[] = [
      {
        id: "panel-main",
        itemType: "panel",
        panelId,
        position: { x: 0, y: 0 },
        dimensions: { width: 512, height: 384 }
      }
    ]

    const result = resolvePanelDimensions({ noteId, panelId, dataStore, canvasItems })

    expect(result).toEqual({ width: 512, height: 384 })
  })

  it("returns default dimensions when no sources are available", () => {
    const result = resolvePanelDimensions({ noteId, panelId, dataStore })

    expect(result).toEqual(DEFAULT_PANEL_DIMENSIONS)
  })
})
