/**
 * Unit Test: Toolbar Ordering & Batching Workflow
 *
 * Tests the batched persistence logic with 300ms shared debounce timer
 * and ordered toolbar state management.
 *
 * @see docs/proposal/canvas_state_persistence/design/2025-10-19-toolbar-ordering-and-visibility-tdd.md
 */

import { renderHook, act, waitFor } from '@testing/library/react'
import { CanvasWorkspaceProvider, useCanvasWorkspace } from '@/components/canvas/canvas-workspace-context'
import { debugLog } from '@/lib/utils/debug-logger'

// Mock fetch globally
global.fetch = jest.fn()

// Mock debugLog
jest.mock('@/lib/utils/debug-logger', () => ({
  debugLog: jest.fn().mockResolvedValue(undefined)
}))

// Mock environment variable
const originalEnv = process.env.NEXT_PUBLIC_CANVAS_TOOLBAR_REPLAY

beforeAll(() => {
  process.env.NEXT_PUBLIC_CANVAS_TOOLBAR_REPLAY = 'enabled'
})

afterAll(() => {
  process.env.NEXT_PUBLIC_CANVAS_TOOLBAR_REPLAY = originalEnv
})

beforeEach(() => {
  jest.clearAllMocks()
  ;(global.fetch as jest.Mock).mockClear()
  jest.useFakeTimers()
})

afterEach(() => {
  jest.runOnlyPendingTimers()
  jest.useRealTimers()
})

describe('Toolbar Ordering & Batching', () => {
  it('should batch multiple position updates with 300ms debounce', async () => {
    const mockFetch = global.fetch as jest.Mock

    // Mock GET response for initial load
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        openNotes: [],
        panels: []
      })
    })

    // Mock POST /update response for batch
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true })
    })

    const { result } = renderHook(() => useCanvasWorkspace(), {
      wrapper: CanvasWorkspaceProvider
    })

    // Wait for initial load
    await waitFor(() => expect(result.current.isWorkspaceReady).toBe(true))

    // Clear initial fetch calls
    mockFetch.mockClear()

    // Schedule 3 position updates within 300ms window
    act(() => {
      result.current.updateMainPosition('note-1', { x: 100, y: 100 }, true)
    })

    act(() => {
      jest.advanceTimersByTime(50) // 50ms later
      result.current.updateMainPosition('note-2', { x: 200, y: 200 }, true)
    })

    act(() => {
      jest.advanceTimersByTime(50) // 100ms total
      result.current.updateMainPosition('note-3', { x: 300, y: 300 }, true)
    })

    // Advance to trigger batch (300ms debounce)
    await act(async () => {
      jest.advanceTimersByTime(300)
    })

    // Wait for async persist call
    await waitFor(() => {
      const postCalls = mockFetch.mock.calls.filter(
        call => call[0] === '/api/canvas/workspace/update' && call[1]?.method === 'POST'
      )
      expect(postCalls.length).toBeGreaterThan(0)
    })

    // Verify single batched POST /update call
    const postCalls = mockFetch.mock.calls.filter(
      call => call[0] === '/api/canvas/workspace/update' && call[1]?.method === 'POST'
    )

    expect(postCalls).toHaveLength(1)

    const payload = JSON.parse(postCalls[0][1].body)
    expect(payload.notes).toHaveLength(3)
    expect(payload.notes).toContainEqual({
      noteId: 'note-1',
      isOpen: true,
      mainPosition: { x: 100, y: 100 }
    })
    expect(payload.notes).toContainEqual({
      noteId: 'note-2',
      isOpen: true,
      mainPosition: { x: 200, y: 200 }
    })
    expect(payload.notes).toContainEqual({
      noteId: 'note-3',
      isOpen: true,
      mainPosition: { x: 300, y: 300 }
    })
  })

  it('should retry on 409 conflict up to 3 times with 50ms backoff', async () => {
    const mockFetch = global.fetch as jest.Mock

    // Mock GET response for initial load
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        openNotes: [],
        panels: []
      })
    })

    // Mock 409 conflict twice, then success on third try
    mockFetch
      .mockResolvedValueOnce({ ok: false, status: 409, text: async () => 'Conflict' })
      .mockResolvedValueOnce({ ok: false, status: 409, text: async () => 'Conflict' })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ success: true }) })

    const { result } = renderHook(() => useCanvasWorkspace(), {
      wrapper: CanvasWorkspaceProvider
    })

    // Wait for initial load
    await waitFor(() => expect(result.current.isWorkspaceReady).toBe(true))

    // Clear initial calls
    mockFetch.mockClear()

    // Trigger update
    await act(async () => {
      await result.current.updateMainPosition('note-1', { x: 100, y: 100 }, true)
    })

    // Verify 3 attempts (2 retries after initial 409)
    await waitFor(() => {
      const postCalls = mockFetch.mock.calls.filter(
        call => call[0] === '/api/canvas/workspace/update' && call[1]?.method === 'POST'
      )
      expect(postCalls.length).toBe(3)
    })

    // Verify retry telemetry
    expect(debugLog).toHaveBeenCalledWith({
      component: 'CanvasWorkspace',
      action: 'persist_retry_conflict',
      metadata: expect.objectContaining({
        retryCount: expect.any(Number),
        maxRetries: 3
      })
    })
  })

  it('should use POST /update endpoint instead of legacy PATCH when feature flag enabled', async () => {
    const mockFetch = global.fetch as jest.Mock

    // Mock GET response for initial load
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        openNotes: [],
        panels: []
      })
    })

    // Mock POST /update response
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true })
    })

    const { result } = renderHook(() => useCanvasWorkspace(), {
      wrapper: CanvasWorkspaceProvider
    })

    // Wait for initial load
    await waitFor(() => expect(result.current.isWorkspaceReady).toBe(true))

    // Clear initial calls
    mockFetch.mockClear()

    // Trigger update
    await act(async () => {
      await result.current.updateMainPosition('note-1', { x: 100, y: 100 }, true)
    })

    // Verify POST /update was called (not PATCH)
    await waitFor(() => {
      const postCalls = mockFetch.mock.calls.filter(
        call => call[0] === '/api/canvas/workspace/update'
      )
      expect(postCalls.length).toBeGreaterThan(0)
    })

    const patchCalls = mockFetch.mock.calls.filter(
      call => call[0] === '/api/canvas/workspace' && call[1]?.method === 'PATCH'
    )
    expect(patchCalls).toHaveLength(0)
  })

  it('should emit workspace_snapshot_persisted telemetry on successful batch', async () => {
    const mockFetch = global.fetch as jest.Mock

    // Mock GET response for initial load
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        openNotes: [],
        panels: []
      })
    })

    // Mock POST /update response
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true })
    })

    const { result } = renderHook(() => useCanvasWorkspace(), {
      wrapper: CanvasWorkspaceProvider
    })

    // Wait for initial load
    await waitFor(() => expect(result.current.isWorkspaceReady).toBe(true))

    // Clear mock calls
    ;(debugLog as jest.Mock).mockClear()

    // Trigger update
    await act(async () => {
      await result.current.updateMainPosition('note-1', { x: 100, y: 100 }, true)
    })

    // Verify telemetry
    await waitFor(() => {
      expect(debugLog).toHaveBeenCalledWith({
        component: 'CanvasWorkspace',
        action: 'workspace_snapshot_persisted',
        metadata: expect.objectContaining({
          noteIds: ['note-1'],
          retryCount: expect.any(Number)
        })
      })
    })
  })
})
