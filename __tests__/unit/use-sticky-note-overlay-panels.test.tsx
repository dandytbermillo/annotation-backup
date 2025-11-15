import React, { forwardRef, useImperativeHandle } from "react"
import TestRenderer, { act } from "react-test-renderer"

import { useStickyNoteOverlayPanels } from "@/lib/hooks/annotation/use-sticky-note-overlay-panels"
import type { CanvasItem } from "@/types/canvas-items"

jest.mock("@/components/canvas/sticky-note-overlay-panel", () => ({
  StickyNoteOverlayPanel: (props: any) => <div data-testid="sticky-panel" {...props} />,
}))

const createPortalMock = jest.fn((node, container) => ({ __portal: true, node, container }))

jest.mock("react-dom", () => {
  const actual = jest.requireActual("react-dom")
  return {
    ...actual,
    createPortal: (node: React.ReactNode, container: Element | DocumentFragment) =>
      createPortalMock(node, container),
  }
})

type Handler = ReturnType<typeof useStickyNoteOverlayPanels>

type HarnessProps = {
  stickyOverlayEl: HTMLElement | null
  stickyNoteItems: CanvasItem[]
  onClose: (id: string) => void
  onPositionChange: (id: string, position: { x: number; y: number }) => void
}

const Harness = forwardRef<{ portal: ReturnType<typeof useStickyNoteOverlayPanels>["stickyNoteOverlayPortal"] }, HarnessProps>(
  ({ stickyOverlayEl, stickyNoteItems, onClose, onPositionChange }, ref) => {
    const { stickyNoteOverlayPortal } = useStickyNoteOverlayPanels({
      stickyOverlayEl,
      stickyNoteItems,
      onClose,
      onPositionChange,
    })

    useImperativeHandle(ref, () => ({ portal: stickyNoteOverlayPortal }), [stickyNoteOverlayPortal])

    return null
  },
)
Harness.displayName = "StickyNoteOverlayHarness"

const createStickyNote = (id: string, position = { x: 10, y: 20 }): CanvasItem => ({
  id,
  itemType: "component",
  componentType: "sticky-note",
  position,
})

describe("useStickyNoteOverlayPanels", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    createPortalMock.mockClear()
  })

  it("returns null when no overlay element is provided", async () => {
    const ref = React.createRef<{ portal: Handler["stickyNoteOverlayPortal"] }>()
    const onClose = jest.fn()
    const onPositionChange = jest.fn()

    await act(async () => {
      TestRenderer.create(
        <Harness
          ref={ref}
          stickyOverlayEl={null}
          stickyNoteItems={[createStickyNote("c-1")]}
          onClose={onClose}
          onPositionChange={onPositionChange}
        />,
      )
    })

    expect(ref.current?.portal).toBeNull()
    expect(createPortalMock).not.toHaveBeenCalled()
  })

  it("renders sticky note overlay panels via portal when overlay element exists", async () => {
    const overlayEl = { id: "overlay-el" } as unknown as HTMLElement
    const ref = React.createRef<{ portal: Handler["stickyNoteOverlayPortal"] }>()
    const onClose = jest.fn()
    const onPositionChange = jest.fn()

    await act(async () => {
      TestRenderer.create(
        <Harness
          ref={ref}
          stickyOverlayEl={overlayEl}
          stickyNoteItems={[createStickyNote("c-1"), createStickyNote("c-2", { x: 5, y: 15 })]}
          onClose={onClose}
          onPositionChange={onPositionChange}
        />,
      )
    })

    expect(ref.current?.portal).toEqual(expect.objectContaining({ __portal: true, container: overlayEl }))
    expect(createPortalMock).toHaveBeenCalledWith(expect.any(Array), overlayEl)
    const children = createPortalMock.mock.calls[0][0] as any[]
    expect(children).toHaveLength(2)
    expect(children[0].props).toEqual(
      expect.objectContaining({
        id: "c-1",
        position: { x: 10, y: 20 },
        onClose,
        onPositionChange,
      }),
    )
    expect(children[1].props).toEqual(
      expect.objectContaining({
        id: "c-2",
        position: { x: 5, y: 15 },
        onClose,
        onPositionChange,
      }),
    )
  })

  it("returns null when sticky note array is empty", async () => {
    const overlayEl = { id: "overlay-el" } as unknown as HTMLElement
    const ref = React.createRef<{ portal: Handler["stickyNoteOverlayPortal"] }>()

    await act(async () => {
      TestRenderer.create(
        <Harness
          ref={ref}
          stickyOverlayEl={overlayEl}
          stickyNoteItems={[]}
          onClose={jest.fn()}
          onPositionChange={jest.fn()}
        />,
      )
    })

    expect(ref.current?.portal).toBeNull()
    expect(createPortalMock).not.toHaveBeenCalled()
  })
})
