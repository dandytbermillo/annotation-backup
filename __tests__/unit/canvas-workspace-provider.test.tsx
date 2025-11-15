import React, { forwardRef, useImperativeHandle } from "react"
import TestRenderer, { act } from "react-test-renderer"

import { CanvasWorkspaceProvider, useCanvasWorkspace } from "@/components/canvas/canvas-workspace-context"

const createLocalStorageMock = () => {
  const store = new Map<string, string>()
  return {
    getItem: jest.fn((key: string) => (store.has(key) ? store.get(key)! : null)),
    setItem: jest.fn((key: string, value: string) => {
      store.set(key, String(value))
    }),
    removeItem: jest.fn((key: string) => {
      store.delete(key)
    }),
    clear: jest.fn(() => {
      store.clear()
    }),
  }
}

const originalWindow = (global as any).window
const originalDocument = (global as any).document
const originalNavigator = (global as any).navigator

type ProviderHandle = {
  openNote: (noteId: string, options?: any) => Promise<void>
  closeNote: (noteId: string) => Promise<void>
  updateMainPosition: (noteId: string, position: { x: number; y: number }) => Promise<void>
  getWorkspaceVersion: (noteId: string) => number | null
  updateWorkspaceVersion: (noteId: string, version: number) => void
  getOpenNotes: () => ReturnType<typeof useCanvasWorkspace>["openNotes"]
}

const WorkspaceHarness = forwardRef<ProviderHandle>((_, ref) => {
  const workspace = useCanvasWorkspace()

  useImperativeHandle(ref, () => ({
    openNote: workspace.openNote,
    closeNote: workspace.closeNote,
    updateMainPosition: workspace.updateMainPosition,
    getWorkspaceVersion: workspace.getWorkspaceVersion,
    updateWorkspaceVersion: workspace.updateWorkspaceVersion,
    getOpenNotes: () => workspace.openNotes,
  }))

  return null
})
WorkspaceHarness.displayName = "WorkspaceHarness"

const originalFetch = global.fetch

describe("CanvasWorkspaceProvider", () => {
  beforeEach(() => {
    const localStorageMock = createLocalStorageMock()
    const documentMock = {
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      visibilityState: "visible",
    }
    const windowMock = {
      innerWidth: 1280,
      innerHeight: 720,
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      localStorage: localStorageMock,
      navigator: { sendBeacon: jest.fn() },
      document: documentMock,
    }

    ;(global as any).window = windowMock
    ;(global as any).document = documentMock
    ;(global as any).navigator = windowMock.navigator
  })

  afterEach(() => {
    if (originalFetch) {
      global.fetch = originalFetch
    } else {
      delete (global as any).fetch
    }

    if (originalWindow) {
      ;(global as any).window = originalWindow
    } else {
      delete (global as any).window
    }

    if (originalDocument) {
      ;(global as any).document = originalDocument
    } else {
      delete (global as any).document
    }

    if (originalNavigator) {
      ;(global as any).navigator = originalNavigator
    } else {
      delete (global as any).navigator
    }
  })

  it("exposes version-aware open/close helpers through context", async () => {
    let updateCall = 0
    global.fetch = jest.fn(async (url: RequestInfo, options: RequestInit = {}) => {
      if (typeof url === "string" && url === "/api/canvas/workspace" && options.method === "GET") {
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          json: async () => ({ openNotes: [] }),
          text: async () => JSON.stringify({ openNotes: [] }),
        }
      }

      if (typeof url === "string" && url === "/api/canvas/workspace/update") {
        updateCall++
        const version = updateCall === 1 ? 7 : updateCall === 2 ? 8 : 8
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          text: async () => JSON.stringify({ versions: [{ noteId: "note-123", version }] }),
        }
      }

      if (typeof url === "string" && url.startsWith("/api/canvas/layout/")) {
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          text: async () => "",
        }
      }

      return {
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => ({}),
        text: async () => "{}",
      }
    }) as any

    const ref = React.createRef<ProviderHandle>()
    await act(async () => {
      TestRenderer.create(
        <CanvasWorkspaceProvider>
          <WorkspaceHarness ref={ref} />
        </CanvasWorkspaceProvider>,
      )
    })

    await act(async () => {
      await ref.current!.openNote("note-123", { mainPosition: { x: 5, y: 10 } })
    })

    expect(ref.current!.getOpenNotes()).toHaveLength(1)
    expect(ref.current!.getWorkspaceVersion("note-123")).toBe(7)

    await act(async () => {
      await ref.current!.updateMainPosition("note-123", { x: 50, y: 60 })
    })
    expect(ref.current!.getWorkspaceVersion("note-123")).toBe(8)

    await act(async () => {
      ref.current!.updateWorkspaceVersion("note-123", 9)
    })
    expect(ref.current!.getWorkspaceVersion("note-123")).toBe(9)

    await act(async () => {
      await ref.current!.closeNote("note-123")
    })
    expect(ref.current!.getOpenNotes()).toHaveLength(0)
  })
})
