import type { MutableRefObject } from 'react'
import { renderHook, act } from './test-utils/render-hook'

import { useCanvasCentering } from '@/lib/hooks/annotation/use-canvas-centering'
import { centerOnNotePanel } from '@/lib/canvas/center-on-note'

jest.mock('@/lib/canvas/center-on-note', () => ({
  centerOnNotePanel: jest.fn(() => true)
}))

const createActiveNoteRef = (value: string | null = null): MutableRefObject<string | null> => ({
  current: value
})

const createHook = (activeNoteId: string | null = null) => {
  const debugLog = jest.fn()
  const events = { emit: jest.fn() }

  const hook = renderHook(() =>
    useCanvasCentering({
      activeNoteIdRef: createActiveNoteRef(activeNoteId),
      debugLog,
      sharedWorkspace: { events }
    })
  )

  return { hook, debugLog, events }
}

describe('useCanvasCentering', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    jest.clearAllMocks()
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('registers fresh notes and emits highlight once hydrated', () => {
    const { hook, events } = createHook()
    const noteId = 'note-1'

    act(() => {
      hook.result.current.registerFreshNote(noteId)
    })

    expect(hook.result.current.freshNoteIds).toEqual([noteId])

    act(() => {
      hook.result.current.handleFreshNoteHydrated(noteId)
    })

    expect(hook.result.current.freshNoteIds).toHaveLength(0)
    expect(events.emit).toHaveBeenCalledWith('workspace:highlight-note', { noteId })
  })

  it('stores and consumes fresh note seeds', () => {
    const { hook } = createHook()

    act(() => {
      hook.result.current.storeFreshNoteSeed('note-2', { x: 5, y: 10 })
    })

    expect(hook.result.current.freshNoteSeeds['note-2']).toEqual({ x: 5, y: 10 })

    act(() => {
      hook.result.current.consumeFreshNoteSeed('note-2')
    })

    expect(hook.result.current.freshNoteSeeds['note-2']).toBeUndefined()
  })

  it('centers pending notes after snapshot load completes', () => {
    const activeRef = createActiveNoteRef('note-3')
    const debugLog = jest.fn()
    const hook = renderHook(() =>
      useCanvasCentering({
        activeNoteIdRef: activeRef,
        debugLog,
        sharedWorkspace: null
      })
    )

    act(() => {
      hook.result.current.queueCenterAfterSnapshot('note-3')
      hook.result.current.handleSnapshotLoadComplete()
    })

    act(() => {
      jest.runOnlyPendingTimers()
    })

    expect(centerOnNotePanel).toHaveBeenCalledWith(
      hook.result.current.canvasRef.current,
      'note-3',
      expect.objectContaining({
        attempts: expect.any(Number),
        delayMs: expect.any(Number)
      })
    )
  })
})
