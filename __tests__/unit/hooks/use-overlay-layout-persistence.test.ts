import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import { renderHook, act } from './test-utils/render-hook'

import type { OverlayPopup } from '@/components/floating-toolbar'
import type { LayerContextValue } from '@/components/canvas/layer-provider'
import { useOverlayLayoutPersistence } from '@/lib/hooks/annotation/use-overlay-layout-persistence'
import type { OverlayCameraState, OverlayLayoutPayload } from '@/lib/types/overlay-layout'
import type { OverlayLayoutAdapter } from '@/lib/adapters/overlay-layout-adapter'
import type { toast as ToastFn } from '@/hooks/use-toast'

type PendingSnapshot = { payload: OverlayLayoutPayload; hash: string }

const DEFAULT_CAMERA: OverlayCameraState = { x: 0, y: 0, scale: 1 }

const createRef = <T,>(value: T): MutableRefObject<T> => ({ current: value })

const createOverlaySetter = () => {
  const stateRef: { current: OverlayPopup[] } = { current: [] }
  const setter: Dispatch<SetStateAction<OverlayPopup[]>> = (update) => {
    stateRef.current =
      typeof update === 'function'
        ? (update as (prev: OverlayPopup[]) => OverlayPopup[])(stateRef.current)
        : update
  }
  return { stateRef, setter }
}

const flushAsync = async () => {
  await Promise.resolve()
  await Promise.resolve()
}

describe('useOverlayLayoutPersistence', () => {
  it('shows diagnostics toast and repairs popups with ancestor color fallbacks', async () => {
    const { stateRef, setter } = createOverlaySetter()

    const fetchGlobalFolder = jest.fn().mockResolvedValue({
      id: 'folder-1',
      name: 'Folder One',
      parentId: 'parent-1',
      color: null,
    })
    const fetchGlobalChildren = jest.fn().mockResolvedValue([
      {
        id: 'child-1',
        name: 'Child Note',
        type: 'note',
      },
    ])
    const fetchWithKnowledgeBase = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        item: { id: 'parent-1', name: 'Parent', color: 'amber', parentId: null },
      }),
    })

    const toast: jest.MockedFunction<ToastFn> = jest.fn()
    const layerContext = {
      setTransform: jest.fn(),
      transforms: { popups: DEFAULT_CAMERA },
      activeLayer: 'popups',
    } as unknown as LayerContextValue

    const debugLog = jest.fn()
    const isDebugEnabled = jest.fn().mockReturnValue(false)

    const overlayAdapterRef = createRef<OverlayLayoutAdapter | null>(null)
    const layoutLoadedRef = createRef(false)
    const layoutRevisionRef = createRef<string | null>(null)
    const lastSavedLayoutHashRef = createRef<string | null>(null)
    const pendingLayoutRef = createRef<PendingSnapshot | null>(null)
    const saveInFlightRef = createRef(false)
    const saveTimeoutRef = createRef<NodeJS.Timeout | null>(null)
    const isInitialLoadRef = createRef(false)
    const latestCameraRef = createRef<OverlayCameraState>(DEFAULT_CAMERA)
    const prevCameraForSaveRef = createRef<OverlayCameraState>(DEFAULT_CAMERA)

    const { result } = renderHook(() =>
      useOverlayLayoutPersistence({
        overlayPersistenceActive: false,
        currentWorkspaceId: 'workspace-1',
        overlayPopupsLength: 0,
        setOverlayPopups: setter,
        fetchGlobalFolder,
        fetchGlobalChildren,
        fetchWithKnowledgeBase,
        toast,
        layerContext,
        debugLog,
        isDebugEnabled,
        overlayAdapterRef,
        layoutLoadedRef,
        layoutRevisionRef,
        lastSavedLayoutHashRef,
        pendingLayoutRef,
        saveInFlightRef,
        saveTimeoutRef,
        isInitialLoadRef,
        latestCameraRef,
        prevCameraForSaveRef,
        setIsWorkspaceLayoutLoading: jest.fn(),
        defaultCamera: DEFAULT_CAMERA,
      }),
    )

    const layout: OverlayLayoutPayload = {
      schemaVersion: '2.2.0',
      popups: [
        {
          id: 'popup-1',
          folderId: 'folder-1',
          folderName: 'Folder One',
          parentId: null,
          canvasPosition: { x: 5, y: 10 },
          level: 0,
          width: 320,
          height: 240,
        },
      ],
      inspectors: [],
      lastSavedAt: new Date().toISOString(),
      camera: { x: 25, y: 50, scale: 1.2 },
      diagnostics: {
        workspaceMismatches: [
          {
            popupId: 'popup-1',
            folderId: 'folder-1',
            expectedWorkspaceId: 'workspace-1',
            actualWorkspaceId: 'workspace-remote',
          },
        ],
        missingFolders: [],
      },
    }

    await act(async () => {
      result.current.applyOverlayLayout(layout)
    })

    await act(async () => {
      await flushAsync()
    })

    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({
        variant: 'destructive',
        title: 'Overlay layout needs repair',
      }),
    )
    expect(fetchGlobalFolder).toHaveBeenCalledWith('folder-1')
    expect(fetchWithKnowledgeBase).toHaveBeenCalledWith('/api/items/parent-1')
    expect(fetchGlobalChildren).toHaveBeenCalledWith('folder-1')

    expect(stateRef.current).toHaveLength(1)
    expect(stateRef.current[0].folder?.color).toBe('amber')
    expect(stateRef.current[0].children).toHaveLength(1)
    expect(stateRef.current[0].isLoading).toBe(false)

    expect(layerContext.setTransform).toHaveBeenCalledWith('popups', layout.camera)
    expect(lastSavedLayoutHashRef.current).not.toBeNull()
  })
})
