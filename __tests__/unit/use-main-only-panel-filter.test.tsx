import React, { forwardRef, useImperativeHandle, useState } from "react"
import TestRenderer, { act } from "react-test-renderer"

import { useMainOnlyPanelFilter } from "@/lib/hooks/annotation/use-main-only-panel-filter"
import type { CanvasItem } from "@/types/canvas-items"

type HarnessProps = {
  mainOnlyNoteIds?: string[] | null
  initialItems: CanvasItem[]
}

type Handler = {
  getItems: () => CanvasItem[]
}

const Harness = forwardRef<Handler, HarnessProps>(({ mainOnlyNoteIds, initialItems }, ref) => {
  const [items, setItems] = useState<CanvasItem[]>(initialItems)

  useMainOnlyPanelFilter({
    mainOnlyNoteIds,
    mainOnlyNoteSet: new Set(mainOnlyNoteIds ?? []),
    setCanvasItems: setItems,
    getItemNoteId: (item: CanvasItem) => item.noteId ?? null,
  })

  useImperativeHandle(ref, () => ({ getItems: () => items }), [items])

  return null
})
Harness.displayName = "MainOnlyPanelFilterHarness"

const createPanel = (panelId: string, noteId: string): CanvasItem => ({
  id: `${panelId}-${noteId}`,
  itemType: "panel",
  panelId,
  noteId,
  position: { x: 0, y: 0 },
})

describe("useMainOnlyPanelFilter", () => {
  it("removes non-main panels when their note is main-only", async () => {
    const ref = React.createRef<Handler>()
    const items = [
      createPanel("main", "note-1"),
      createPanel("context", "note-2"),
      createPanel("explore", "note-3"),
    ]

    await act(async () => {
      TestRenderer.create(
        <Harness ref={ref} mainOnlyNoteIds={["note-2"]} initialItems={items} />,
      )
    })

    const filtered = ref.current?.getItems() ?? []
    expect(filtered).toHaveLength(2)
    expect(filtered.map(item => item.panelId)).toEqual(["main", "explore"])
  })

  it("no-ops when mainOnly list is empty or undefined", async () => {
    const ref = React.createRef<Handler>()
    const items = [createPanel("context", "note-2"), createPanel("explore", "note-3")]

    await act(async () => {
      TestRenderer.create(<Harness ref={ref} initialItems={items} />)
    })

    expect(ref.current?.getItems()).toEqual(items)
  })
})
