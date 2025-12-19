/**
 * Unified Workspace Durability Pipeline - Type Definitions
 *
 * This module defines the contracts for the unified durability boundary.
 * All durable workspace state (notes/panels + components) travels through
 * this single boundary for save and restore operations.
 *
 * @see docs/proposal/workspace-state-machine/improvement/2025-12-18-unified-workspace-durability-pipeline.md
 */

import type {
  NoteWorkspacePayload,
  NoteWorkspacePanelSnapshot,
  NoteWorkspaceComponentSnapshot,
  NoteWorkspaceCamera,
} from '@/lib/types/note-workspace'

// =============================================================================
// Workspace Lifecycle State
// =============================================================================

/**
 * Unified lifecycle state for workspace durability.
 * Applies to the WHOLE workspace (notes/panels + components together).
 */
export type WorkspaceDurabilityLifecycle =
  | 'uninitialized'  // Workspace created but not yet loaded
  | 'restoring'      // Loading from DB, persistence blocked
  | 'ready'          // Fully restored, safe to persist/evict
  | 'persisting'     // Currently persisting, reads allowed
  | 'degraded'       // Persistent failures, cold opens blocked

/**
 * Workspace lifecycle state with metadata.
 */
export interface WorkspaceLifecycleState {
  lifecycle: WorkspaceDurabilityLifecycle
  /** Timestamp when current lifecycle state began */
  enteredAt: number
  /** For 'degraded': consecutive failure count */
  failureCount?: number
  /** For 'degraded': timestamp when degraded mode started */
  degradedSince?: number
}

// =============================================================================
// Durable Snapshot Contract
// =============================================================================

/**
 * Open note entry for persistence.
 * Represents a note that is open in the workspace.
 */
export interface DurableOpenNote {
  noteId: string
  /** Position of the main panel for this note (if known) */
  position?: { x: number; y: number } | null
}

/**
 * Unified durable snapshot for a workspace.
 * This is the complete durable state that gets persisted/restored.
 *
 * Notes/Panels and Components are separate sub-objects but travel together
 * through the same save/restore timing rules.
 */
export interface WorkspaceDurableSnapshot {
  /** Schema version for migration support */
  schemaVersion: '1.1.0'

  // --- Notes/Panels Domain ---
  /** Notes currently open in the workspace */
  openNotes: DurableOpenNote[]
  /** Currently active (focused) note ID */
  activeNoteId: string | null
  /** Panel snapshots for all open notes */
  panels: NoteWorkspacePanelSnapshot[]
  /** Camera position and zoom */
  camera: NoteWorkspaceCamera

  // --- Components Domain ---
  /** Standalone components (timers, calculators, etc.) */
  components: NoteWorkspaceComponentSnapshot[]
}

/**
 * Result of capturing a durable snapshot.
 */
export interface SnapshotCaptureResult {
  /** Whether capture was successful */
  success: boolean
  /** The captured snapshot (if successful) */
  snapshot?: WorkspaceDurableSnapshot
  /** Source of notes/panels data */
  notesPanelsSource: 'active' | 'cached' | 'runtime'
  /** Source of components data */
  componentsSource: 'store' | 'runtime_ledger' | 'cached'
  /** If capture failed or was deferred, why */
  skipReason?: SnapshotSkipReason
}

/**
 * Reasons why snapshot capture might be skipped or deferred.
 */
export type SnapshotSkipReason =
  | 'lifecycle_not_ready'      // Workspace not in 'ready' state
  | 'hydrating'                // Hydration in progress
  | 'transient_mismatch'       // Panels exist but openNotes empty (or vice versa)
  | 'revision_unknown'         // Revision not loaded, would fail precondition
  | 'no_adapter'               // Persistence adapter not available
  | 'empty_after_load'         // Would persist empty state immediately after load

// =============================================================================
// Guard Policy
// =============================================================================

/**
 * Result of guard check before persistence.
 */
export interface GuardCheckResult {
  /** Whether persistence is allowed */
  allowed: boolean
  /** If not allowed, why */
  reason?: SnapshotSkipReason
  /** If transient mismatch, details for debugging */
  mismatchDetails?: {
    openNotesCount: number
    panelsCount: number
    componentsCount: number
    hasRuntime: boolean
  }
}

/**
 * Options for guard checking.
 */
export interface GuardCheckOptions {
  /** Workspace ID */
  workspaceId: string
  /** The snapshot to validate */
  snapshot: WorkspaceDurableSnapshot
  /** Current lifecycle state */
  lifecycle: WorkspaceDurabilityLifecycle
  /** Whether revision is known for this workspace */
  revisionKnown: boolean
  /** Whether workspace was just loaded (recently hydrated) */
  recentlyHydrated: boolean
  /** Runtime info for fallback validation */
  runtimeInfo?: {
    hasRuntime: boolean
    runtimeOpenNotesCount: number
    runtimeMembershipCount: number
  }
}

// =============================================================================
// Unified Dirty Model
// =============================================================================

/**
 * Unified dirty state for a workspace.
 * Aggregates dirty status from all durable domains.
 */
export interface WorkspaceDirtyState {
  /** Whether any domain has unsaved changes */
  isDirty: boolean
  /** Timestamp when workspace became dirty (earliest across domains) */
  dirtyAt: number | null

  // Per-domain breakdown (for debugging/logging)
  notesPanelsDirty: boolean
  notesPanelsDirtyAt: number | null
  componentsDirty: boolean
  componentsDirtyIds: string[]
}

// =============================================================================
// Persistence Result
// =============================================================================

/**
 * Result of a unified persistence operation.
 */
export interface UnifiedPersistResult {
  /** Whether persistence succeeded */
  success: boolean
  /** New revision after successful persist */
  revision?: string
  /** If failed, the error */
  error?: string
  /** What was persisted */
  persisted?: {
    openNotesCount: number
    panelsCount: number
    componentsCount: number
  }
  /** If persistence was skipped, why */
  skipped?: SnapshotSkipReason
}

// =============================================================================
// Type Guards and Utilities
// =============================================================================

/**
 * Check if a snapshot is "obviously inconsistent" (likely transient state).
 *
 * Inconsistent states:
 * - Panels exist but openNotes is empty
 * - Components exist but nothing else does
 */
export function isSnapshotInconsistent(snapshot: WorkspaceDurableSnapshot): boolean {
  const hasOpenNotes = snapshot.openNotes.length > 0
  const hasPanels = snapshot.panels.length > 0
  const hasComponents = snapshot.components.length > 0

  // Panels without openNotes = transient (panels derive from notes)
  if (hasPanels && !hasOpenNotes) {
    return true
  }

  // Components alone is valid (default workspace can have only components)
  // So we don't flag that as inconsistent

  return false
}

/**
 * Convert unified snapshot to legacy NoteWorkspacePayload.
 * Used during transition period while both formats coexist.
 */
export function toNoteWorkspacePayload(snapshot: WorkspaceDurableSnapshot): NoteWorkspacePayload {
  const payload: NoteWorkspacePayload = {
    schemaVersion: snapshot.schemaVersion,
    openNotes: snapshot.openNotes.map(note => ({
      noteId: note.noteId,
      position: note.position ?? null,
    })),
    activeNoteId: snapshot.activeNoteId,
    camera: snapshot.camera,
    panels: snapshot.panels,
  }

  if (snapshot.components.length > 0) {
    payload.components = snapshot.components
  }

  return payload
}

/**
 * Convert legacy NoteWorkspacePayload to unified snapshot.
 */
export function fromNoteWorkspacePayload(payload: NoteWorkspacePayload): WorkspaceDurableSnapshot {
  return {
    schemaVersion: payload.schemaVersion,
    openNotes: payload.openNotes.map(note => ({
      noteId: note.noteId,
      position: note.position ?? null,
    })),
    activeNoteId: payload.activeNoteId,
    camera: payload.camera,
    panels: payload.panels,
    components: payload.components ?? [],
  }
}

/**
 * Create an empty snapshot (for initialization).
 */
export function createEmptySnapshot(): WorkspaceDurableSnapshot {
  return {
    schemaVersion: '1.1.0',
    openNotes: [],
    activeNoteId: null,
    panels: [],
    camera: { x: 0, y: 0, scale: 1 },
    components: [],
  }
}
