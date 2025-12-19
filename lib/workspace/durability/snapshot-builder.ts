/**
 * Unified Snapshot Builder
 *
 * Single entry point for building durable workspace snapshots.
 * Combines notes/panels and components into a unified payload with
 * consistent source selection and guard policies.
 *
 * @see docs/proposal/workspace-state-machine/improvement/2025-12-18-unified-workspace-durability-pipeline.md
 */

import type {
  NoteWorkspacePanelSnapshot,
  NoteWorkspaceComponentSnapshot,
  NoteWorkspaceCamera,
} from '@/lib/types/note-workspace'
import type { NoteWorkspaceSnapshot } from '@/lib/note-workspaces/state'
import type {
  WorkspaceDurableSnapshot,
  SnapshotCaptureResult,
  DurableOpenNote,
} from './types'
import {
  isSnapshotInconsistent,
  createEmptySnapshot,
} from './types'
import { debugLog } from '@/lib/utils/debug-logger'

// Import from existing modules
import {
  hasWorkspaceRuntime,
  getRuntimeOpenNotes,
  getRuntimeMembership,
  listRuntimeComponents,
} from '@/lib/workspace/runtime-manager'
import {
  getComponentsForPersistence,
} from '@/lib/workspace/store-runtime-bridge'

// =============================================================================
// Types
// =============================================================================

/**
 * Sources for reading notes/panels state.
 */
export interface NotesPanelsSource {
  /** Current workspace snapshot (from capture or cache) */
  snapshot?: NoteWorkspaceSnapshot
  /** Cached panel snapshots by note ID */
  cachedPanels?: Map<string, NoteWorkspacePanelSnapshot[]>
  /** Last non-empty snapshot (fallback) */
  lastNonEmpty?: NoteWorkspacePanelSnapshot[]
  /** Last known camera position */
  lastCamera?: NoteWorkspaceCamera
}

/**
 * Options for building a unified snapshot.
 */
export interface BuildSnapshotOptions {
  /** Workspace ID */
  workspaceId: string
  /** Whether this is the active (visible) workspace */
  isActive: boolean
  /** Notes/panels data sources */
  notesPanels: NotesPanelsSource
  /** Whether live state (runtime) features are enabled */
  liveStateEnabled: boolean
  /** Last known components snapshot (fallback) */
  lastComponentsSnapshot?: NoteWorkspaceComponentSnapshot[]
}

// =============================================================================
// Default Values
// =============================================================================

const DEFAULT_CAMERA: NoteWorkspaceCamera = { x: 0, y: 0, scale: 1 }

// =============================================================================
// Unified Snapshot Builder
// =============================================================================

/**
 * Build a unified durable snapshot for a workspace.
 *
 * This is the SINGLE entry point for all persistence operations.
 * It reads from authoritative sources with consistent fallback logic.
 *
 * Source priority for components:
 * 1. Component store (new authoritative source)
 * 2. Runtime ledger (legacy fallback)
 * 3. Last cached snapshot (emergency fallback)
 *
 * @param options Build options
 * @returns Snapshot capture result with source tracking
 */
export function buildUnifiedSnapshot(
  options: BuildSnapshotOptions
): SnapshotCaptureResult {
  const {
    workspaceId,
    isActive,
    notesPanels,
    liveStateEnabled,
    lastComponentsSnapshot,
  } = options

  // --- Build Notes/Panels portion ---
  const notesPanelsResult = buildNotesPanelsPortion(
    workspaceId,
    notesPanels,
    liveStateEnabled
  )

  // --- Build Components portion ---
  const componentsResult = buildComponentsPortion(
    workspaceId,
    liveStateEnabled,
    lastComponentsSnapshot
  )

  // --- Assemble unified snapshot ---
  const snapshot: WorkspaceDurableSnapshot = {
    schemaVersion: '1.1.0',
    openNotes: notesPanelsResult.openNotes,
    activeNoteId: notesPanelsResult.activeNoteId,
    panels: notesPanelsResult.panels,
    camera: notesPanelsResult.camera,
    components: componentsResult.components,
  }

  // --- Check for inconsistency ---
  const isInconsistent = isSnapshotInconsistent(snapshot)

  void debugLog({
    component: 'UnifiedSnapshotBuilder',
    action: 'build_unified_snapshot',
    metadata: {
      workspaceId,
      isActive,
      notesPanelsSource: notesPanelsResult.source,
      componentsSource: componentsResult.source,
      openNotesCount: snapshot.openNotes.length,
      panelsCount: snapshot.panels.length,
      componentsCount: snapshot.components.length,
      isInconsistent,
    },
  })

  if (isInconsistent) {
    return {
      success: false,
      snapshot,
      notesPanelsSource: notesPanelsResult.source,
      componentsSource: componentsResult.source,
      skipReason: 'transient_mismatch',
    }
  }

  return {
    success: true,
    snapshot,
    notesPanelsSource: notesPanelsResult.source,
    componentsSource: componentsResult.source,
  }
}

// =============================================================================
// Notes/Panels Builder
// =============================================================================

interface NotesPanelsResult {
  openNotes: DurableOpenNote[]
  activeNoteId: string | null
  panels: NoteWorkspacePanelSnapshot[]
  camera: NoteWorkspaceCamera
  source: 'active' | 'cached' | 'runtime'
}

function buildNotesPanelsPortion(
  workspaceId: string,
  sources: NotesPanelsSource,
  liveStateEnabled: boolean
): NotesPanelsResult {
  const { snapshot, cachedPanels, lastNonEmpty, lastCamera } = sources

  // If we have a direct snapshot, use it
  if (snapshot) {
    const openNotes: DurableOpenNote[] = snapshot.openNotes.map(entry => ({
      noteId: entry.noteId,
      position: entry.mainPosition ?? null,
    }))

    return {
      openNotes,
      activeNoteId: snapshot.activeNoteId ?? openNotes[0]?.noteId ?? null,
      panels: snapshot.panels ?? [],
      camera: snapshot.camera ?? lastCamera ?? DEFAULT_CAMERA,
      source: 'active',
    }
  }

  // Fall back to runtime if available
  if (liveStateEnabled && hasWorkspaceRuntime(workspaceId)) {
    const runtimeOpenNotes = getRuntimeOpenNotes(workspaceId) ?? []
    const runtimeMembership = getRuntimeMembership(workspaceId)

    if (runtimeOpenNotes.length > 0) {
      const openNotes: DurableOpenNote[] = runtimeOpenNotes.map(note => ({
        noteId: note.noteId,
        position: null, // Runtime doesn't track main position
      }))

      // Collect panels from cached snapshots for these notes
      let panels: NoteWorkspacePanelSnapshot[] = []
      if (cachedPanels) {
        for (const note of runtimeOpenNotes) {
          const notePanels = cachedPanels.get(note.noteId)
          if (notePanels) {
            panels = panels.concat(notePanels)
          }
        }
      }

      // Use last non-empty if we have no panels
      if (panels.length === 0 && lastNonEmpty && lastNonEmpty.length > 0) {
        panels = lastNonEmpty
      }

      return {
        openNotes,
        activeNoteId: runtimeOpenNotes[0]?.noteId ?? null,
        panels,
        camera: lastCamera ?? DEFAULT_CAMERA,
        source: 'runtime',
      }
    }
  }

  // Emergency: return last known state from cache
  if (lastNonEmpty && lastNonEmpty.length > 0) {
    // Derive open notes from panel note IDs
    const noteIds = new Set(lastNonEmpty.map(p => p.noteId))
    const openNotes: DurableOpenNote[] = Array.from(noteIds).map(noteId => ({
      noteId,
      position: null,
    }))

    return {
      openNotes,
      activeNoteId: openNotes[0]?.noteId ?? null,
      panels: lastNonEmpty,
      camera: lastCamera ?? DEFAULT_CAMERA,
      source: 'cached',
    }
  }

  // No data available
  return {
    openNotes: [],
    activeNoteId: null,
    panels: [],
    camera: lastCamera ?? DEFAULT_CAMERA,
    source: 'cached',
  }
}

// =============================================================================
// Components Builder
// =============================================================================

interface ComponentsResult {
  components: NoteWorkspaceComponentSnapshot[]
  source: 'store' | 'runtime_ledger' | 'cached'
}

function buildComponentsPortion(
  workspaceId: string,
  liveStateEnabled: boolean,
  lastComponentsSnapshot?: NoteWorkspaceComponentSnapshot[]
): ComponentsResult {
  // Primary: Use the store-runtime bridge (handles store vs runtime priority)
  const bridgeComponents = getComponentsForPersistence(workspaceId)

  if (bridgeComponents.length > 0) {
    const components: NoteWorkspaceComponentSnapshot[] = bridgeComponents.map(comp => ({
      id: comp.id,
      type: comp.type,
      position: comp.position,
      size: comp.size,
      zIndex: comp.zIndex,
      metadata: comp.metadata,
    }))

    // Determine source based on what getComponentsForPersistence used
    // (It logs this, but we can't access that directly - assume store if available)
    return {
      components,
      source: 'store', // Primary assumption; bridge prefers store
    }
  }

  // Secondary: Check runtime ledger directly (shouldn't reach here normally)
  if (liveStateEnabled && hasWorkspaceRuntime(workspaceId)) {
    const runtimeComponents = listRuntimeComponents(workspaceId)

    if (runtimeComponents.length > 0) {
      const components: NoteWorkspaceComponentSnapshot[] = runtimeComponents.map(comp => ({
        id: comp.componentId,
        type: comp.componentType,
        position: comp.position,
        size: comp.size,
        zIndex: comp.zIndex,
        metadata: comp.metadata,
      }))

      return {
        components,
        source: 'runtime_ledger',
      }
    }
  }

  // Fallback: Use last cached components
  if (lastComponentsSnapshot && lastComponentsSnapshot.length > 0) {
    return {
      components: lastComponentsSnapshot,
      source: 'cached',
    }
  }

  // No components
  return {
    components: [],
    source: 'cached',
  }
}

// =============================================================================
// Quick Consistency Check
// =============================================================================

/**
 * Quick check if a workspace has any durable content.
 * Useful for determining if a persist operation is meaningful.
 */
export function hasAnyDurableContent(workspaceId: string): boolean {
  // Check components first (fastest)
  const components = getComponentsForPersistence(workspaceId)
  if (components.length > 0) return true

  // Check runtime for notes
  if (hasWorkspaceRuntime(workspaceId)) {
    const openNotes = getRuntimeOpenNotes(workspaceId)
    if (openNotes && openNotes.length > 0) return true
  }

  return false
}
