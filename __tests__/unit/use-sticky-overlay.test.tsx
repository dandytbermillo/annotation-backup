import React from "react"
import TestRenderer, { act } from "react-test-renderer"

import { useStickyOverlay } from "@/lib/hooks/annotation/use-sticky-overlay"

type HarnessProps = {
  onMount?: (node: HTMLDivElement) => void
  onUnmount?: () => void
}

function StickyOverlayHarness({ onMount, onUnmount }: HarnessProps) {
  useStickyOverlay(onMount, onUnmount)
  return null
}

const originalDocument = global.document

beforeAll(() => {
  const mockDocument = {
    createElement: jest.fn(() => ({
      style: {},
      id: "",
    })),
    body: {
      appendChild: jest.fn(),
      removeChild: jest.fn(),
    },
  } as unknown as Document
  ;(global as any).document = mockDocument
})

afterAll(() => {
  ;(global as any).document = originalDocument
})

describe("useStickyOverlay", () => {
  it("mounts and unmounts the overlay element", async () => {
    const onMount = jest.fn()
    const onUnmount = jest.fn()
    let renderer: TestRenderer.ReactTestRenderer

    await act(async () => {
      renderer = TestRenderer.create(
        <StickyOverlayHarness onMount={onMount} onUnmount={onUnmount} />,
      )
    })

    expect(document.createElement).toHaveBeenCalledWith("div")
    expect(document.body.appendChild).toHaveBeenCalledTimes(1)
    expect(onMount).toHaveBeenCalledTimes(1)

    await act(async () => {
      renderer.unmount()
    })

    expect(document.body.removeChild).toHaveBeenCalledTimes(1)
    expect(onUnmount).toHaveBeenCalledTimes(1)
  })
})
