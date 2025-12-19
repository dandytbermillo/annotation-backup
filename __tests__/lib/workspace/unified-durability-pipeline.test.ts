/**
 * Unified Workspace Durability Pipeline Tests
 *
 * Phase 6 validation tests for the durability pipeline.
 * Tests lifecycle management, dirty tracking with guards, and snapshot building.
 *
 * @see docs/proposal/workspace-state-machine/improvement/2025-12-18-unified-workspace-durability-pipeline.md
 */

import {
  // Lifecycle management
  getWorkspaceLifecycle,
  getWorkspaceLifecycleState,
  isWorkspaceLifecycleReady,
  isWorkspaceRestoring,
  beginWorkspaceRestore,
  completeWorkspaceRestore,
  removeWorkspaceLifecycle,
  getAllWorkspaceLifecycles,
  // Dirty tracking
  shouldAllowDirty,
  shouldAllowComponentDirty,
} from '@/lib/workspace/durability'

import {
  getWorkspaceComponentStore,
  deleteWorkspaceComponentStore,
  listWorkspaceComponentStoreIds,
} from '@/lib/workspace/workspace-component-store'

// Mock the debug logger
jest.mock('@/lib/utils/debug-logger', () => ({
  debugLog: jest.fn().mockResolvedValue(undefined),
}))

describe('Unified Durability Pipeline - Phase 6 Validation', () => {
  const testWorkspaceId = 'test-workspace-durability'

  beforeEach(() => {
    // Clean up lifecycle state
    removeWorkspaceLifecycle(testWorkspaceId)
    // Clean up component stores
    for (const id of listWorkspaceComponentStoreIds()) {
      deleteWorkspaceComponentStore(id)
    }
  })

  afterEach(() => {
    removeWorkspaceLifecycle(testWorkspaceId)
    deleteWorkspaceComponentStore(testWorkspaceId)
  })

  // ===========================================================================
  // Phase 3: Lifecycle Manager Tests
  // ===========================================================================
  describe('Lifecycle Manager (Phase 3)', () => {
    describe('Lifecycle State Transitions', () => {
      it('should start with uninitialized lifecycle', () => {
        expect(getWorkspaceLifecycle(testWorkspaceId)).toBe('uninitialized')
        expect(isWorkspaceLifecycleReady(testWorkspaceId)).toBe(false)
        expect(isWorkspaceRestoring(testWorkspaceId)).toBe(false)
      })

      it('should transition to restoring on beginWorkspaceRestore', () => {
        beginWorkspaceRestore(testWorkspaceId, 'test')

        expect(getWorkspaceLifecycle(testWorkspaceId)).toBe('restoring')
        expect(isWorkspaceLifecycleReady(testWorkspaceId)).toBe(false)
        expect(isWorkspaceRestoring(testWorkspaceId)).toBe(true)
      })

      it('should transition to ready on completeWorkspaceRestore', () => {
        beginWorkspaceRestore(testWorkspaceId, 'test')
        completeWorkspaceRestore(testWorkspaceId, 'test')

        expect(getWorkspaceLifecycle(testWorkspaceId)).toBe('ready')
        expect(isWorkspaceLifecycleReady(testWorkspaceId)).toBe(true)
        expect(isWorkspaceRestoring(testWorkspaceId)).toBe(false)
      })

      it('should clear lifecycle state on removeWorkspaceLifecycle', () => {
        beginWorkspaceRestore(testWorkspaceId, 'test')
        completeWorkspaceRestore(testWorkspaceId, 'test')
        expect(isWorkspaceLifecycleReady(testWorkspaceId)).toBe(true)

        removeWorkspaceLifecycle(testWorkspaceId)

        expect(getWorkspaceLifecycle(testWorkspaceId)).toBe('uninitialized')
        expect(isWorkspaceLifecycleReady(testWorkspaceId)).toBe(false)
      })
    })

    describe('Lifecycle State Metadata', () => {
      it('should track lifecycle state with metadata', () => {
        beginWorkspaceRestore(testWorkspaceId, 'hydrate_workspace')

        const state = getWorkspaceLifecycleState(testWorkspaceId)
        expect(state).not.toBeNull()
        expect(state?.lifecycle).toBe('restoring')
        expect(state?.enteredAt).toBeGreaterThan(0)
      })

      it('should list all workspace lifecycles', () => {
        beginWorkspaceRestore('ws-1', 'test')
        completeWorkspaceRestore('ws-1', 'test')
        beginWorkspaceRestore('ws-2', 'test')

        const all = getAllWorkspaceLifecycles()

        expect(all.get('ws-1')?.lifecycle).toBe('ready')
        expect(all.get('ws-2')?.lifecycle).toBe('restoring')

        // Cleanup
        removeWorkspaceLifecycle('ws-1')
        removeWorkspaceLifecycle('ws-2')
      })
    })

    describe('Error Recovery', () => {
      it('should allow removeWorkspaceLifecycle during restoring (error recovery)', () => {
        beginWorkspaceRestore(testWorkspaceId, 'test')
        expect(isWorkspaceRestoring(testWorkspaceId)).toBe(true)

        // Simulate error - remove lifecycle to allow retry
        removeWorkspaceLifecycle(testWorkspaceId)

        expect(getWorkspaceLifecycle(testWorkspaceId)).toBe('uninitialized')
        // Should be able to start fresh
        beginWorkspaceRestore(testWorkspaceId, 'retry')
        expect(isWorkspaceRestoring(testWorkspaceId)).toBe(true)
      })
    })
  })

  // ===========================================================================
  // Phase 4: Dirty Tracking with Lifecycle Guards
  // ===========================================================================
  describe('Dirty Tracking Guards (Phase 4)', () => {
    describe('shouldAllowDirty', () => {
      it('should return false when lifecycle is uninitialized', () => {
        expect(shouldAllowDirty(testWorkspaceId)).toBe(false)
      })

      it('should return false when lifecycle is restoring', () => {
        beginWorkspaceRestore(testWorkspaceId, 'test')

        expect(shouldAllowDirty(testWorkspaceId)).toBe(false)
      })

      it('should return true when lifecycle is ready', () => {
        beginWorkspaceRestore(testWorkspaceId, 'test')
        completeWorkspaceRestore(testWorkspaceId, 'test')

        expect(shouldAllowDirty(testWorkspaceId)).toBe(true)
      })

      it('should return false after lifecycle is removed', () => {
        beginWorkspaceRestore(testWorkspaceId, 'test')
        completeWorkspaceRestore(testWorkspaceId, 'test')
        expect(shouldAllowDirty(testWorkspaceId)).toBe(true)

        removeWorkspaceLifecycle(testWorkspaceId)

        expect(shouldAllowDirty(testWorkspaceId)).toBe(false)
      })
    })

    describe('shouldAllowComponentDirty', () => {
      it('should return same result as shouldAllowDirty', () => {
        expect(shouldAllowComponentDirty(testWorkspaceId)).toBe(shouldAllowDirty(testWorkspaceId))

        beginWorkspaceRestore(testWorkspaceId, 'test')
        expect(shouldAllowComponentDirty(testWorkspaceId)).toBe(shouldAllowDirty(testWorkspaceId))

        completeWorkspaceRestore(testWorkspaceId, 'test')
        expect(shouldAllowComponentDirty(testWorkspaceId)).toBe(shouldAllowDirty(testWorkspaceId))
      })
    })
  })

  // ===========================================================================
  // Phase 4: Component Store Dirty Guards
  // ===========================================================================
  describe('Component Store Dirty Guards (Phase 4)', () => {
    it('should NOT mark dirty when lifecycle is not ready', () => {
      const store = getWorkspaceComponentStore(testWorkspaceId)

      // Lifecycle is uninitialized - dirty should be blocked
      store.addComponent('comp-1', {
        type: 'timer',
        position: { x: 0, y: 0 },
        size: null,
        zIndex: 100,
        state: { value: 1 },
      })

      // Component is added but NOT marked dirty (lifecycle not ready)
      expect(store.getComponent('comp-1')).toBeDefined()
      expect(store.hasDirtyState()).toBe(false) // Guard blocked dirty
    })

    it('should mark dirty when lifecycle is ready', () => {
      // Set lifecycle to ready first
      beginWorkspaceRestore(testWorkspaceId, 'test')
      completeWorkspaceRestore(testWorkspaceId, 'test')

      const store = getWorkspaceComponentStore(testWorkspaceId)

      store.addComponent('comp-1', {
        type: 'timer',
        position: { x: 0, y: 0 },
        size: null,
        zIndex: 100,
        state: { value: 1 },
      })

      expect(store.hasDirtyState()).toBe(true) // Dirty allowed when ready
      expect(store.getDirtyIds()).toContain('comp-1')
    })

    it('should NOT mark dirty during restore even when modifying state', () => {
      beginWorkspaceRestore(testWorkspaceId, 'test')
      // Lifecycle is 'restoring' - NOT ready

      const store = getWorkspaceComponentStore(testWorkspaceId)

      // Simulate component being added during restore
      store.addComponent('comp-1', {
        type: 'timer',
        position: { x: 0, y: 0 },
        size: null,
        zIndex: 100,
        state: { value: 1 },
      })

      // Dirty should be blocked
      expect(store.hasDirtyState()).toBe(false)

      // Now complete restore
      completeWorkspaceRestore(testWorkspaceId, 'test')

      // Now mutations should mark dirty
      store.updateComponentState('comp-1', { value: 2 })
      expect(store.hasDirtyState()).toBe(true)
    })

    it('should guard all mutation methods', () => {
      const store = getWorkspaceComponentStore(testWorkspaceId)

      // Add component (lifecycle not ready)
      store.addComponent('comp-1', {
        type: 'timer',
        position: { x: 0, y: 0 },
        size: { width: 100, height: 100 },
        zIndex: 100,
        state: { value: 1 },
      })
      expect(store.hasDirtyState()).toBe(false)

      // All mutations should be blocked from setting dirty
      store.updateComponentState('comp-1', { value: 2 })
      expect(store.hasDirtyState()).toBe(false)

      store.updateComponentPosition('comp-1', { x: 50, y: 50 })
      expect(store.hasDirtyState()).toBe(false)

      store.updateComponentSize('comp-1', { width: 200, height: 200 })
      expect(store.hasDirtyState()).toBe(false)

      store.updateComponentZIndex('comp-1', 200)
      expect(store.hasDirtyState()).toBe(false)

      store.removeComponent('comp-1')
      expect(store.hasDirtyState()).toBe(false)
    })
  })

  // ===========================================================================
  // Phase 3 + 4: Cold Restore Scenario
  // ===========================================================================
  describe('Cold Restore Scenario (Phase 3 + 4)', () => {
    it('should complete full cold restore cycle without false dirty', () => {
      // Step 1: Begin restore
      beginWorkspaceRestore(testWorkspaceId, 'hydrate_workspace')
      expect(isWorkspaceRestoring(testWorkspaceId)).toBe(true)
      expect(shouldAllowDirty(testWorkspaceId)).toBe(false)

      // Step 2: Restore component store
      const store = getWorkspaceComponentStore(testWorkspaceId)
      store.restore(
        [
          {
            id: 'timer-1',
            type: 'timer',
            metadata: { minutes: 5, seconds: 0, isRunning: false },
          },
        ],
        { restoreType: 'cold' }
      )

      // Step 3: Store is restored but durability lifecycle not yet complete
      expect(store.lifecycle).toBe('ready') // Store lifecycle
      expect(isWorkspaceLifecycleReady(testWorkspaceId)).toBe(false) // Durability lifecycle
      expect(store.hasDirtyState()).toBe(false) // Should NOT be dirty

      // Step 4: Complete durability lifecycle
      completeWorkspaceRestore(testWorkspaceId, 'hydrate_workspace')
      expect(isWorkspaceLifecycleReady(testWorkspaceId)).toBe(true)

      // Step 5: Now mutations should mark dirty
      store.updateComponentState('timer-1', { minutes: 4 })
      expect(store.hasDirtyState()).toBe(true)
    })

    it('should stop running operations on cold restore', () => {
      beginWorkspaceRestore(testWorkspaceId, 'test')

      const store = getWorkspaceComponentStore(testWorkspaceId)
      store.restore(
        [
          {
            id: 'timer-1',
            type: 'timer',
            metadata: { minutes: 5, seconds: 0, isRunning: true }, // Was running
          },
        ],
        { restoreType: 'cold' }
      )

      // Cold restore should deactivate running components
      const state = store.getComponentState<{ isRunning: boolean }>('timer-1')
      expect(state?.isRunning).toBe(false)
      expect(store.hasActiveOperations()).toBe(false)
    })
  })

  // ===========================================================================
  // Phase 3: Hot Restore Scenario
  // ===========================================================================
  describe('Hot Restore Scenario (Phase 3)', () => {
    it('should preserve existing state on hot restore', () => {
      // Initial cold restore
      beginWorkspaceRestore(testWorkspaceId, 'initial')
      const store = getWorkspaceComponentStore(testWorkspaceId)
      store.restore(
        [
          {
            id: 'timer-1',
            type: 'timer',
            metadata: { minutes: 5, seconds: 0 },
          },
        ],
        { restoreType: 'cold' }
      )
      completeWorkspaceRestore(testWorkspaceId, 'initial')

      // Modify state
      store.updateComponentState('timer-1', { minutes: 3, seconds: 30 })
      store.clearDirty() // Assume persisted

      // Hot restore should NOT overwrite
      store.restore(
        [
          {
            id: 'timer-1',
            type: 'timer',
            metadata: { minutes: 10, seconds: 0 }, // Different value
          },
        ],
        { restoreType: 'hot' }
      )

      // Should still have modified state
      const state = store.getComponentState<{ minutes: number; seconds: number }>('timer-1')
      expect(state?.minutes).toBe(3)
      expect(state?.seconds).toBe(30)
    })

    it('should skip hydration when lifecycle is already ready', () => {
      // First complete restore
      beginWorkspaceRestore(testWorkspaceId, 'initial')
      completeWorkspaceRestore(testWorkspaceId, 'initial')

      // Should be ready
      expect(isWorkspaceLifecycleReady(testWorkspaceId)).toBe(true)

      // Hot restore check - lifecycle is ready, so hydration should be skipped
      // (This would be checked in the actual hydration hook)
    })
  })

  // ===========================================================================
  // Entry Re-entry Scenario (Gap 4 from Phase 0)
  // ===========================================================================
  describe('Entry Re-entry Scenario (Gap 4)', () => {
    it('should block dirty during entry re-entry window', () => {
      // Scenario: User switches entry, component remounts, useEffect fires before hydration

      // Step 1: Previous session completed (lifecycle ready)
      beginWorkspaceRestore(testWorkspaceId, 'previous')
      completeWorkspaceRestore(testWorkspaceId, 'previous')
      const store = getWorkspaceComponentStore(testWorkspaceId)
      store.restore(
        [{ id: 'comp-1', type: 'timer', metadata: { value: 1 } }],
        { restoreType: 'cold' }
      )

      // Step 2: User switches entry - lifecycle is cleared (eviction)
      removeWorkspaceLifecycle(testWorkspaceId)
      deleteWorkspaceComponentStore(testWorkspaceId)

      // Step 3: User returns to entry - component remounts
      // Before hydration starts, lifecycle is uninitialized
      expect(isWorkspaceLifecycleReady(testWorkspaceId)).toBe(false)

      // Step 4: Component useEffect fires (trying to scheduleSave)
      // shouldAllowDirty should return false
      expect(shouldAllowDirty(testWorkspaceId)).toBe(false)

      // Step 5: Hydration starts
      beginWorkspaceRestore(testWorkspaceId, 'hydrate')
      expect(shouldAllowDirty(testWorkspaceId)).toBe(false)

      // Step 6: Hydration completes
      completeWorkspaceRestore(testWorkspaceId, 'hydrate')
      expect(shouldAllowDirty(testWorkspaceId)).toBe(true)
    })
  })

  // ===========================================================================
  // Multi-Workspace Lifecycle Independence
  // ===========================================================================
  describe('Multi-Workspace Independence', () => {
    it('should track lifecycle independently per workspace', () => {
      beginWorkspaceRestore('ws-1', 'test')
      completeWorkspaceRestore('ws-1', 'test')

      beginWorkspaceRestore('ws-2', 'test')
      // ws-2 still restoring

      expect(isWorkspaceLifecycleReady('ws-1')).toBe(true)
      expect(isWorkspaceLifecycleReady('ws-2')).toBe(false)

      expect(shouldAllowDirty('ws-1')).toBe(true)
      expect(shouldAllowDirty('ws-2')).toBe(false)

      // Cleanup
      removeWorkspaceLifecycle('ws-1')
      removeWorkspaceLifecycle('ws-2')
    })

    it('should allow different workspaces at different lifecycle stages', () => {
      // ws-1: ready
      beginWorkspaceRestore('ws-1', 'test')
      completeWorkspaceRestore('ws-1', 'test')

      // ws-2: restoring
      beginWorkspaceRestore('ws-2', 'test')

      // ws-3: uninitialized (never started)

      expect(getWorkspaceLifecycle('ws-1')).toBe('ready')
      expect(getWorkspaceLifecycle('ws-2')).toBe('restoring')
      expect(getWorkspaceLifecycle('ws-3')).toBe('uninitialized')

      // Cleanup
      removeWorkspaceLifecycle('ws-1')
      removeWorkspaceLifecycle('ws-2')
    })
  })
})
