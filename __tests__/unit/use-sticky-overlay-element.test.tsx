import React, { useEffect } from "react"
import TestRenderer, { act } from "react-test-renderer"

import { useStickyOverlayElement } from "@/lib/hooks/annotation/use-sticky-overlay-element"

const mountMock = jest.fn()
const unmountMock = jest.fn()

jest.mock("@/lib/hooks/annotation/use-sticky-overlay", () => {
  const React = require("react")
  return {
    useStickyOverlay: (onMount?: (el: HTMLDivElement) => void, onUnmount?: () => void) => {
      React.useEffect(() => {
        const overlay = { id: "mock-overlay" } as unknown as HTMLDivElement
        mountMock(overlay)
        onMount?.(overlay)
        return () => {
          unmountMock()
          onUnmount?.()
        }
      }, [onMount, onUnmount])
    },
  }
})

type HarnessProps = {
  onOverlayChange: (overlay: HTMLElement | null) => void
}

function Harness({ onOverlayChange }: HarnessProps) {
  const overlay = useStickyOverlayElement()
  useEffect(() => {
    onOverlayChange(overlay)
  }, [overlay, onOverlayChange])
  return null
}

describe("useStickyOverlayElement", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("returns the mounted overlay element and clears on unmount", async () => {
    const changes: Array<HTMLElement | null> = []
    let renderer: TestRenderer.ReactTestRenderer

    await act(async () => {
      renderer = TestRenderer.create(<Harness onOverlayChange={overlay => changes.push(overlay)} />)
    })

    expect(changes[changes.length - 1]).toEqual({ id: "mock-overlay" })
    expect(mountMock).toHaveBeenCalledTimes(1)

    await act(async () => {
      renderer.unmount()
    })

    expect(unmountMock).toHaveBeenCalledTimes(1)
  })
})
