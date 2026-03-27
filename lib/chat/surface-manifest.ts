/**
 * Shared Surface Manifest — Phase B
 *
 * Shared base contract for built-in non-note surfaces (panels, widgets).
 * Each surface type registers a manifest entry describing its identity,
 * supported commands, and execution/replay/clarification policies.
 *
 * This module does NOT:
 * - Replace PanelChatManifest (panel-registry-specific contract)
 * - Replace NoteCommandManifestEntry (specialized sibling for notes)
 * - Wire any runtime routing or execution behavior (Phase E)
 *
 * Phase C will create concrete manifest definitions.
 * Phase E will wire resolvers/executors that produce ResolvedSurfaceCommand.
 */

// =============================================================================
// Surface Identity
// =============================================================================

export type SurfaceContainerType = 'dashboard' | 'workspace'
export type SurfaceInstanceType = 'singleton' | 'multi_instance'

// =============================================================================
// Instance Selector (for duplicate-family surfaces like links panel A/B/C)
// =============================================================================

export interface SurfaceInstanceSelector {
  selectorMode: 'none' | 'instance_label' | 'duplicate_family' | 'either'
  requireSpecificInstance?: boolean
}

// =============================================================================
// Policy Enums
//
// Aligned with note manifest vocabulary where applicable for built-in
// non-note surfaces. Note-specific policies (e.g., clarify_target_workspace)
// are omitted here — they remain in the note manifest sibling contract.
// =============================================================================

export type SurfaceExecutionPolicy =
  | 'open_surface'
  | 'focus_surface'
  | 'list_items'
  | 'execute_item'
  | 'state_info'
  | 'bounded_answer'

export type SurfaceReplayPolicy =
  | 'cache_resolution_only'
  | 'safe_with_revalidation'
  | 'never_direct_replay'

export type SurfaceClarificationPolicy =
  | 'clarify_on_ambiguous_target'
  | 'clarify_on_low_confidence'
  | 'no_clarification'

// =============================================================================
// Command Entry
// =============================================================================

export interface SurfaceCommandEntry {
  intentFamily: string
  intentSubtype: string
  examples: string[]
  requiredArguments?: string[]
  requiredContext?: string[]
  executionPolicy: SurfaceExecutionPolicy
  replayPolicy: SurfaceReplayPolicy
  clarificationPolicy: SurfaceClarificationPolicy
  safetyRules: string[]
}

// =============================================================================
// Manifest Entry
// =============================================================================

export interface SurfaceManifestEntry {
  surfaceId: string
  surfaceType: string          // extensible — not a union, registered per surface
  containerType: SurfaceContainerType
  surfaceInstanceType: SurfaceInstanceType
  instanceSelector?: SurfaceInstanceSelector
  manifestVersion: string
  handlerId: string
  supportedCommands: SurfaceCommandEntry[]
}

// =============================================================================
// Runtime Surface Context
//
// Live bounded context for resolvers/executors at dispatch time.
// Not stored — built fresh each turn from uiContext.
// =============================================================================

export interface SurfaceRuntimeContext {
  containerType: SurfaceContainerType
  activeWorkspaceId?: string
  activeEntryId?: string
  visibleSurfaceIds: string[]
  visibleSurfaceTypes: string[]
  duplicateFamilies: Record<string, string[]>
}

// =============================================================================
// Resolved Surface Command (output of future resolver)
// =============================================================================

export interface ResolvedSurfaceCommand {
  surfaceType: string
  containerType: SurfaceContainerType
  manifestVersion: string
  intentFamily: string
  intentSubtype: string
  targetSurfaceId?: string
  instanceLabel?: string
  duplicateFamily?: string
  selectorSpecific: boolean
  arguments: Record<string, unknown>
  confidence: 'high' | 'medium' | 'low'
  executionPolicy: SurfaceExecutionPolicy
  replayPolicy: SurfaceReplayPolicy
  clarificationPolicy: SurfaceClarificationPolicy
  handlerId: string
  /** How the winning candidate was retrieved (provenance for durable logs) */
  retrievalSource?: 'raw_query' | 'llm_rewrite' | 'agreement'
}

// =============================================================================
// Version
// =============================================================================

export const SURFACE_MANIFEST_VERSION = '1.0'

// =============================================================================
// Registry
// =============================================================================

const SURFACE_MANIFEST: SurfaceManifestEntry[] = []

/**
 * Register a surface manifest entry.
 * Replaces on (surfaceType, containerType) collision to prevent duplicates.
 */
export function registerSurfaceManifest(entry: SurfaceManifestEntry): void {
  const idx = SURFACE_MANIFEST.findIndex(
    e => e.surfaceType === entry.surfaceType && e.containerType === entry.containerType
  )
  if (idx >= 0) {
    SURFACE_MANIFEST[idx] = entry
  } else {
    SURFACE_MANIFEST.push(entry)
  }
}

/**
 * Test-only: reset registry state between tests.
 */
export function _resetSurfaceManifestRegistry(): void {
  SURFACE_MANIFEST.length = 0
}

// =============================================================================
// Lookup Helpers
// =============================================================================

/**
 * Find a manifest entry by surfaceType and containerType.
 */
export function findSurfaceEntry(
  surfaceType: string,
  containerType: SurfaceContainerType,
): SurfaceManifestEntry | undefined {
  return SURFACE_MANIFEST.find(
    e => e.surfaceType === surfaceType && e.containerType === containerType
  )
}

/**
 * Find a command entry within a surface manifest.
 */
export function findSurfaceCommand(
  surfaceType: string,
  containerType: SurfaceContainerType,
  intentFamily: string,
  intentSubtype: string,
): SurfaceCommandEntry | undefined {
  const entry = findSurfaceEntry(surfaceType, containerType)
  return entry?.supportedCommands.find(
    c => c.intentFamily === intentFamily && c.intentSubtype === intentSubtype
  )
}

/**
 * Get the current surface manifest version.
 */
export function getSurfaceManifestVersion(): string {
  return SURFACE_MANIFEST_VERSION
}

/**
 * Get all registered surface manifests.
 */
export function getAllSurfaceManifests(): readonly SurfaceManifestEntry[] {
  return SURFACE_MANIFEST
}
