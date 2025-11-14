import React from "react"
import TestRenderer, { act } from "react-test-renderer"

import { usePanelCreationEvents } from "@/lib/hooks/annotation/use-panel-creation-events"

type HarnessProps = {
  noteId: string
  handleCreatePanel: jest.Mock
  handlePanelClose: jest.Mock
}

const Harness = ({ noteId, handleCreatePanel, handlePanelClose }: HarnessProps) => {
  usePanelCreationEvents({ noteId, handleCreatePanel, handlePanelClose })
  return null
}

describe("usePanelCreationEvents", () => {
  const originalWindow = (global as any).window
  let listeners: Record<string, EventListener> = {}

  beforeEach(() => {
    listeners = {}
    ;(global as any).window = {
      addEventListener: jest.fn((type: string, handler: EventListener) => {
        listeners[type] = handler
      }),
      removeEventListener: jest.fn((type: string, handler: EventListener) => {
        if (listeners[type] === handler) {
          delete listeners[type]
        }
      }),
    }
  })

  afterEach(() => {
    if (originalWindow === undefined) {
      delete (global as any).window
    } else {
      (global as any).window = originalWindow
    }
  })

  it("registers and cleans up window listeners", async () => {
    const handleCreatePanel = jest.fn()
    const handlePanelClose = jest.fn()
    let renderer: TestRenderer.ReactTestRenderer

    await act(async () => {
      renderer = TestRenderer.create(
        <Harness noteId="note-1" handleCreatePanel={handleCreatePanel} handlePanelClose={handlePanelClose} />,
      )
    })

    expect((window as any).addEventListener).toHaveBeenCalledWith("create-panel", expect.any(Function))
    expect((window as any).addEventListener).toHaveBeenCalledWith("preview-panel", expect.any(Function))
    expect((window as any).addEventListener).toHaveBeenCalledWith("remove-preview-panel", expect.any(Function))

    await act(async () => {
      renderer.unmount()
    })

    expect((window as any).removeEventListener).toHaveBeenCalledWith("create-panel", expect.any(Function))
    expect((window as any).removeEventListener).toHaveBeenCalledWith("preview-panel", expect.any(Function))
    expect((window as any).removeEventListener).toHaveBeenCalledWith("remove-preview-panel", expect.any(Function))
  })

  it("dispatches create and preview events to handlers", async () => {
    const handleCreatePanel = jest.fn()
    const handlePanelClose = jest.fn()

    await act(async () => {
      TestRenderer.create(
        <Harness noteId="note-1" handleCreatePanel={handleCreatePanel} handlePanelClose={handlePanelClose} />,
      )
    })

    listeners["create-panel"]?.({
      detail: {
        panelId: "panel-1",
        parentPanelId: "parent",
        parentPosition: { x: 10, y: 20 },
        noteId: "note-2",
        coordinateSpace: "screen",
      },
    } as CustomEvent)

    expect(handleCreatePanel.mock.calls[0]).toEqual([
      "panel-1",
      "parent",
      { x: 10, y: 20 },
      "note-2",
      false,
      "screen",
    ])

    listeners["preview-panel"]?.({
      detail: {
        panelId: "panel-preview",
        parentPanelId: "parent",
        parentPosition: { x: 5, y: 5 },
        previewPosition: { x: 15, y: 25 },
      },
    } as CustomEvent)

    expect(handleCreatePanel.mock.calls[1]).toEqual([
      "panel-preview",
      "parent",
      { x: 15, y: 25 },
      undefined,
      true,
      undefined,
    ])

    listeners["remove-preview-panel"]?.({
      detail: { panelId: "panel-preview" },
    } as CustomEvent)

    expect(handlePanelClose).toHaveBeenCalledWith("panel-preview")
  })
})
