import { jest } from '@jest/globals'

jest.mock('@/lib/utils/debug-logger', () => ({
  debugLog: jest.fn().mockResolvedValue(undefined),
}))

import { loadStateFromStorage } from '@/lib/canvas/canvas-storage'
import { debugLog } from '@/lib/utils/debug-logger'

const STORAGE_KEY = 'annotation-canvas-state:test-note'

const baseSnapshot = (overrides: Partial<{
  savedAt: number
  workspaceVersion: number | undefined
  viewport: any
  items: any[]
}> = {}) => ({
  version: '1.2.0',
  savedAt: overrides.savedAt ?? Date.now(),
  panels: {
    workspaceVersion: overrides.workspaceVersion,
    viewport: overrides.viewport ?? {
      zoom: 1,
      translateX: 0,
      translateY: 0,
      showConnections: true,
    },
    items: overrides.items ?? [],
    layerNodes: undefined,
  },
})

describe('canvas-storage loadStateFromStorage', () => {
  beforeEach(() => {
    window.localStorage.clear()
    jest.clearAllMocks()
  })

  it('returns normalized snapshot when versions match', () => {
    const payload = baseSnapshot({ workspaceVersion: 2 })
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))

    const result = loadStateFromStorage('test-note', 2)

    expect(result).toBeTruthy()
    expect(result?.workspaceVersion).toBe(2)
    expect(result?.version).toBe('1.2.0')
    expect(result?.viewport.zoom).toBe(1)
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeTruthy()
    expect(debugLog).toHaveBeenCalledWith(
      expect.objectContaining({
        component: 'CanvasCache',
        action: 'canvas.cache_used',
      }),
    )
  })

  it('discards snapshot when workspace version mismatches', () => {
    const payload = baseSnapshot({ workspaceVersion: 1 })
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))

    const result = loadStateFromStorage('test-note', 2)

    expect(result).toBeNull()
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull()

    expect(debugLog).toHaveBeenCalledWith(
      expect.objectContaining({
        component: 'CanvasCache',
        action: 'canvas.cache_mismatch',
      }),
    )
    expect(debugLog).toHaveBeenCalledWith(
      expect.objectContaining({
        component: 'CanvasCache',
        action: 'canvas.cache_discarded',
        metadata: expect.objectContaining({ reason: 'workspace_version_mismatch' }),
      }),
    )
  })

  it('discards snapshot when TTL expired', () => {
    const twentySixHoursAgo = Date.now() - 26 * 60 * 60 * 1000
    const payload = baseSnapshot({
      savedAt: twentySixHoursAgo,
      workspaceVersion: 0,
    })
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))

    const result = loadStateFromStorage('test-note', 0)

    expect(result).toBeNull()
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull()
    expect(debugLog).toHaveBeenCalledWith(
      expect.objectContaining({
        component: 'CanvasCache',
        action: 'canvas.cache_discarded',
        metadata: expect.objectContaining({ reason: 'expired' }),
      }),
    )
  })
})

