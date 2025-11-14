import React, { forwardRef, useImperativeHandle } from "react"
import TestRenderer, { act } from "react-test-renderer"

import { useSelectionGuards } from "@/lib/hooks/annotation/use-selection-guards"

type SelectionGuardsHandle = {
  enable: () => void
  disable: () => void
}

const SelectionGuardsHarness = forwardRef<SelectionGuardsHandle>((_, ref) => {
  const { enableSelectionGuards, disableSelectionGuards } = useSelectionGuards()

  useImperativeHandle(ref, () => ({
    enable: enableSelectionGuards,
    disable: disableSelectionGuards,
  }))

  return null
})
SelectionGuardsHarness.displayName = "SelectionGuardsHarness"

type ClassListMock = {
  add: (token: string) => void
  remove: (token: string) => void
  contains: (token: string) => boolean
}

function createClassList(store: Set<string>): ClassListMock {
  return {
    add: (token: string) => {
      store.add(token)
    },
    remove: (token: string) => {
      store.delete(token)
    },
    contains: (token: string) => store.has(token),
  }
}

const originalDocument = global.document

beforeAll(() => {
  const rootClasses = new Set<string>()
  const docMock = {
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    body: {
      style: { userSelect: "" },
    },
    documentElement: {
      classList: createClassList(rootClasses),
    },
  } as unknown as Document

  ;(global as any).document = docMock

  if (typeof window === "undefined") {
    ;(global as any).window = {} as any
  }

  if (typeof window.getSelection !== "function") {
    window.getSelection = () =>
      ({
        removeAllRanges: () => {},
      } as Selection)
  }
})

afterAll(() => {
  ;(global as any).document = originalDocument
})

describe("useSelectionGuards", () => {
  beforeEach(() => {
    document.body.style.userSelect = ""
    document.documentElement.classList.remove("dragging-no-select")
    ;(document as any).addEventListener.mockClear()
    ;(document as any).removeEventListener.mockClear()
  })

  it("enables and disables document-level selection guards", async () => {
    const ref = React.createRef<SelectionGuardsHandle>()
    await act(async () => {
      TestRenderer.create(<SelectionGuardsHarness ref={ref} />)
    })

    expect(ref.current).toBeTruthy()

    act(() => {
      ref.current!.enable()
    })
    expect(document.documentElement.classList.contains("dragging-no-select")).toBe(true)
    expect(document.body.style.userSelect).toBe("none")
    expect((document as any).addEventListener).toHaveBeenCalledWith(
      "selectstart",
      expect.any(Function),
      true,
    )
    expect((document as any).addEventListener).toHaveBeenCalledWith(
      "dragstart",
      expect.any(Function),
      true,
    )

    act(() => {
      ref.current!.disable()
    })
    expect(document.documentElement.classList.contains("dragging-no-select")).toBe(false)
    expect(document.body.style.userSelect).toBe("")
    expect((document as any).removeEventListener).toHaveBeenCalledWith(
      "selectstart",
      expect.any(Function),
      true,
    )
    expect((document as any).removeEventListener).toHaveBeenCalledWith(
      "dragstart",
      expect.any(Function),
      true,
    )
  })
})
