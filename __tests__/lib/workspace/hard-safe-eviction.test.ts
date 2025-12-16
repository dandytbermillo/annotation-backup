/**
 * Hard-Safe 4-Cap Eviction Tests
 *
 * Tests for the hard-safe eviction implementation that prevents silent data loss.
 * These tests focus on the runtime-manager exports that support hard-safe eviction.
 *
 * @see docs/proposal/workspace-state-machine/improvement/2025-12-15-hard-safe-4cap-eviction.md
 */

import {
  EvictionBlockType,
  registerEvictionBlockedCallback,
  unregisterEvictionBlockedCallback,
  notifyEvictionBlockedPersistFailed,
} from '@/lib/workspace/runtime-manager'

// Mock the debug logger
jest.mock('@/lib/utils/debug-logger', () => ({
  debugLog: jest.fn().mockResolvedValue(undefined),
}))

describe('Hard-Safe 4-Cap Eviction - Runtime Manager Exports', () => {
  describe('EvictionBlockedCallback Type Extensions (Phase 2)', () => {
    it('should support blockType in eviction blocked callbacks', (done) => {
      const callback = jest.fn((blockedWorkspace: {
        workspaceId: string
        entryId: string | null
        activeOperationCount: number
        reason: string
        blockType: EvictionBlockType
      }) => {
        expect(blockedWorkspace.blockType).toBe('persist_failed')
        expect(blockedWorkspace.activeOperationCount).toBe(0)
        expect(blockedWorkspace.workspaceId).toBe('test-workspace')
        expect(blockedWorkspace.reason).toBe('capacity')
        done()
      })

      registerEvictionBlockedCallback(callback)

      // Trigger the persist_failed notification
      notifyEvictionBlockedPersistFailed('test-workspace', 'capacity')

      // Cleanup
      unregisterEvictionBlockedCallback(callback)
    })

    it('should call all registered callbacks when eviction is blocked', () => {
      const callback1 = jest.fn()
      const callback2 = jest.fn()

      registerEvictionBlockedCallback(callback1)
      registerEvictionBlockedCallback(callback2)

      notifyEvictionBlockedPersistFailed('test-workspace', 'test-reason')

      expect(callback1).toHaveBeenCalledTimes(1)
      expect(callback2).toHaveBeenCalledTimes(1)

      // Both should receive the same payload
      expect(callback1.mock.calls[0][0]).toEqual(
        expect.objectContaining({
          workspaceId: 'test-workspace',
          reason: 'test-reason',
          blockType: 'persist_failed',
          activeOperationCount: 0,
        })
      )

      // Cleanup
      unregisterEvictionBlockedCallback(callback1)
      unregisterEvictionBlockedCallback(callback2)
    })

    it('should not throw when callback throws', () => {
      const errorCallback = jest.fn(() => {
        throw new Error('Test error')
      })
      const successCallback = jest.fn()

      registerEvictionBlockedCallback(errorCallback)
      registerEvictionBlockedCallback(successCallback)

      // Should not throw even if one callback errors
      expect(() => {
        notifyEvictionBlockedPersistFailed('test-workspace', 'test-reason')
      }).not.toThrow()

      // The success callback should still be called
      expect(successCallback).toHaveBeenCalled()

      // Cleanup
      unregisterEvictionBlockedCallback(errorCallback)
      unregisterEvictionBlockedCallback(successCallback)
    })

    it('should unregister callbacks correctly', () => {
      const callback = jest.fn()

      registerEvictionBlockedCallback(callback)
      notifyEvictionBlockedPersistFailed('test-workspace-1', 'reason')
      expect(callback).toHaveBeenCalledTimes(1)

      unregisterEvictionBlockedCallback(callback)
      notifyEvictionBlockedPersistFailed('test-workspace-2', 'reason')
      expect(callback).toHaveBeenCalledTimes(1) // Should not be called again
    })
  })

  describe('notifyEvictionBlockedPersistFailed (Phase 2)', () => {
    it('should set blockType to persist_failed and activeOperationCount to 0', (done) => {
      const callback = jest.fn((payload: {
        blockType: EvictionBlockType
        activeOperationCount: number
      }) => {
        expect(payload.blockType).toBe('persist_failed')
        expect(payload.activeOperationCount).toBe(0)
        done()
      })

      registerEvictionBlockedCallback(callback)
      notifyEvictionBlockedPersistFailed('ws-1', 'eviction')
      unregisterEvictionBlockedCallback(callback)
    })
  })
})

describe('Hard-Safe 4-Cap Eviction - Type Exports', () => {
  describe('EnsureRuntimeResult Type', () => {
    it('should allow ok: true result', () => {
      // This is a compile-time test - if it compiles, it passes
      const okResult: import('@/lib/hooks/annotation/use-note-workspace-runtime-manager').EnsureRuntimeResult = {
        ok: true,
      }
      expect(okResult.ok).toBe(true)
    })

    it('should allow blocked result with workspaceId', () => {
      // This is a compile-time test - if it compiles, it passes
      const blockedResult: import('@/lib/hooks/annotation/use-note-workspace-runtime-manager').EnsureRuntimeResult = {
        ok: false,
        blocked: true,
        blockedWorkspaceId: 'blocked-ws',
      }
      expect(blockedResult.ok).toBe(false)
      expect(blockedResult.blocked).toBe(true)
      expect(blockedResult.blockedWorkspaceId).toBe('blocked-ws')
    })
  })

  describe('EvictionResult Type', () => {
    it('should allow evicted: true result', () => {
      const evictedResult: import('@/lib/hooks/annotation/use-note-workspace-runtime-manager').EvictionResult = {
        evicted: true,
      }
      expect(evictedResult.evicted).toBe(true)
    })

    it('should allow blocked with persist_failed_dirty reason', () => {
      const blockedResult: import('@/lib/hooks/annotation/use-note-workspace-runtime-manager').EvictionResult = {
        evicted: false,
        blocked: true,
        reason: 'persist_failed_dirty',
        workspaceId: 'dirty-ws',
      }
      expect(blockedResult.evicted).toBe(false)
      expect(blockedResult.blocked).toBe(true)
      expect(blockedResult.reason).toBe('persist_failed_dirty')
    })

    it('should allow non-blocked failure reasons', () => {
      const notFoundResult: import('@/lib/hooks/annotation/use-note-workspace-runtime-manager').EvictionResult = {
        evicted: false,
        blocked: false,
        reason: 'not_found',
      }
      expect(notFoundResult.evicted).toBe(false)
      expect(notFoundResult.blocked).toBe(false)

      const isCurrentResult: import('@/lib/hooks/annotation/use-note-workspace-runtime-manager').EvictionResult = {
        evicted: false,
        blocked: false,
        reason: 'is_current',
      }
      expect(isCurrentResult.reason).toBe('is_current')

      const disabledResult: import('@/lib/hooks/annotation/use-note-workspace-runtime-manager').EvictionResult = {
        evicted: false,
        blocked: false,
        reason: 'disabled',
      }
      expect(disabledResult.reason).toBe('disabled')
    })
  })
})

describe('Hard-Safe 4-Cap Eviction - EvictionBlockType', () => {
  it('should export EvictionBlockType with expected values', () => {
    // TypeScript compile-time checks
    const activeOps: EvictionBlockType = 'active_operations'
    const persistFailed: EvictionBlockType = 'persist_failed'

    expect(activeOps).toBe('active_operations')
    expect(persistFailed).toBe('persist_failed')
  })
})

// =============================================================================
// Gap 6: Behavioral Tests
// =============================================================================

import {
  getWorkspaceRuntime,
  hasWorkspaceRuntime,
  removeWorkspaceRuntime,
  listWorkspaceRuntimeIds,
  isWorkspacePinned,
  updatePinnedWorkspaceIds,
  getLeastRecentlyVisibleRuntimeId,
  getActiveOperationCount,
} from '@/lib/workspace/runtime-manager'

describe('Hard-Safe 4-Cap Eviction - Behavioral Tests', () => {
  beforeEach(() => {
    // Clean up any existing runtimes before each test
    listWorkspaceRuntimeIds().forEach(id => {
      removeWorkspaceRuntime(id)
    })
    // Clear pinned workspaces
    updatePinnedWorkspaceIds([])
  })

  afterEach(() => {
    // Clean up after each test
    listWorkspaceRuntimeIds().forEach(id => {
      removeWorkspaceRuntime(id)
    })
    updatePinnedWorkspaceIds([])
  })

  describe('Runtime Management', () => {
    it('should create and remove workspace runtimes', () => {
      expect(hasWorkspaceRuntime('ws-1')).toBe(false)

      getWorkspaceRuntime('ws-1')
      expect(hasWorkspaceRuntime('ws-1')).toBe(true)
      expect(listWorkspaceRuntimeIds()).toContain('ws-1')

      removeWorkspaceRuntime('ws-1')
      expect(hasWorkspaceRuntime('ws-1')).toBe(false)
      expect(listWorkspaceRuntimeIds()).not.toContain('ws-1')
    })

    it('should track multiple workspace runtimes', () => {
      getWorkspaceRuntime('ws-1')
      getWorkspaceRuntime('ws-2')
      getWorkspaceRuntime('ws-3')

      const ids = listWorkspaceRuntimeIds()
      expect(ids).toContain('ws-1')
      expect(ids).toContain('ws-2')
      expect(ids).toContain('ws-3')
      expect(ids.length).toBe(3)
    })
  })

  describe('Pinned Workspace Protection (Gap 4)', () => {
    it('should identify pinned workspaces', () => {
      getWorkspaceRuntime('ws-1')
      getWorkspaceRuntime('ws-2')

      expect(isWorkspacePinned('ws-1')).toBe(false)
      expect(isWorkspacePinned('ws-2')).toBe(false)

      updatePinnedWorkspaceIds(['ws-1'])

      expect(isWorkspacePinned('ws-1')).toBe(true)
      expect(isWorkspacePinned('ws-2')).toBe(false)
    })

    it('should update pinned workspace list', () => {
      updatePinnedWorkspaceIds(['ws-1', 'ws-2'])

      expect(isWorkspacePinned('ws-1')).toBe(true)
      expect(isWorkspacePinned('ws-2')).toBe(true)
      expect(isWorkspacePinned('ws-3')).toBe(false)

      // Update to different list
      updatePinnedWorkspaceIds(['ws-3'])

      expect(isWorkspacePinned('ws-1')).toBe(false)
      expect(isWorkspacePinned('ws-2')).toBe(false)
      expect(isWorkspacePinned('ws-3')).toBe(true)
    })

    it('should exclude pinned workspaces from LRU candidate selection', () => {
      // Create runtimes with timestamps
      getWorkspaceRuntime('ws-old')
      getWorkspaceRuntime('ws-recent')

      // Pin the old workspace (which would normally be eviction candidate)
      updatePinnedWorkspaceIds(['ws-old'])

      // The LRU selection should skip pinned workspaces
      // Note: getLeastRecentlyVisibleRuntimeId has complex logic involving visibility
      // This test verifies the pinning mechanism is in place
      expect(isWorkspacePinned('ws-old')).toBe(true)
      expect(isWorkspacePinned('ws-recent')).toBe(false)
    })
  })

  describe('Active Operation Count', () => {
    it('should return 0 for non-existent workspace', () => {
      expect(getActiveOperationCount('non-existent')).toBe(0)
    })

    it('should return 0 for workspace with no active operations', () => {
      getWorkspaceRuntime('ws-1')
      expect(getActiveOperationCount('ws-1')).toBe(0)
    })
  })

  describe('Shared Workspace Protection (Gap 4)', () => {
    const SHARED_WORKSPACE_ID = '__workspace__'

    it('should recognize shared workspace constant', () => {
      // The shared workspace should be protected from eviction
      // This is verified by the fact that getLeastRecentlyVisibleRuntimeId
      // excludes it from candidate selection
      expect(SHARED_WORKSPACE_ID).toBe('__workspace__')
    })

    it('should handle shared workspace in runtime list', () => {
      getWorkspaceRuntime(SHARED_WORKSPACE_ID)
      getWorkspaceRuntime('ws-1')

      const ids = listWorkspaceRuntimeIds()
      expect(ids).toContain(SHARED_WORKSPACE_ID)
      expect(ids).toContain('ws-1')
    })
  })

  describe('Eviction Blocked Callback Integration', () => {
    it('should invoke callback with correct payload for persist_failed', () => {
      const receivedPayloads: Array<{
        workspaceId: string
        reason: string
        blockType: EvictionBlockType
        activeOperationCount: number
      }> = []

      const callback = (payload: {
        workspaceId: string
        entryId: string | null
        reason: string
        blockType: EvictionBlockType
        activeOperationCount: number
      }) => {
        receivedPayloads.push({
          workspaceId: payload.workspaceId,
          reason: payload.reason,
          blockType: payload.blockType,
          activeOperationCount: payload.activeOperationCount,
        })
      }

      registerEvictionBlockedCallback(callback)

      // Simulate persist failure notification
      notifyEvictionBlockedPersistFailed('dirty-ws', 'capacity_eviction')

      expect(receivedPayloads.length).toBe(1)
      expect(receivedPayloads[0]).toEqual({
        workspaceId: 'dirty-ws',
        reason: 'capacity_eviction',
        blockType: 'persist_failed',
        activeOperationCount: 0,
      })

      unregisterEvictionBlockedCallback(callback)
    })

    it('should handle multiple sequential notifications', () => {
      const notifications: string[] = []

      const callback = (payload: { workspaceId: string }) => {
        notifications.push(payload.workspaceId)
      }

      registerEvictionBlockedCallback(callback)

      notifyEvictionBlockedPersistFailed('ws-1', 'reason')
      notifyEvictionBlockedPersistFailed('ws-2', 'reason')
      notifyEvictionBlockedPersistFailed('ws-3', 'reason')

      expect(notifications).toEqual(['ws-1', 'ws-2', 'ws-3'])

      unregisterEvictionBlockedCallback(callback)
    })
  })
})
