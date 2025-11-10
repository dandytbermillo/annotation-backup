import type React from 'react'
import type { OrgItem, OverlayPopup } from '@/components/floating-toolbar'
import { usePopupOverlayState } from '@/lib/hooks/annotation/use-popup-overlay-state'
import { renderHook, act } from './test-utils/render-hook'

const baseFolder: OrgItem = {
  id: 'folder-root',
  name: 'Root',
  type: 'folder',
  icon: '📁',
  color: '#3366ff',
  path: '/root',
  hasChildren: true,
  level: 0,
  children: [],
  parentId: null
}

const createHoverEvent = (): React.MouseEvent<HTMLElement> =>
  ({
    currentTarget: {
      getBoundingClientRect: () =>
        ({
          x: 40,
          y: 60,
          width: 180,
          height: 40,
          top: 60,
          left: 40,
          right: 220,
          bottom: 100,
          toJSON: () => ({})
        }) as DOMRect
    },
    stopPropagation: jest.fn()
  }) as unknown as React.MouseEvent<HTMLElement>

const flushAsync = async () => {
  await act(async () => {
    await Promise.resolve()
  })
}

const createFolderCache = () => {
  const api = {
    getEntry: jest.fn().mockReturnValue(null),
    updateFolderSnapshot: jest.fn(),
    updateChildrenSnapshot: jest.fn(),
    invalidate: jest.fn(),
    fetchFolder: jest.fn(),
    fetchChildren: jest.fn()
  }
  return api
}

const createLayerContext = () =>
  ({
    transforms: {
      popups: { x: 0, y: 0, scale: 1 }
    }
  }) as any

const createOverlayPopup = (overrides: Partial<OverlayPopup> = {}): OverlayPopup => ({
  id: overrides.id ?? 'popup-' + Math.random().toString(36).slice(2),
  folderId: overrides.folderId ?? 'folder-' + Math.random().toString(36).slice(2),
  folderName: overrides.folderName ?? 'Folder',
  folder:
    overrides.folder ??
    ({
      id: overrides.folderId ?? 'folder-seed',
      name: overrides.folderName ?? 'Folder',
      type: 'folder',
      level: overrides.level ?? 0,
      color: overrides.folder?.color,
      path: '/folder',
      children: [],
    } satisfies OrgItem),
  position: overrides.position ?? { x: 0, y: 0 },
  canvasPosition: overrides.canvasPosition ?? { x: 0, y: 0 },
  parentId: overrides.parentId ?? null,
  width: overrides.width ?? 320,
  height: overrides.height,
  sizeMode: overrides.sizeMode ?? 'default',
  children: overrides.children ?? [],
  isLoading: overrides.isLoading ?? false,
  isPersistent: overrides.isPersistent ?? true,
  level: overrides.level ?? 0,
  parentPopupId: overrides.parentPopupId,
  isHighlighted: overrides.isHighlighted ?? false,
  closeMode: overrides.closeMode,
  isPinned: overrides.isPinned,
  moveMode: overrides.moveMode,
  isDragging: overrides.isDragging,
})

describe('usePopupOverlayState', () => {
  beforeEach(() => {
    jest.useFakeTimers()
  })

  afterEach(() => {
    jest.runOnlyPendingTimers()
    jest.useRealTimers()
    jest.clearAllMocks()
  })

  it('creates a popup after hover delay and hydrates children', async () => {
    const fetchChildren = jest.fn().mockResolvedValue([
      { id: 'child-a', name: 'Doc A', type: 'note' }
    ])
    const folderCache = createFolderCache()
    const ensureOverlayHydrated = jest.fn()

    const hook = renderHook(() =>
      usePopupOverlayState({
        layerContext: createLayerContext(),
        folderCache,
        fetchChildren,
        ensureOverlayHydrated,
        popupWidth: 280
      })
    )

    await act(async () => {
      await hook.result.current.handleFolderHover(baseFolder, createHoverEvent(), 'parent-1')
    })
    act(() => {
      jest.advanceTimersByTime(350)
    })
    await flushAsync()

    expect(fetchChildren).toHaveBeenCalledWith('folder-root', { forceRefresh: false })
    expect(folderCache.updateFolderSnapshot).toHaveBeenCalledWith('folder-root', expect.objectContaining({ id: 'folder-root' }))
    expect(folderCache.updateChildrenSnapshot).toHaveBeenCalledWith(
      'folder-root',
      expect.arrayContaining([{ id: 'child-a', name: 'Doc A', type: 'note' }])
    )
    expect(hook.result.current.popups).toHaveLength(1)
    expect(hook.result.current.popups[0].children).toHaveLength(1)
    expect(ensureOverlayHydrated).toHaveBeenCalledWith('sidebar-hover')
  })

  it('creates a persistent popup immediately and forces child refresh', async () => {
    const fetchChildren = jest.fn().mockResolvedValue([{ id: 'child-b', name: 'Folder B', type: 'folder' }])
    const folderCache = createFolderCache()
    const ensureOverlayHydrated = jest.fn()

    const hook = renderHook(() =>
      usePopupOverlayState({
        layerContext: createLayerContext(),
        folderCache,
        fetchChildren,
        ensureOverlayHydrated,
        popupWidth: 320
      })
    )

    await act(async () => {
      await hook.result.current.handleFolderHover(baseFolder, createHoverEvent(), 'parent-2', true)
    })
    await flushAsync()

    expect(fetchChildren).toHaveBeenCalledWith('folder-root', { forceRefresh: true })
    expect(folderCache.updateChildrenSnapshot).toHaveBeenCalledWith(
      'folder-root',
      expect.arrayContaining([{ id: 'child-b', name: 'Folder B', type: 'folder' }])
    )
    expect(hook.result.current.popups).toHaveLength(1)
    expect(hook.result.current.popups[0].isPersistent).toBe(true)
  })

  it('closes a non-persistent popup after hover leave timeout', async () => {
    const fetchChildren = jest.fn().mockResolvedValue([])
    const folderCache = createFolderCache()

    const hook = renderHook(() =>
      usePopupOverlayState({
        layerContext: createLayerContext(),
        folderCache,
        fetchChildren,
        ensureOverlayHydrated: jest.fn(),
        popupWidth: 280
      })
    )

    await act(async () => {
      await hook.result.current.handleFolderHover(baseFolder, createHoverEvent(), 'parent-3')
    })
    act(() => {
      jest.advanceTimersByTime(350)
    })
    await flushAsync()
    expect(hook.result.current.popups).toHaveLength(1)

    act(() => {
      hook.result.current.handleFolderHoverLeave(baseFolder.id)
      jest.advanceTimersByTime(320)
    })
    await flushAsync()

    expect(hook.result.current.popups).toHaveLength(0)
  })

  it('inherits parent folder colors when child lacks one', async () => {
    const parentPopup = createOverlayPopup({
      id: 'parent',
      folderId: 'parent-folder',
      folderName: 'Parent',
      folder: {
        id: 'parent-folder',
        name: 'Parent',
        type: 'folder',
        level: 0,
        color: 'violet',
        path: '/parent',
        children: [],
      },
      level: 0,
    })

    const hook = renderHook(() =>
      usePopupOverlayState({
        layerContext: createLayerContext(),
        folderCache: createFolderCache(),
        fetchChildren: jest.fn().mockResolvedValue([]),
        initialPopups: [parentPopup],
      })
    )

    const childFolder: OrgItem = {
      id: 'child-folder',
      name: 'Child',
      type: 'folder',
      level: 1,
      hasChildren: false,
      children: [],
    }

    await act(async () => {
      await hook.result.current.handleFolderHover(childFolder, createHoverEvent(), 'parent', true)
    })
    await flushAsync()

    const childPopup = hook.result.current.popups.find((popup) => popup.folderId === 'child-folder')
    expect(childPopup).toBeTruthy()
    expect(childPopup?.folder?.color).toBe('violet')
  })

  it('toggles move cascade mode for parent and descendants', () => {
    const parentPopup = createOverlayPopup({
      id: 'parent',
      folderId: 'parent-folder',
      folderName: 'Parent',
      children: [{ ...baseFolder, id: 'child-folder', parentId: 'parent-folder', level: 1 }],
    })
    const childPopup = createOverlayPopup({
      id: 'child',
      folderId: 'child-folder',
      folderName: 'Child',
      parentPopupId: 'parent',
      level: 1,
    })

    const hook = renderHook(() =>
      usePopupOverlayState({
        layerContext: createLayerContext(),
        folderCache: createFolderCache(),
        fetchChildren: jest.fn(),
        initialPopups: [parentPopup, childPopup],
      })
    )

    act(() => {
      hook.result.current.toggleMoveCascade('parent')
    })

    const afterEnableParent = hook.result.current.popups.find((popup) => popup.id === 'parent')
    const afterEnableChild = hook.result.current.popups.find((popup) => popup.id === 'child')
    expect(afterEnableParent?.moveMode).toBe('parent')
    expect(afterEnableChild?.moveMode).toBe('child')

    act(() => {
      hook.result.current.toggleMoveCascade('parent')
    })

    const afterDisableParent = hook.result.current.popups.find((popup) => popup.id === 'parent')
    const afterDisableChild = hook.result.current.popups.find((popup) => popup.id === 'child')
    expect(afterDisableParent?.moveMode).toBeUndefined()
    expect(afterDisableChild?.moveMode).toBeUndefined()
  })
})
