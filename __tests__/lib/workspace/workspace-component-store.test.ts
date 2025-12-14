/**
 * Workspace Component Store Tests
 *
 * Tests for Phase 1 core store functionality.
 */

import {
  getWorkspaceComponentStore,
  hasWorkspaceComponentStore,
  deleteWorkspaceComponentStore,
  listWorkspaceComponentStoreIds,
} from '@/lib/workspace/workspace-component-store'
import type { DurableComponentState } from '@/lib/workspace/workspace-store-types'

// Mock the debug logger
jest.mock('@/lib/utils/debug-logger', () => ({
  debugLog: jest.fn(),
}))

describe('WorkspaceComponentStore', () => {
  const testWorkspaceId = 'test-workspace-123'

  beforeEach(() => {
    // Clean up any existing stores
    for (const id of listWorkspaceComponentStoreIds()) {
      deleteWorkspaceComponentStore(id)
    }
  })

  afterEach(() => {
    // Clean up
    deleteWorkspaceComponentStore(testWorkspaceId)
  })

  describe('Store Creation and Deletion', () => {
    it('should create a new store when none exists', () => {
      expect(hasWorkspaceComponentStore(testWorkspaceId)).toBe(false)

      const store = getWorkspaceComponentStore(testWorkspaceId)

      expect(store).toBeDefined()
      expect(hasWorkspaceComponentStore(testWorkspaceId)).toBe(true)
    })

    it('should return same store instance on subsequent calls', () => {
      const store1 = getWorkspaceComponentStore(testWorkspaceId)
      const store2 = getWorkspaceComponentStore(testWorkspaceId)

      expect(store1).toBe(store2)
    })

    it('should delete store correctly', () => {
      getWorkspaceComponentStore(testWorkspaceId)
      expect(hasWorkspaceComponentStore(testWorkspaceId)).toBe(true)

      deleteWorkspaceComponentStore(testWorkspaceId)
      expect(hasWorkspaceComponentStore(testWorkspaceId)).toBe(false)
    })

    it('should list all store IDs', () => {
      getWorkspaceComponentStore('workspace-1')
      getWorkspaceComponentStore('workspace-2')
      getWorkspaceComponentStore('workspace-3')

      const ids = listWorkspaceComponentStoreIds()

      expect(ids).toContain('workspace-1')
      expect(ids).toContain('workspace-2')
      expect(ids).toContain('workspace-3')

      // Cleanup
      deleteWorkspaceComponentStore('workspace-1')
      deleteWorkspaceComponentStore('workspace-2')
      deleteWorkspaceComponentStore('workspace-3')
    })
  })

  describe('Component CRUD Operations', () => {
    it('should add and get component', () => {
      const store = getWorkspaceComponentStore(testWorkspaceId)

      const timerComponent: DurableComponentState = {
        type: 'timer',
        schemaVersion: 1,
        position: { x: 100, y: 200 },
        size: { width: 200, height: 100 },
        zIndex: 100,
        state: { minutes: 5, seconds: 0, isRunning: false },
      }

      store.addComponent('timer-1', timerComponent)

      const retrieved = store.getComponent('timer-1')
      expect(retrieved).toBeDefined()
      expect(retrieved?.type).toBe('timer')
      expect(retrieved?.position).toEqual({ x: 100, y: 200 })
      expect(retrieved?.state).toEqual({ minutes: 5, seconds: 0, isRunning: false })
    })

    it('should get component state', () => {
      const store = getWorkspaceComponentStore(testWorkspaceId)

      store.addComponent('calc-1', {
        type: 'calculator',
        position: { x: 0, y: 0 },
        size: null,
        zIndex: 100,
        state: { display: '42', operation: null },
      })

      const state = store.getComponentState<{ display: string }>('calc-1')
      expect(state?.display).toBe('42')
    })

    it('should return null for non-existent component', () => {
      const store = getWorkspaceComponentStore(testWorkspaceId)

      expect(store.getComponent('non-existent')).toBeNull()
      expect(store.getComponentState('non-existent')).toBeNull()
    })

    it('should remove component', () => {
      const store = getWorkspaceComponentStore(testWorkspaceId)

      store.addComponent('timer-1', {
        type: 'timer',
        position: { x: 0, y: 0 },
        size: null,
        zIndex: 100,
        state: {},
      })

      expect(store.getComponent('timer-1')).toBeDefined()

      store.removeComponent('timer-1')

      expect(store.getComponent('timer-1')).toBeNull()
    })

    it('should get all components with IDs', () => {
      const store = getWorkspaceComponentStore(testWorkspaceId)

      store.addComponent('comp-1', {
        type: 'timer',
        position: { x: 0, y: 0 },
        size: null,
        zIndex: 100,
        state: { value: 1 },
      })

      store.addComponent('comp-2', {
        type: 'calculator',
        position: { x: 100, y: 100 },
        size: null,
        zIndex: 101,
        state: { value: 2 },
      })

      const all = store.getAllComponents()

      expect(all).toHaveLength(2)
      expect(all.find((c) => c.id === 'comp-1')).toBeDefined()
      expect(all.find((c) => c.id === 'comp-2')).toBeDefined()
      expect(all.find((c) => c.id === 'comp-1')?.type).toBe('timer')
    })
  })

  describe('State Updates', () => {
    it('should update component state with object patch', () => {
      const store = getWorkspaceComponentStore(testWorkspaceId)

      store.addComponent('timer-1', {
        type: 'timer',
        position: { x: 0, y: 0 },
        size: null,
        zIndex: 100,
        state: { minutes: 5, seconds: 0, isRunning: false },
      })

      store.updateComponentState('timer-1', { seconds: 30 })

      const state = store.getComponentState<{ minutes: number; seconds: number }>('timer-1')
      expect(state?.minutes).toBe(5)
      expect(state?.seconds).toBe(30)
    })

    it('should update component state with functional update', () => {
      const store = getWorkspaceComponentStore(testWorkspaceId)

      store.addComponent('timer-1', {
        type: 'timer',
        position: { x: 0, y: 0 },
        size: null,
        zIndex: 100,
        state: { minutes: 5, seconds: 30 },
      })

      store.updateComponentState<{ seconds: number }>('timer-1', (prev) => ({
        seconds: prev.seconds - 1,
      }))

      const state = store.getComponentState<{ seconds: number }>('timer-1')
      expect(state?.seconds).toBe(29)
    })

    it('should update component position', () => {
      const store = getWorkspaceComponentStore(testWorkspaceId)

      store.addComponent('timer-1', {
        type: 'timer',
        position: { x: 0, y: 0 },
        size: null,
        zIndex: 100,
        state: {},
      })

      store.updateComponentPosition('timer-1', { x: 300, y: 400 })

      expect(store.getComponent('timer-1')?.position).toEqual({ x: 300, y: 400 })
    })

    it('should update component size', () => {
      const store = getWorkspaceComponentStore(testWorkspaceId)

      store.addComponent('timer-1', {
        type: 'timer',
        position: { x: 0, y: 0 },
        size: null,
        zIndex: 100,
        state: {},
      })

      store.updateComponentSize('timer-1', { width: 250, height: 150 })

      expect(store.getComponent('timer-1')?.size).toEqual({ width: 250, height: 150 })
    })

    it('should update component zIndex', () => {
      const store = getWorkspaceComponentStore(testWorkspaceId)

      store.addComponent('timer-1', {
        type: 'timer',
        position: { x: 0, y: 0 },
        size: null,
        zIndex: 100,
        state: {},
      })

      store.updateComponentZIndex('timer-1', 200)

      expect(store.getComponent('timer-1')?.zIndex).toBe(200)
    })
  })

  describe('Dirty Tracking', () => {
    it('should mark components as dirty on add', () => {
      const store = getWorkspaceComponentStore(testWorkspaceId)

      expect(store.hasDirtyState()).toBe(false)

      store.addComponent('timer-1', {
        type: 'timer',
        position: { x: 0, y: 0 },
        size: null,
        zIndex: 100,
        state: {},
      })

      expect(store.hasDirtyState()).toBe(true)
      expect(store.getDirtyIds()).toContain('timer-1')
    })

    it('should mark components as dirty on update', () => {
      const store = getWorkspaceComponentStore(testWorkspaceId)

      store.addComponent('timer-1', {
        type: 'timer',
        position: { x: 0, y: 0 },
        size: null,
        zIndex: 100,
        state: { value: 1 },
      })

      store.clearDirty()
      expect(store.hasDirtyState()).toBe(false)

      store.updateComponentState('timer-1', { value: 2 })

      expect(store.hasDirtyState()).toBe(true)
    })

    it('should clear dirty state', () => {
      const store = getWorkspaceComponentStore(testWorkspaceId)

      store.addComponent('timer-1', {
        type: 'timer',
        position: { x: 0, y: 0 },
        size: null,
        zIndex: 100,
        state: {},
      })

      expect(store.hasDirtyState()).toBe(true)

      store.clearDirty()

      expect(store.hasDirtyState()).toBe(false)
    })
  })

  describe('Active Tracking', () => {
    it('should track active components', () => {
      const store = getWorkspaceComponentStore(testWorkspaceId)

      store.addComponent('timer-1', {
        type: 'timer',
        position: { x: 0, y: 0 },
        size: null,
        zIndex: 100,
        state: {},
      })

      expect(store.hasActiveOperations()).toBe(false)

      store.setActive('timer-1', true)

      expect(store.hasActiveOperations()).toBe(true)
      expect(store.getActiveIds()).toContain('timer-1')

      store.setActive('timer-1', false)

      expect(store.hasActiveOperations()).toBe(false)
    })
  })

  describe('Subscriptions', () => {
    it('should notify subscribers on state change', () => {
      const store = getWorkspaceComponentStore(testWorkspaceId)
      const listener = jest.fn()

      store.subscribe(listener)

      store.addComponent('timer-1', {
        type: 'timer',
        position: { x: 0, y: 0 },
        size: null,
        zIndex: 100,
        state: {},
      })

      expect(listener).toHaveBeenCalled()
    })

    it('should unsubscribe correctly', () => {
      const store = getWorkspaceComponentStore(testWorkspaceId)
      const listener = jest.fn()

      const unsubscribe = store.subscribe(listener)

      store.addComponent('timer-1', {
        type: 'timer',
        position: { x: 0, y: 0 },
        size: null,
        zIndex: 100,
        state: {},
      })

      expect(listener).toHaveBeenCalledTimes(1)

      unsubscribe()

      store.addComponent('timer-2', {
        type: 'timer',
        position: { x: 0, y: 0 },
        size: null,
        zIndex: 100,
        state: {},
      })

      expect(listener).toHaveBeenCalledTimes(1) // Not called again
    })
  })

  describe('Restore', () => {
    it('should restore components from payload (cold)', () => {
      const store = getWorkspaceComponentStore(testWorkspaceId)

      store.restore(
        [
          {
            id: 'timer-1',
            type: 'timer',
            schemaVersion: 1,
            position: { x: 100, y: 200 },
            size: { width: 200, height: 100 },
            zIndex: 100,
            metadata: { minutes: 3, seconds: 45, isRunning: true },
          },
        ],
        { restoreType: 'cold' }
      )

      const component = store.getComponent('timer-1')
      expect(component).toBeDefined()
      expect(component?.position).toEqual({ x: 100, y: 200 })

      // Cold restore should stop running timer
      const state = store.getComponentState<{ isRunning: boolean }>('timer-1')
      expect(state?.isRunning).toBe(false)
    })

    it('should not overwrite on hot restore', () => {
      const store = getWorkspaceComponentStore(testWorkspaceId)

      // Initial cold restore
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

      // Modify state
      store.updateComponentState('timer-1', { minutes: 3, seconds: 30 })

      // Hot restore should NOT overwrite
      store.restore(
        [
          {
            id: 'timer-1',
            type: 'timer',
            metadata: { minutes: 10, seconds: 0 },
          },
        ],
        { restoreType: 'hot' }
      )

      // Should still have modified state
      const state = store.getComponentState<{ minutes: number }>('timer-1')
      expect(state?.minutes).toBe(3)
    })

    it('should set lifecycle to ready after restore', () => {
      const store = getWorkspaceComponentStore(testWorkspaceId)

      expect(store.lifecycle).toBe('uninitialized')

      store.restore([], { restoreType: 'cold' })

      expect(store.lifecycle).toBe('ready')
    })
  })

  describe('Timer Operations (Option B)', () => {
    beforeEach(() => {
      jest.useFakeTimers()
    })

    afterEach(() => {
      jest.useRealTimers()
    })

    it('should start timer operation', () => {
      const store = getWorkspaceComponentStore(testWorkspaceId)

      store.addComponent('timer-1', {
        type: 'timer',
        position: { x: 0, y: 0 },
        size: null,
        zIndex: 100,
        state: { minutes: 0, seconds: 5, isRunning: false },
      })

      store.clearDirty() // Clear dirty from add

      store.startTimerOperation('timer-1')

      const state = store.getComponentState<{ isRunning: boolean }>('timer-1')
      expect(state?.isRunning).toBe(true)
      expect(store.hasActiveOperations()).toBe(true)
    })

    it('should tick timer', () => {
      const store = getWorkspaceComponentStore(testWorkspaceId)

      store.addComponent('timer-1', {
        type: 'timer',
        position: { x: 0, y: 0 },
        size: null,
        zIndex: 100,
        state: { minutes: 0, seconds: 5, isRunning: false },
      })

      store.startTimerOperation('timer-1')

      // Advance 1 second
      jest.advanceTimersByTime(1000)

      const state = store.getComponentState<{ seconds: number }>('timer-1')
      expect(state?.seconds).toBe(4)

      // Advance 2 more seconds
      jest.advanceTimersByTime(2000)

      const state2 = store.getComponentState<{ seconds: number }>('timer-1')
      expect(state2?.seconds).toBe(2)
    })

    it('should stop timer operation', () => {
      const store = getWorkspaceComponentStore(testWorkspaceId)

      store.addComponent('timer-1', {
        type: 'timer',
        position: { x: 0, y: 0 },
        size: null,
        zIndex: 100,
        state: { minutes: 0, seconds: 5, isRunning: false },
      })

      store.startTimerOperation('timer-1')
      expect(store.hasActiveOperations()).toBe(true)

      store.stopTimerOperation('timer-1')
      expect(store.hasActiveOperations()).toBe(false)

      const state = store.getComponentState<{ isRunning: boolean }>('timer-1')
      expect(state?.isRunning).toBe(false)
    })

    it('should stop all operations on store deletion', () => {
      const store = getWorkspaceComponentStore(testWorkspaceId)

      store.addComponent('timer-1', {
        type: 'timer',
        position: { x: 0, y: 0 },
        size: null,
        zIndex: 100,
        state: { minutes: 0, seconds: 10, isRunning: false },
      })

      store.startTimerOperation('timer-1')
      expect(store.hasActiveOperations()).toBe(true)

      deleteWorkspaceComponentStore(testWorkspaceId)

      // Timer should have been stopped (no memory leak)
      // We can verify by getting a new store and checking it's fresh
      const newStore = getWorkspaceComponentStore(testWorkspaceId)
      expect(newStore.hasActiveOperations()).toBe(false)
    })
  })

  describe('Eviction', () => {
    it('should calculate eviction priority based on state', () => {
      const store = getWorkspaceComponentStore(testWorkspaceId)

      // Empty store
      expect(store.getEvictionPriority()).toBe(0)

      // Add component
      store.addComponent('timer-1', {
        type: 'timer',
        position: { x: 0, y: 0 },
        size: null,
        zIndex: 100,
        state: {},
      })

      // Has components (+100)
      expect(store.getEvictionPriority()).toBe(100)

      // Set active (+500)
      store.setActive('timer-1', true)
      expect(store.getEvictionPriority()).toBe(600) // 100 + 500
    })

    it('should prepare for eviction', async () => {
      const store = getWorkspaceComponentStore(testWorkspaceId)

      // Initialize store
      store.restore([], { restoreType: 'cold' })

      const result = await store.prepareForEviction()

      expect(result.canEvict).toBe(true)
    })

    it('should block eviction if not ready', async () => {
      const store = getWorkspaceComponentStore(testWorkspaceId)

      // Store is uninitialized
      const result = await store.prepareForEviction()

      expect(result.canEvict).toBe(false)
      expect(result.reason).toContain('workspace_not_ready')
    })
  })
})
