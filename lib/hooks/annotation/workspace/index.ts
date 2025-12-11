/**
 * Workspace management hooks - re-exports
 *
 * @see docs/proposal/refactor/use-note-workspaces/REFACTORING_PLAN.md
 */

// Types
export * from "./workspace-types"

// Utilities
export * from "./workspace-utils"

// Refs
export { useWorkspaceRefs, type WorkspaceRefs } from "./workspace-refs"

// Membership & Open Notes
export {
  useWorkspaceMembership,
  type UseWorkspaceMembershipOptions,
  type UseWorkspaceMembershipResult,
} from "./use-workspace-membership"

// Panel Snapshots
export {
  useWorkspacePanelSnapshots,
  type UseWorkspacePanelSnapshotsOptions,
  type UseWorkspacePanelSnapshotsResult,
} from "./use-workspace-panel-snapshots"

// Snapshot Management
export {
  useWorkspaceSnapshot,
  type UseWorkspaceSnapshotOptions,
  type UseWorkspaceSnapshotResult,
} from "./use-workspace-snapshot"

// Persistence
export {
  useWorkspacePersistence,
  type UseWorkspacePersistenceOptions,
  type UseWorkspacePersistenceResult,
} from "./use-workspace-persistence"

// Hydration
export {
  useWorkspaceHydration,
  type UseWorkspaceHydrationOptions,
  type UseWorkspaceHydrationResult,
} from "./use-workspace-hydration"
