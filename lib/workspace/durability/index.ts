/**
 * Unified Workspace Durability Pipeline
 *
 * Single boundary for all workspace save/restore operations.
 * Ensures notes/panels and components travel together through
 * the same timing rules and guards.
 *
 * @see docs/proposal/workspace-state-machine/improvement/2025-12-18-unified-workspace-durability-pipeline.md
 */

// Types
export type {
  WorkspaceDurabilityLifecycle,
  WorkspaceLifecycleState,
  DurableOpenNote,
  WorkspaceDurableSnapshot,
  SnapshotCaptureResult,
  SnapshotSkipReason,
  GuardCheckResult,
  GuardCheckOptions,
  WorkspaceDirtyState,
  UnifiedPersistResult,
} from './types'

// Type utilities
export {
  isSnapshotInconsistent,
  toNoteWorkspacePayload,
  fromNoteWorkspacePayload,
  createEmptySnapshot,
} from './types'

// Snapshot builder
export type {
  NotesPanelsSource,
  BuildSnapshotOptions,
} from './snapshot-builder'

export {
  buildUnifiedSnapshot,
  hasAnyDurableContent,
} from './snapshot-builder'

// Guards
export type {
  GuardPolicyConfig,
} from './guards'

export {
  checkPersistGuards,
  shouldRetryPersist,
  shouldEnterDegradedMode,
  createRuntimeInfo,
} from './guards'

// Dirty tracking
export type {
  WorkspaceDirtyRef,
} from './dirty-tracking'

export {
  isWorkspaceDirty,
  getWorkspaceDirtyState,
  clearWorkspaceDirty,
  getAllDirtyWorkspaceIds,
  // Phase 4: Lifecycle-aware dirty guard
  shouldAllowDirty,
  setWorkspaceDirtyIfAllowed,
  shouldAllowComponentDirty,
} from './dirty-tracking'

// Lifecycle management
export {
  getWorkspaceLifecycle,
  getWorkspaceLifecycleState,
  isWorkspaceLifecycleReady,
  isWorkspaceRestoring,
  isWorkspaceInDegradedMode,
  setWorkspaceLifecycle,
  beginWorkspaceRestore,
  completeWorkspaceRestore,
  beginWorkspacePersist,
  completeWorkspacePersist,
  enterDegradedMode,
  exitDegradedMode,
  removeWorkspaceLifecycle,
  getWorkspacesByLifecycle,
  getAllWorkspaceLifecycles,
} from './lifecycle-manager'
