import type { MutableRefObject } from 'react'
import { renderHook, act } from './test-utils/render-hook'

import { useOverlayLayoutSaveQueue } from '@/lib/hooks/annotation/use-overlay-layout-save-queue'
import { OverlayLayoutConflictError, type OverlayLayoutAdapter } from '@/lib/adapters/overlay-layout-adapter'
import type { OverlayPopup } from '@/components/floating-toolbar'
import type { OverlayCameraState, OverlayLayoutPayload } from '@/lib/types/overlay-layout'

type PendingSnapshot = { payload: OverlayLayoutPayload; hash: string }

const DEFAULT_CAMERA: OverlayCameraState = { x: 0, y: 0, scale: 1 }

const createRef = <T,>(value: T): MutableRefObject<T> => ({ current: value })

const createPopup = (overrides: Partial<OverlayPopup> = {}): OverlayPopup => ({
  id: 'popup-1',
  folderId: 'folder-1',
  folderName: 'Folder One',
  folder: null,
  position: { x: 10, y: 10 },
  canvasPosition: { x: 10, y: 10 },
  width: 320,
  height: 260,
  children: [],
  isLoading: false,
  isPersistent: true,
  level: 0,
  ...overrides,
})

const createEnvelope = (layout: OverlayLayoutPayload) => ({
  layout,
  version: layout.schemaVersion,
  revision: 'rev-1',
  updatedAt: new Date().toISOString(),
})

const createLayout = (): OverlayLayoutPayload => ({
  schemaVersion: '2.2.0',
  popups: [
    {
      id: 'popup-1',
      folderId: 'folder-1',
      folderName: 'Folder One',
      parentId: null,
      canvasPosition: { x: 10, y: 10 },
      level: 0,
      width: 320,
      height: 260,
    },
  ],
  inspectors: [],
  lastSavedAt: new Date().toISOString(),
  camera: DEFAULT_CAMERA,
})

describe('useOverlayLayoutSaveQueue', () => {
  beforeEach(() => {
    jest.useFakeTimers()
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('debounces layout saves before flushing to the adapter', async () => {
    const adapterSave = jest.fn().mockResolvedValue(createEnvelope(createLayout()))

    const overlayAdapterRef = createRef<OverlayLayoutAdapter | null>({
      saveLayout: adapterSave,
    } as unknown as OverlayLayoutAdapter)
    const layoutRevisionRef = createRef<string | null>(null)
    const lastSavedLayoutHashRef = createRef<string | null>(null)
    const pendingLayoutRef = createRef<PendingSnapshot | null>(null)
    const saveTimeoutRef = createRef<NodeJS.Timeout | null>(null)
    const saveInFlightRef = createRef(false)

    const { result } = renderHook(() =>
      useOverlayLayoutSaveQueue({
        overlayPopups: [createPopup()],
        layerTransform: DEFAULT_CAMERA,
        overlayPersistenceActive: true,
        overlayAdapterRef,
        layoutRevisionRef,
        lastSavedLayoutHashRef,
        pendingLayoutRef,
        saveTimeoutRef,
        saveInFlightRef,
        applyOverlayLayout: jest.fn(),
        draggingPopup: null,
        defaultCamera: DEFAULT_CAMERA,
        defaultWidth: 320,
        defaultHeight: 260,
        debugLog: jest.fn(),
        isDebugEnabled: () => false,
      }),
    )

    act(() => {
      result.current.scheduleLayoutSave()
    })

    expect(adapterSave).not.toHaveBeenCalled()

    await act(async () => {
      jest.advanceTimersByTime(2500)
      await Promise.resolve()
    })

    expect(adapterSave).toHaveBeenCalledTimes(1)
    expect(pendingLayoutRef.current).toBeNull()
    expect(lastSavedLayoutHashRef.current).not.toBeNull()
  })

  it('applies remote layouts when a revision conflict occurs', async () => {
    const applyOverlayLayout = jest.fn()
    const layout = createLayout()
    const conflictEnvelope = {
      layout: {
        ...layout,
        popups: [
          {
            id: 'remote-popup',
            folderId: 'folder-remote',
            folderName: 'Remote',
            parentId: null,
            canvasPosition: { x: 20, y: 20 },
            level: 0,
            width: 340,
            height: 240,
          },
        ],
      },
      version: layout.schemaVersion,
      revision: 'remote-rev',
      updatedAt: new Date().toISOString(),
    }

    const adapterSave = jest.fn().mockRejectedValue(new OverlayLayoutConflictError(conflictEnvelope))

    const overlayAdapterRef = createRef<OverlayLayoutAdapter | null>({
      saveLayout: adapterSave,
    } as unknown as OverlayLayoutAdapter)
    const layoutRevisionRef = createRef<string | null>(null)
    const lastSavedLayoutHashRef = createRef<string | null>(null)
    const pendingLayoutRef = createRef<PendingSnapshot | null>(null)
    const saveTimeoutRef = createRef<NodeJS.Timeout | null>(null)
    const saveInFlightRef = createRef(false)

    const { result } = renderHook(() =>
      useOverlayLayoutSaveQueue({
        overlayPopups: [createPopup()],
        layerTransform: DEFAULT_CAMERA,
        overlayPersistenceActive: true,
        overlayAdapterRef,
        layoutRevisionRef,
        lastSavedLayoutHashRef,
        pendingLayoutRef,
        saveTimeoutRef,
        saveInFlightRef,
        applyOverlayLayout,
        draggingPopup: null,
        defaultCamera: DEFAULT_CAMERA,
        defaultWidth: 320,
        defaultHeight: 260,
        debugLog: jest.fn(),
        isDebugEnabled: () => false,
      }),
    )

    const snapshot = result.current.buildLayoutPayload()
    pendingLayoutRef.current = snapshot

    await act(async () => {
      await result.current.flushLayoutSave()
    })

    expect(applyOverlayLayout).toHaveBeenCalledWith(conflictEnvelope.layout)
    expect(layoutRevisionRef.current).toBe('remote-rev')
    expect(pendingLayoutRef.current).toBeNull()
  })
})
