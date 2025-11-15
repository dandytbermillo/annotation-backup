import React, { useEffect, useState } from "react"
import TestRenderer, { act } from "react-test-renderer"

import { useCanvasNoteSync } from "@/lib/hooks/annotation/use-canvas-note-sync"
import type { CanvasItem } from "@/types/canvas-items"
import type { DataStore } from "@/lib/data-store"

const storedPosition = { x: 420, y: 260 }

const createCanvasItem = (): CanvasItem => ({
  id: "panel-child",
  itemType: "panel",
  panelId: "child-panel",
  noteId: "note-1",
  position: { x: 0, y: 0 },
})

function UseCanvasNoteSyncHarness({
  onItems,
  dataStore,
  branchesMap,
}: {
  onItems: (items: CanvasItem[]) => void
  dataStore: DataStore
  branchesMap: Map<string, any>
}) {
  const [items, setItems] = useState<CanvasItem[]>([createCanvasItem()])

  useCanvasNoteSync({
    hasNotes: true,
    noteIds: ["note-1"],
    noteId: "note-1",
    canvasItemsLength: items.length,
    mainOnlyNoteSet: new Set(),
    freshNoteSeeds: {},
    onConsumeFreshNoteSeed: undefined,
    setCanvasItems: setItems,
    getItemNoteId: item => item.noteId ?? null,
    resolveWorkspacePosition: () => null,
    dataStore,
    branchesMap,
    hydrationStateKey: "hydrated",
  })

  useEffect(() => {
    onItems(items)
  }, [items, onItems])

  return null
}

describe("useCanvasNoteSync", () => {
  it("hydrates non-main panels from persisted world positions", async () => {
    const backingStore: Record<string, any> = {
      "note-1::child-panel": {
        position: storedPosition,
      },
    }

    const dataStore = {
      get: jest.fn((key: string) => backingStore[key]),
    } as unknown as DataStore

    const branchesMap = new Map<string, any>()

    const observations: CanvasItem[][] = []

    await act(async () => {
      TestRenderer.create(
        <UseCanvasNoteSyncHarness
          onItems={items => observations.push(items)}
          dataStore={dataStore}
          branchesMap={branchesMap}
        />,
      )
    })

    expect(observations[observations.length - 1][0].position).toEqual(storedPosition)
    expect(dataStore.get).toHaveBeenCalledWith("note-1::child-panel")
  })
})
