import React, { forwardRef, useImperativeHandle, useMemo, useRef, useState } from "react"
import TestRenderer, { act } from "react-test-renderer"

import type { CanvasItem } from "@/types/canvas-items"
import type { HydrationStatus } from "@/lib/hooks/use-canvas-hydration"
import type { DataStore } from "@/lib/data-store"
import { useDefaultMainPanelPersistence } from "@/lib/hooks/annotation/use-default-main-panel-persistence"

jest.mock("@/lib/utils/debug-logger", () => ({
  debugLog: jest.fn(),
}))

type HarnessHandles = {
  getItems: () => CanvasItem[]
  isSeeded: () => boolean
}

type HarnessProps = {
  noteId: string
  hydrationStatus: HydrationStatus
  initialItems: CanvasItem[]
  workspaceMainPosition?: { x: number; y: number } | null
  persistPanelCreate: jest.Mock
  updateMainPosition: jest.Mock
  dataStore: DataStore
  mainPanelSeededRef: React.MutableRefObject<boolean>
}

const DefaultMainPanelHarness = forwardRef<HarnessHandles, HarnessProps>(
  (
    {
      noteId,
      hydrationStatus,
      initialItems,
      workspaceMainPosition = null,
      persistPanelCreate,
      updateMainPosition,
      dataStore,
      mainPanelSeededRef,
    },
    ref,
  ) => {
    const [items, setItems] = useState<CanvasItem[]>(initialItems)
    const canvasStateRef = useRef({ translateX: 0, translateY: 0, zoom: 1 })

    const getPanelDimensions = useMemo(() => {
      return () => ({ width: 400, height: 260 })
    }, [])

    useDefaultMainPanelPersistence({
      noteId,
      hydrationStatus,
      canvasItems: items,
      setCanvasItems: setItems,
      getItemNoteId: item => item.noteId ?? null,
      workspaceMainPosition,
      canvasStateRef,
      getPanelDimensions,
      persistPanelCreate,
      dataStore,
      updateMainPosition,
      mainPanelSeededRef,
    })

    useImperativeHandle(ref, () => ({
      getItems: () => items,
      isSeeded: () => mainPanelSeededRef.current,
    }))

    return null
  },
)
DefaultMainPanelHarness.displayName = "DefaultMainPanelHarness"

describe("useDefaultMainPanelPersistence", () => {
  const consoleLogSpy = jest.spyOn(console, "log").mockImplementation(() => {})
  afterAll(() => {
    consoleLogSpy.mockRestore()
  })

  const baseHydrationStatus: HydrationStatus = {
    loading: false,
    error: null,
    success: true,
    panelsLoaded: 0,
    cameraLoaded: true,
    panels: [],
  }

  const createCanvasItem = (overrides?: Partial<CanvasItem>): CanvasItem => ({
    id: "panel-1",
    itemType: "panel",
    panelId: "main",
    noteId: "note-1",
    position: { x: 2000, y: 1500 },
    ...overrides,
  })

  const createDataStore = () =>
    ({
      get: jest.fn(() => ({ title: "Server Main" })),
    }) as unknown as DataStore

  it("persists the default main panel when hydration succeeds without a stored main panel", async () => {
    const persistPanelCreate = jest.fn(() => Promise.resolve())
    const updateMainPosition = jest.fn(() => Promise.resolve())
    const dataStore = createDataStore()
    const mainPanelSeededRef = { current: false }
    const ref = React.createRef<HarnessHandles>()

    await act(async () => {
      TestRenderer.create(
        <DefaultMainPanelHarness
          ref={ref}
          noteId="note-1"
          hydrationStatus={baseHydrationStatus}
          initialItems={[createCanvasItem()]}
          persistPanelCreate={persistPanelCreate}
          updateMainPosition={updateMainPosition}
          dataStore={dataStore}
          mainPanelSeededRef={mainPanelSeededRef}
        />,
      )
    })

    expect(persistPanelCreate).toHaveBeenCalledTimes(1)
    expect(updateMainPosition).toHaveBeenCalledWith("note-1", expect.objectContaining({ x: 760, y: 410 }))
    expect(ref.current?.getItems()[0].position).toEqual({ x: 760, y: 410 })
    expect(ref.current?.isSeeded()).toBe(true)
  })

  it("skips persistence when hydration already reports a main panel or note was seeded", async () => {
    const persistPanelCreate = jest.fn(() => Promise.resolve())
    const updateMainPosition = jest.fn(() => Promise.resolve())
    const dataStore = createDataStore()
    const mainPanelSeededRef = { current: true }
    const ref = React.createRef<HarnessHandles>()

    const hydratedStatus: HydrationStatus = {
      ...baseHydrationStatus,
      panels: [{ id: "main", noteId: "note-1", position: { x: 10, y: 20 }, size: { width: 100, height: 100 }, zIndex: 0, type: "editor" }],
    }

    await act(async () => {
      TestRenderer.create(
        <DefaultMainPanelHarness
          ref={ref}
          noteId="note-1"
          hydrationStatus={hydratedStatus}
          initialItems={[createCanvasItem({ position: { x: 10, y: 20 } })]}
          persistPanelCreate={persistPanelCreate}
          updateMainPosition={updateMainPosition}
          dataStore={dataStore}
          mainPanelSeededRef={mainPanelSeededRef}
        />,
      )
    })

    expect(persistPanelCreate).not.toHaveBeenCalled()
    expect(updateMainPosition).not.toHaveBeenCalled()
    expect(ref.current?.getItems()[0].position).toEqual({ x: 10, y: 20 })
  })
})
