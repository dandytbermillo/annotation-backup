/**
 * Memory Action Builder (Client-Side) — Phase 2b
 *
 * Reconstructs a RoutingDispatcherResult from a validated memory entry.
 * Returns null for unknown action types (fall through to normal tier chain).
 *
 * Client-safe: no crypto, no DB imports.
 */

import type { MemoryLookupResult } from './memory-reader'
import type { ResolvedNoteCommand } from '@/lib/chat/note-command-manifest'

// Forward-reference to avoid importing full dispatcher (too many deps)
interface MinimalRoutingResult {
  handled: boolean
  handledByTier?: number
  tierLabel?: string
  clarificationCleared: boolean
  isNewQuestionOrCommandDetected: boolean
  classifierCalled: boolean
  classifierTimeout: boolean
  classifierError: boolean
  isFollowUp: boolean
  _devProvenanceHint?: string
  _memoryCandidate?: MemoryLookupResult
  groundingAction?: {
    type: 'execute_referent'
    syntheticMessage: string
    candidateId: string
    candidateLabel: string
    actionHint?: string
  } | {
    type: 'execute_widget_item'
    widgetId: string
    segmentId?: string
    itemId: string
    itemLabel: string
    action: string
  }
  navigationReplayAction?:
    | { type: 'open_entry'; entryId: string; entryName: string; dashboardWorkspaceId: string }
    | { type: 'open_workspace'; workspaceId: string; workspaceName: string; entryId: string; entryName: string; isDefault: boolean }
    | { type: 'open_panel'; panelId: string; panelTitle: string }
    | { type: 'go_home' }
  /** Phase 4: recovered ResolvedNoteCommand from note_manifest_cache row */
  _resolvedNoteCommand?: ResolvedNoteCommand
}

/**
 * Reconstruct a RoutingDispatcherResult from a validated memory entry.
 *
 * Uses 'memory_semantic' provenance (B1 memory_exact removed in Slice B3).
 * Attaches _memoryCandidate for commit-point revalidation in sendMessage.
 *
 * Returns null for unknown action types.
 */
export function buildResultFromMemory(
  candidate: MemoryLookupResult,
  defaultResult: MinimalRoutingResult,
): MinimalRoutingResult | null {
  const actionType = candidate.slots_json.action_type as string | undefined

  let groundingAction: MinimalRoutingResult['groundingAction']

  if (actionType === 'execute_widget_item') {
    groundingAction = {
      type: 'execute_widget_item',
      widgetId: candidate.slots_json.widgetId as string,
      segmentId: (candidate.slots_json.segmentId as string | null) ?? undefined,
      itemId: candidate.slots_json.itemId as string,
      itemLabel: candidate.slots_json.itemLabel as string,
      action: candidate.slots_json.action as string,
    }
  } else if (actionType === 'execute_referent') {
    groundingAction = {
      type: 'execute_referent',
      syntheticMessage: candidate.slots_json.syntheticMessage as string,
      candidateId: candidate.slots_json.candidateId as string,
      candidateLabel: candidate.slots_json.candidateLabel as string,
      actionHint: (candidate.slots_json.actionHint as string | null) ?? undefined,
    }
  } else if (actionType === 'open_entry') {
    // Phase 5 navigation replay — first-class, no text re-resolution
    return {
      ...defaultResult,
      handled: true,
      handledByTier: undefined,
      tierLabel: `memory_semantic:${candidate.intent_id}`,
      _devProvenanceHint: 'memory_semantic',
      _memoryCandidate: candidate,
      navigationReplayAction: {
        type: 'open_entry' as const,
        entryId: candidate.slots_json.entryId as string,
        entryName: candidate.slots_json.entryName as string,
        dashboardWorkspaceId: candidate.slots_json.dashboardWorkspaceId as string,
      },
    }
  } else if (actionType === 'open_workspace') {
    return {
      ...defaultResult,
      handled: true,
      handledByTier: undefined,
      tierLabel: `memory_semantic:${candidate.intent_id}`,
      _devProvenanceHint: 'memory_semantic',
      _memoryCandidate: candidate,
      navigationReplayAction: {
        type: 'open_workspace' as const,
        workspaceId: candidate.slots_json.workspaceId as string,
        workspaceName: candidate.slots_json.workspaceName as string,
        entryId: candidate.slots_json.entryId as string,
        entryName: candidate.slots_json.entryName as string,
        isDefault: (candidate.slots_json.isDefault as boolean) ?? false,
      },
    }
  } else if (actionType === 'go_home') {
    return {
      ...defaultResult,
      handled: true,
      handledByTier: undefined,
      tierLabel: `memory_semantic:${candidate.intent_id}`,
      _devProvenanceHint: 'memory_semantic',
      _memoryCandidate: candidate,
      navigationReplayAction: { type: 'go_home' as const },
    }
  } else if (actionType === 'open_panel') {
    return {
      ...defaultResult,
      handled: true,
      handledByTier: undefined,
      tierLabel: `memory_semantic:${candidate.intent_id}`,
      _devProvenanceHint: 'memory_semantic',
      _memoryCandidate: candidate,
      navigationReplayAction: {
        type: 'open_panel' as const,
        panelId: candidate.slots_json.panelId as string,
        panelTitle: candidate.slots_json.panelTitle as string,
      },
    }
  } else if (actionType === 'note_manifest_cache') {
    // Phase 4: Generic note manifest cache recovery.
    // Recover the full ResolvedNoteCommand from slots_json.
    // The CALLER dispatches by executionPolicy, not this builder.
    return {
      ...defaultResult,
      handled: true,
      handledByTier: undefined,
      tierLabel: `memory_semantic:${candidate.intent_id}`,
      _devProvenanceHint: 'memory_semantic',
      _memoryCandidate: candidate,
      _resolvedNoteCommand: {
        surface: 'note' as const,
        manifestVersion: candidate.slots_json.manifestVersion as string,
        intentFamily: candidate.slots_json.intentFamily as ResolvedNoteCommand['intentFamily'],
        intentSubtype: candidate.slots_json.intentSubtype as string,
        executionPolicy: candidate.slots_json.executionPolicy as ResolvedNoteCommand['executionPolicy'],
        replayPolicy: candidate.slots_json.replayPolicy as ResolvedNoteCommand['replayPolicy'],
        clarificationPolicy: candidate.slots_json.clarificationPolicy as ResolvedNoteCommand['clarificationPolicy'],
        handlerId: candidate.slots_json.handlerId as string,
        arguments: (candidate.slots_json.arguments ?? {}) as ResolvedNoteCommand['arguments'],
        noteAnchor: candidate.slots_json.noteAnchor as ResolvedNoteCommand['noteAnchor'],
        selectorMode: candidate.slots_json.selectorMode as ResolvedNoteCommand['selectorMode'],
        confidence: candidate.slots_json.confidence as ResolvedNoteCommand['confidence'],
      },
    }
  } else if (actionType === 'surface_manifest_execute') {
    // No-clarifier convergence: surface-manifest-backed actions (list_items, open_surface)
    // now routed through semantic retrieval instead of independent surface resolver.
    const manifest = candidate.slots_json.surface_manifest as Record<string, unknown> | undefined
    const executionPolicy = manifest?.executionPolicy as string | undefined
    return {
      ...defaultResult,
      handled: true,
      handledByTier: undefined,
      tierLabel: `memory_semantic:${candidate.intent_id}`,
      _devProvenanceHint: 'memory_semantic',
      _memoryCandidate: candidate,
      _surfaceManifestAction: {
        executionPolicy: executionPolicy ?? 'unknown',
        surfaceType: (manifest?.surfaceType as string) ?? 'unknown',
        intentFamily: (manifest?.intentFamily as string) ?? 'unknown',
        intentSubtype: (manifest?.intentSubtype as string) ?? 'unknown',
        handlerId: (manifest?.handlerId as string) ?? 'unknown',
      },
    } as MinimalRoutingResult
  } else {
    // Unknown action type — cannot reconstruct, fall through
    return null
  }

  return {
    ...defaultResult,
    handled: true,
    handledByTier: undefined, // Memory lane, not a tier
    tierLabel: `memory_semantic:${candidate.intent_id}`,
    _devProvenanceHint: 'memory_semantic',
    _memoryCandidate: candidate,
    groundingAction,
  }
}
