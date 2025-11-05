import type { Dispatch, MouseEvent, MutableRefObject, RefObject, SetStateAction } from 'react'

import { FOLDER_COLORS } from '@/components/canvas/popupOverlay/constants'
import {
  clamp,
  getFolderColorTheme,
  parseBreadcrumb,
  formatRelativeTime,
  isFolderNode,
  isNoteLikeNode
} from '@/components/canvas/popupOverlay/helpers'
import {
  createPopupChildRowRenderer,
  type PopupChildRowDeps,
  type PopupChildRowOptions
} from '@/components/canvas/popupOverlay/renderPopupChildRow'
import type { PopupChildNode, PopupData, PreviewEntry } from '@/components/canvas/popupOverlay/types'

const createBaseDeps = (): PopupChildRowDeps => {
  const setNameMock = jest.fn()

  return {
    popupSelections: new Map(),
    draggedItems: new Set(),
    dropTargetId: null,
    invalidDropTargetId: null,
    requestPreview: jest.fn(),
    popups: new Map(),
    hoverHighlightTimeoutRef: { current: null } as MutableRefObject<NodeJS.Timeout | null>,
    setHoverHighlightedPopup: jest.fn(),
    handleDragStart: jest.fn(),
    handleDragEnd: jest.fn(),
    handleDragOver: jest.fn(),
    handleDragLeave: jest.fn(),
    handleDrop: jest.fn().mockResolvedValue(undefined),
    handlePreviewTooltipHover: jest.fn(),
    handlePreviewTooltipLeave: jest.fn(),
    handleItemSelect: jest.fn(),
    popupEditMode: new Map(),
    handleStartRenameListFolder: jest.fn(),
    handleSaveRenameListFolder: jest.fn(),
    handleCancelRenameListFolder: jest.fn(),
    renamingListFolder: null,
    renamingListFolderName: '',
    setRenamingListFolderName: setNameMock as unknown as Dispatch<SetStateAction<string>>,
    renameLoading: false,
    renameError: null,
    renameListInputRef: { current: null } as RefObject<HTMLInputElement>,
    onSelectNote: jest.fn(),
    layerCtx: null
  }
}

const createRenderer = (
  overrides: Partial<PopupChildRowDeps> = {}
) => {
  const baseDeps = createBaseDeps()
  const mergedDeps = { ...baseDeps, ...overrides } as PopupChildRowDeps
  const renderer = createPopupChildRowRenderer(mergedDeps)
  return { renderer, deps: mergedDeps }
}

const baseOptions: PopupChildRowOptions = {
  previewEntry: { activeChildId: null, entries: {} } as PreviewEntry,
  isPanning: false
}

const noteChild: PopupChildNode = {
  id: 'note-1',
  type: 'note',
  name: 'Note'
}

const folderChild: PopupChildNode = {
  id: 'folder-1',
  type: 'folder',
  name: 'Folder'
}

const createMouseEvent = (overrides: Partial<MouseEvent> = {}) =>
  ({
    stopPropagation: jest.fn(),
    preventDefault: jest.fn(),
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    ...overrides
  }) as MouseEvent

describe('popup overlay helpers', () => {
  afterEach(() => {
    jest.useRealTimers()
  })

  it('clamps values within bounds', () => {
    expect(clamp(5, 0, 10)).toBe(5)
    expect(clamp(-5, 0, 10)).toBe(0)
    expect(clamp(15, 0, 10)).toBe(10)
  })

  it('resolves folder color themes by name', () => {
    const blueColor = getFolderColorTheme('blue')
    expect(blueColor).toEqual(FOLDER_COLORS.find((color) => color.name === 'blue'))

    expect(getFolderColorTheme(undefined)).toBeNull()
    expect(getFolderColorTheme('missing')).toBeNull()
  })

  it('parses breadcrumbs and replaces terminal segment with current name', () => {
    expect(parseBreadcrumb(null, 'Root')).toEqual(['Root'])
    expect(parseBreadcrumb('knowledge-base/workspaces/folder', 'Final')).toEqual(['Workspaces', 'Final'])
    expect(parseBreadcrumb('workspace', 'Workspace')).toEqual(['Workspace'])
  })

  describe('formatRelativeTime', () => {
    beforeEach(() => {
      jest.useFakeTimers()
      jest.setSystemTime(new Date('2025-01-01T00:00:00Z'))
    })

    it('returns "now" for timestamps less than a minute old', () => {
      expect(formatRelativeTime('2024-12-31T23:59:30Z')).toBe('now')
    })

    it('returns minutes, hours, days, months, and years as expected', () => {
      expect(formatRelativeTime('2024-12-31T23:55:00Z')).toBe('5m ago')
      expect(formatRelativeTime('2024-12-31T20:00:00Z')).toBe('4h ago')
      expect(formatRelativeTime('2024-12-20T00:00:00Z')).toBe('12d ago')
      expect(formatRelativeTime('2024-11-15T00:00:00Z')).toBe('1mo ago')
      expect(formatRelativeTime('2023-01-01T00:00:00Z')).toBe('2y ago')
    })
  })

  it('detects folder and note-like nodes', () => {
    expect(isFolderNode(folderChild)).toBe(true)
    expect(isFolderNode(noteChild)).toBe(false)
    expect(isFolderNode(null)).toBe(false)

    expect(isNoteLikeNode(noteChild)).toBe(true)
    expect(isNoteLikeNode(folderChild)).toBe(false)
    expect(isNoteLikeNode(undefined)).toBe(false)
  })
})

describe('createPopupChildRowRenderer', () => {
  it('requests a preview for note nodes when hovered while not panning', () => {
    const requestPreview = jest.fn()
    const { renderer } = createRenderer({ requestPreview })

    const element = renderer('popup-1', baseOptions)(noteChild, [])
    element.props.onMouseEnter?.(createMouseEvent())

    expect(requestPreview).toHaveBeenCalledWith('popup-1', noteChild)
  })

  it('does not request preview while panning', () => {
    const requestPreview = jest.fn()
    const { renderer } = createRenderer({ requestPreview })
    const options: PopupChildRowOptions = { ...baseOptions, isPanning: true }

    const element = renderer('popup-1', options)(noteChild, [])
    element.props.onMouseEnter?.(createMouseEvent())

    expect(requestPreview).not.toHaveBeenCalled()
  })

  it('clears previews when hovering folders', () => {
    const requestPreview = jest.fn()
    const { renderer } = createRenderer({ requestPreview })

    const element = renderer('popup-1', baseOptions)(folderChild, [])
    element.props.onMouseEnter?.(createMouseEvent())

    expect(requestPreview).toHaveBeenCalledWith('popup-1', null)
  })

  it('delegates selection handling on click', () => {
    const handleItemSelect = jest.fn()
    const popupSelections = new Map<string, Set<string>>([
      ['popup-1', new Set<string>(['note-1'])]
    ])

    const { renderer } = createRenderer({ handleItemSelect, popupSelections })
    const siblings: PopupChildNode[] = []
    const event = createMouseEvent()

    const element = renderer('popup-1', baseOptions)(noteChild, siblings)
    element.props.onClick?.(event)

    expect(event.stopPropagation).toHaveBeenCalled()
    expect(handleItemSelect).toHaveBeenCalledWith('popup-1', 'note-1', siblings, event)
  })

  it('activates notes layer and invokes onSelectNote on double click', () => {
    const onSelectNote = jest.fn()
    const setActiveLayer = jest.fn()

    const popups = new Map<string, PopupData>()
    popups.set(
      'popup-1',
      {
        id: 'popup-1',
        folder: null,
        position: { x: 0, y: 0 },
        canvasPosition: { x: 0, y: 0 },
        level: 0
      } as PopupData
    )

    const { renderer } = createRenderer({
      onSelectNote,
      layerCtx: { activeLayer: 'popups', setActiveLayer } as unknown as PopupChildRowDeps['layerCtx'],
      popups
    })

    const element = renderer('popup-1', baseOptions)(noteChild, [])
    element.props.onDoubleClick?.()

    expect(onSelectNote).toHaveBeenCalledWith('note-1')
    expect(setActiveLayer).toHaveBeenCalledWith('notes')
  })
})
