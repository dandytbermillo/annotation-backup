/**
 * Workspace Component Store - Type Definitions
 *
 * Part of the Workspace State Machine architecture.
 * See: docs/proposal/workspace-state-machine/IMPLEMENTATION_PLAN.md
 *
 * Key concepts:
 * - DurableComponentState: Persisted to DB, survives eviction/reload
 * - WorkspaceRuntimeState: In-memory only, tracks active/dirty state
 * - WorkspaceLifecycle: Gates operations (no persist until ready, etc.)
 * - StateUpdate: Supports both object patch and functional updates
 */

// =============================================================================
// Durable State (persisted to DB)
// =============================================================================

/**
 * Durable component state - persisted to DB.
 * This is what gets saved and restored across sessions.
 */
export interface DurableComponentState {
  /** Component type identifier (e.g., 'timer', 'calculator', 'sticky-note') */
  type: string

  /** Schema version for forward-only migrations (defaults to 1 if missing) */
  schemaVersion?: number

  /** Position in workspace coordinates */
  position: { x: number; y: number }

  /** Size (null for auto-sized components) */
  size: { width: number; height: number } | null

  /** Z-index for layering */
  zIndex: number

  /** Component-specific state (Timer: minutes/seconds, Calculator: display, etc.) */
  state: Record<string, unknown>
}

// =============================================================================
// Runtime State (not persisted)
// =============================================================================

/**
 * Runtime-only tracking - never persisted.
 * Tracks which components are active/dirty for eviction decisions.
 */
export interface WorkspaceRuntimeState {
  /** Components with active background operations (e.g., running timer) */
  activeIds: Set<string>

  /** Components changed since last persist */
  dirtyIds: Set<string>

  /** Timestamp of last successful persist */
  lastPersistedAt: number
}

// =============================================================================
// Lifecycle & Health
// =============================================================================

/**
 * Store lifecycle states - gates operations correctly.
 *
 * Transitions:
 *   uninitialized → restoring → ready ↔ persisting
 *                      ↓           ↓
 *                    error       error
 */
export type WorkspaceLifecycle =
  | 'uninitialized'  // Store created but no data loaded
  | 'restoring'      // Loading state from DB (in-flight)
  | 'ready'          // Normal operation, can accept updates and persist
  | 'persisting'     // Persist in progress (can still accept updates)
  | 'error'          // Something failed (persist error, restore error)

/**
 * Persist health state - drives degraded-mode UI and backpressure.
 */
export type PersistHealth =
  | 'healthy'     // Recent success
  | 'retrying'    // Transient failures, backoff active
  | 'degraded'    // Failure threshold exceeded
  | 'recovering'  // First success after degraded

/**
 * Persist concurrency and health tracking (runtime-only).
 */
export interface PersistState {
  /** Is a persist currently running? */
  inFlight: boolean

  /** Joinable promise for flushNow/eviction coordination */
  inFlightPromise: Promise<void> | null

  /** Components changed during current persist (need re-persist) */
  pendingChanges: Set<string>

  /** Monotonically increasing revision for DB idempotency */
  revision: number

  /** Last error message (null if healthy) */
  lastError: string | null

  /** Consecutive retry count */
  retryCount: number

  /** Current health state */
  health: PersistHealth

  /** When degraded mode started (null if healthy) */
  degradedSince: number | null
}

// =============================================================================
// Persistence Scheduler
// =============================================================================

/**
 * Debounced persistence controller.
 * Event-driven, not interval-based.
 */
export interface PersistScheduler {
  /** Schedule a debounced persist (batches rapid changes) */
  scheduleDebounced(): void

  /** Cancel any pending debounced persist */
  cancelDebounced(): void

  /** Flush immediately - used on switch/evict/unload */
  flushNow(): Promise<void>
}

// =============================================================================
// State Updates
// =============================================================================

/**
 * State update - can be object patch OR functional update.
 *
 * Examples:
 *   Object patch: { seconds: 5 }
 *   Functional:   (prev) => ({ seconds: prev.seconds - 1 })
 */
export type StateUpdate<T = Record<string, unknown>> =
  | Partial<T>                    // Object patch
  | ((prev: T) => Partial<T>)     // Functional update

// =============================================================================
// Store Interface
// =============================================================================

/**
 * Full workspace component store state.
 */
export interface WorkspaceComponentStore {
  // Durable (persisted)
  readonly components: Map<string, DurableComponentState>

  // Lifecycle gating
  readonly lifecycle: WorkspaceLifecycle

  // Runtime (not persisted)
  readonly runtime: WorkspaceRuntimeState

  // Persist state/health
  readonly persistState: PersistState

  // Persistence scheduler
  readonly persistScheduler: PersistScheduler

  // Subscribers (internal)
  readonly listeners: Set<() => void>
}

/**
 * Store actions interface.
 */
export interface WorkspaceStoreActions {
  // === Read ===

  /** Get component-specific state by ID */
  getComponentState<T = Record<string, unknown>>(componentId: string): T | null

  /** Get full component (including position, size, zIndex) */
  getComponent(componentId: string): DurableComponentState | null

  /** Get all components with their IDs (needed for persistence) */
  getAllComponents(): Array<{ id: string } & DurableComponentState>

  // === Write ===

  /** Update component state (supports both object patch and functional update) */
  updateComponentState<T = Record<string, unknown>>(
    componentId: string,
    update: StateUpdate<T>
  ): void

  /** Update component position */
  updateComponentPosition(componentId: string, position: { x: number; y: number }): void

  /** Update component size */
  updateComponentSize(componentId: string, size: { width: number; height: number } | null): void

  /** Update component z-index */
  updateComponentZIndex(componentId: string, zIndex: number): void

  /** Add a new component */
  addComponent(componentId: string, component: DurableComponentState): void

  /** Remove a component */
  removeComponent(componentId: string): void

  // === Active Tracking ===

  /** Mark component as active/inactive (has background operation) */
  setActive(componentId: string, active: boolean): void

  /** Check if any components have active operations */
  hasActiveOperations(): boolean

  /** Get list of active component IDs */
  getActiveIds(): string[]

  // === Dirty Tracking ===

  /** Check if any components have unsaved changes */
  hasDirtyState(): boolean

  /** Get list of dirty component IDs */
  getDirtyIds(): string[]

  /** Clear dirty flags (called after successful persist) */
  clearDirty(): void

  // === Persistence ===

  /** Set the persistence callback (called by persistence layer) */
  setPersistCallback(
    cb: (
      components: Array<{ id: string } & DurableComponentState>,
      meta: { revision: number }
    ) => Promise<void>
  ): void

  /** Persist dirty state to DB */
  persist(): Promise<void>

  /** Restore state from DB payload */
  restore(
    components: Array<{
      id: string
      type: string
      schemaVersion?: number
      position?: { x: number; y: number } | null
      size?: { width: number; height: number } | null
      zIndex?: number
      metadata?: Record<string, unknown> | null
    }>,
    options?: { restoreType: 'hot' | 'cold'; baseRevision?: number }
  ): void

  // === Eviction ===

  /** Get eviction priority score (higher = less likely to evict) */
  getEvictionPriority(): number

  /** Prepare for eviction (persists dirty state) */
  prepareForEviction(): Promise<{ canEvict: boolean; reason?: string }>

  // === Headless Operations (Option B) ===

  /** Start timer operation (interval runs in store, not component) */
  startTimerOperation(componentId: string): void

  /** Stop timer operation */
  stopTimerOperation(componentId: string): void

  /** Stop all active operations (called before store deletion) */
  stopAllOperations(): void

  // === Subscriptions ===

  /** Subscribe to store changes */
  subscribe(listener: () => void): () => void

  /** Get current store snapshot */
  getSnapshot(): WorkspaceComponentStore
}

// =============================================================================
// Component Type Registry Types
// =============================================================================

/**
 * Component type registry entry - defines schema, validation, migration
 * for a specific component type.
 */
export interface ComponentTypeRegistryEntry {
  /** Component type identifier */
  type: string

  /** Current schema version */
  schemaVersion: number

  /** Default state for new components */
  defaultState: Record<string, unknown>

  /** Validate state, return corrected state or throw */
  validate(state: Record<string, unknown>): Record<string, unknown>

  /** Migrate from older schema version to current */
  migrate(fromVersion: number, state: Record<string, unknown>): Record<string, unknown>

  /** Apply cold restore invariant (e.g., stop running timers) */
  applyColdRestoreInvariant?(state: Record<string, unknown>): Record<string, unknown>
}

/**
 * Component type registry - manages all component type definitions.
 */
export interface ComponentTypeRegistry {
  /** Register a component type */
  register(entry: ComponentTypeRegistryEntry): void

  /** Get registry entry for a component type */
  get(type: string): ComponentTypeRegistryEntry | undefined

  /** Check if a component type is registered */
  has(type: string): boolean

  /** Get all registered types */
  getTypes(): string[]
}
