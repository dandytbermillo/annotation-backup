import React, { useRef } from "react"
import TestRenderer, { act } from "react-test-renderer"

import { usePanelCloseHandler } from "@/lib/hooks/annotation/use-panel-close-handler"

const mockSetCanvasItems = jest.fn()
const mockGetItemNoteId = jest.fn()
const mockDataStore = {
  get: jest.fn(),
  update: jest.fn(),
}
const mockBranchesMap = new Map<string, any>()
const mockLayerManager = {
  getNode: jest.fn(),
  removeNode: jest.fn(),
}
const mockDispatch = jest.fn()
const mockPersistPanelUpdate = jest.fn(() => Promise.resolve())
const mockCloseNote = jest.fn(() => Promise.resolve())

function HookHarness() {
  const handler = usePanelCloseHandler({
    noteId: "note-1",
    setCanvasItems: mockSetCanvasItems,
    getItemNoteId: mockGetItemNoteId,
    dataStore: mockDataStore,
    branchesMap: mockBranchesMap,
    layerManager: mockLayerManager,
    dispatch: mockDispatch,
    persistPanelUpdate: mockPersistPanelUpdate,
    closeNote: mockCloseNote,
  })

  const handlerRef = useRef(handler)
  handlerRef.current = handler

  return null
}

describe("usePanelCloseHandler", () => {
  beforeEach(() => {
    mockSetCanvasItems.mockClear()
    mockGetItemNoteId.mockClear()
    mockDataStore.get.mockReset()
    mockDataStore.update.mockReset()
    mockBranchesMap.clear()
    mockLayerManager.getNode.mockReset()
    mockLayerManager.removeNode.mockReset()
    mockDispatch.mockClear()
    mockPersistPanelUpdate.mockClear()
    mockCloseNote.mockClear()
  })

  it("closes a panel and updates state", async () => {
    mockSetCanvasItems.mockImplementation(cb => cb([]))
    mockGetItemNoteId.mockReturnValue("note-1")
    mockDataStore.get.mockReturnValue({ revisionToken: "rev-1", parentId: "parent" })
    mockLayerManager.getNode.mockReturnValue(true)

    let renderer: TestRenderer.ReactTestRenderer
    await act(async () => {
      renderer = TestRenderer.create(<HookHarness />)
    })

    const hookInstance = renderer.root.findByType(HookHarness)
    const handler = usePanelCloseHandler({
      noteId: "note-1",
      setCanvasItems: mockSetCanvasItems,
      getItemNoteId: mockGetItemNoteId,
      dataStore: mockDataStore,
      branchesMap: mockBranchesMap,
      layerManager: mockLayerManager,
      dispatch: mockDispatch,
      persistPanelUpdate: mockPersistPanelUpdate,
      closeNote: mockCloseNote,
    })

    handler("panel-1", "note-1")

    expect(mockSetCanvasItems).toHaveBeenCalled()
    expect(mockDataStore.update).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ state: "closed" }))
    expect(mockDispatch).toHaveBeenCalledWith(expect.objectContaining({ type: "REMOVE_PANEL" }))
    expect(mockLayerManager.removeNode).toHaveBeenCalled()
    expect(mockPersistPanelUpdate).toHaveBeenCalled()
  })
}
