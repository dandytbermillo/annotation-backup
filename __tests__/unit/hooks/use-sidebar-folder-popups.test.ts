import type React from 'react'
import type { OrgItem } from '@/components/floating-toolbar'
import { useSidebarFolderPopups } from '@/lib/hooks/annotation/use-sidebar-folder-popups'
import { renderHook, act } from './test-utils/render-hook'

type HookHarness = ReturnType<typeof setupSidebarHook>

const mockRect = (): DOMRect =>
  ({
    x: 10,
    y: 20,
    width: 120,
    height: 32,
    top: 20,
    left: 10,
    right: 130,
    bottom: 52,
    toJSON: () => ({})
  }) as DOMRect

const createHoverEvent = (): React.MouseEvent<HTMLElement> =>
  ({
    stopPropagation: jest.fn(),
    currentTarget: {
      getBoundingClientRect: () => mockRect()
    }
  }) as unknown as React.MouseEvent<HTMLElement>

const baseFolder: OrgItem = {
  id: 'folder-1',
  name: 'Inbox',
  type: 'folder',
  icon: '📁',
  color: '#663399',
  path: '/inbox',
  hasChildren: true,
  level: 0,
  children: [],
  parentId: null
}

const flushAsync = async () => {
  await act(async () => {
    await Promise.resolve()
  })
}

function setupSidebarHook(overrides?: {
  fetchChildren?: ReturnType<typeof jest.fn>
  getPreviewSourceFolderId?: () => string | undefined
}) {
  const ensureOverlayHydrated = jest.fn()
  const fetchChildren =
    overrides?.fetchChildren ??
    jest.fn().mockResolvedValue([
      { id: 'child-1', name: 'Doc', type: 'note' },
      { id: 'child-2', name: 'Archive', type: 'folder' }
    ])
  const onSelectFolder = jest.fn()
  const onOpenNote = jest.fn()
  const triggerNotePreviewHover = jest.fn()
  const triggerNotePreviewLeave = jest.fn()
  const triggerNotePreviewTooltipEnter = jest.fn()
  const triggerNotePreviewTooltipLeave = jest.fn()
  const cancelNotePreview = jest.fn()
  const getPreviewSourceFolderId = overrides?.getPreviewSourceFolderId ?? (() => undefined)

  const hook = renderHook(() =>
    useSidebarFolderPopups({
      ensureOverlayHydrated,
      fetchChildren,
      onSelectFolder,
      onOpenNote,
      triggerNotePreviewHover,
      triggerNotePreviewLeave,
      triggerNotePreviewTooltipEnter,
      triggerNotePreviewTooltipLeave,
      cancelNotePreview,
      getPreviewSourceFolderId
    })
  )

  return {
    ...hook,
    ensureOverlayHydrated,
    fetchChildren,
    onSelectFolder,
    onOpenNote,
    triggerNotePreviewHover,
    triggerNotePreviewLeave,
    triggerNotePreviewTooltipEnter,
    triggerNotePreviewTooltipLeave,
    cancelNotePreview,
    getPreviewSourceFolderId
  }
}

describe('useSidebarFolderPopups', () => {
  beforeEach(() => {
    jest.useFakeTimers()
  })

  afterEach(() => {
    jest.runOnlyPendingTimers()
    jest.useRealTimers()
    jest.clearAllMocks()
  })

  it('creates a sidebar popup and hydrates children on hover', async () => {
    const harness = setupSidebarHook()
    const event = createHoverEvent()

    await act(async () => {
      await harness.result.current.handleSidebarOrgEyeHover(baseFolder, event)
    })
    await flushAsync()

    expect(harness.fetchChildren).toHaveBeenCalledWith('folder-1')
    expect(harness.result.current.sidebarFolderPopups).toHaveLength(1)
    const popup = harness.result.current.sidebarFolderPopups[0]
    expect(popup.folderId).toBe('folder-1')
    expect(popup.children.map(child => child.id)).toEqual(['child-1', 'child-2'])
    expect(popup.isLoading).toBe(false)
  })

  it('cancels the pending close when hover returns before timeout and eventually removes popup', async () => {
    const harness = setupSidebarHook()
    await act(async () => {
      await harness.result.current.handleSidebarOrgEyeHover(baseFolder, createHoverEvent())
    })
    await flushAsync()

    act(() => {
      harness.result.current.handleSidebarEyeHoverLeave(baseFolder.id)
    })
    act(() => {
      jest.advanceTimersByTime(150)
    })
    act(() => {
      harness.result.current.handleSidebarPopupHover(baseFolder.id)
    })
    act(() => {
      jest.advanceTimersByTime(100)
    })
    expect(harness.result.current.sidebarFolderPopups).toHaveLength(1)

    act(() => {
      harness.result.current.handleSidebarEyeHoverLeave(baseFolder.id)
      jest.advanceTimersByTime(220)
    })
    await flushAsync()

    expect(harness.result.current.sidebarFolderPopups).toHaveLength(0)
  })

  it('keeps the popup alive while the note preview tooltip is open', async () => {
    const harness = setupSidebarHook({
      getPreviewSourceFolderId: () => baseFolder.id
    })
    await act(async () => {
      await harness.result.current.handleSidebarOrgEyeHover(baseFolder, createHoverEvent())
    })
    await flushAsync()

    act(() => {
      harness.result.current.handleSidebarEyeHoverLeave(baseFolder.id)
    })
    act(() => {
      harness.result.current.handleSidebarPreviewTooltipEnter()
      jest.advanceTimersByTime(250)
    })
    await flushAsync()

    expect(harness.triggerNotePreviewTooltipEnter).toHaveBeenCalledTimes(1)
    expect(harness.result.current.sidebarFolderPopups).toHaveLength(1)

    act(() => {
      harness.result.current.handleSidebarPreviewTooltipLeave()
      jest.advanceTimersByTime(210)
    })
    await flushAsync()

    expect(harness.triggerNotePreviewTooltipLeave).toHaveBeenCalledTimes(1)
  })
})
