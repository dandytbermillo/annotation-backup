/**
 * Phase 4: Note Manifest Memory/Cache Integration Tests
 *
 * Tests the generic note_manifest_cache pipeline:
 * - Write builder: buildNoteManifestWritePayload
 * - Validator: validateMemoryCandidate for note_manifest_cache
 * - Action builder: buildResultFromMemory for note_manifest_cache
 */

import { buildNoteManifestWritePayload } from '@/lib/chat/routing-log/memory-write-payload'
import { validateMemoryCandidate } from '@/lib/chat/routing-log/memory-validator'
import { buildResultFromMemory } from '@/lib/chat/routing-log/memory-action-builder'
import { NOTE_MANIFEST_VERSION } from '@/lib/chat/note-command-manifest'
import type { ContextSnapshotV1 } from '@/lib/chat/routing-log/context-snapshot'

// --- Fixtures ---

const mockContextSnapshot: ContextSnapshotV1 = {
  v: 1,
  openWidgetCount: 2,
  pendingOptionsCount: 0,
  activeOptionSetId: null,
  hasLastClarification: false,
  hasLastSuggestion: false,
  latchEnabled: false,
  messageCount: 5,
}

const stateInfoCommand = {
  surface: 'note' as const,
  manifestVersion: NOTE_MANIFEST_VERSION,
  intentFamily: 'state_info' as const,
  intentSubtype: 'active_note',
  executionPolicy: 'live_state_resolve' as const,
  replayPolicy: 'cache_resolution_only' as const,
  clarificationPolicy: 'no_clarification' as const,
  handlerId: 'note_state_info_resolver',
  arguments: {},
  noteAnchor: { source: 'active_note' as const, isValidated: false },
  selectorMode: 'contextual' as const,
  confidence: 'high' as const,
}

const navigateCommand = {
  surface: 'note' as const,
  manifestVersion: NOTE_MANIFEST_VERSION,
  intentFamily: 'navigate' as const,
  intentSubtype: 'open_note',
  executionPolicy: 'open_note_in_current_workspace' as const,
  replayPolicy: 'safe_with_revalidation' as const,
  clarificationPolicy: 'clarify_on_ambiguous_target' as const,
  handlerId: 'note_navigate_resolver',
  arguments: { noteTitle: 'Project Plan' },
  noteAnchor: { source: 'explicit_note' as const, isValidated: false },
  selectorMode: 'explicit' as const,
  confidence: 'high' as const,
}

function makeCacheCandidate(overrides: Record<string, unknown> = {}) {
  return {
    intent_id: 'note_manifest:state_info.active_note',
    intent_class: 'info_intent' as const,
    slots_json: {
      action_type: 'note_manifest_cache',
      surface: 'note',
      manifestVersion: NOTE_MANIFEST_VERSION,
      intentFamily: 'state_info',
      intentSubtype: 'active_note',
      executionPolicy: 'live_state_resolve',
      replayPolicy: 'cache_resolution_only',
      clarificationPolicy: 'no_clarification',
      handlerId: 'note_state_info_resolver',
      arguments: {},
      noteAnchor: { source: 'active_note', isValidated: false },
      selectorMode: 'contextual',
      confidence: 'high',
      ...overrides,
    },
    target_ids: [] as string[],
    risk_tier: 'low' as const,
    success_count: 1,
    context_fingerprint: 'test-fp',
  }
}

function makeNavigateCacheCandidate(overrides: Record<string, unknown> = {}) {
  return {
    intent_id: 'note_manifest:navigate.open_note',
    intent_class: 'action_intent' as const,
    slots_json: {
      action_type: 'note_manifest_cache',
      surface: 'note',
      manifestVersion: NOTE_MANIFEST_VERSION,
      intentFamily: 'navigate',
      intentSubtype: 'open_note',
      executionPolicy: 'open_note_in_current_workspace',
      replayPolicy: 'safe_with_revalidation',
      clarificationPolicy: 'clarify_on_ambiguous_target',
      handlerId: 'note_navigate_resolver',
      arguments: { noteTitle: 'Project Plan' },
      noteAnchor: { source: 'explicit_note', isValidated: false },
      selectorMode: 'explicit',
      confidence: 'high',
      ...overrides,
    },
    target_ids: [] as string[],
    risk_tier: 'low' as const,
    success_count: 0,
    context_fingerprint: 'test-fp',
  }
}

const emptySnapshot = { openWidgets: [] }

const defaultResult = {
  handled: false,
  clarificationCleared: false,
  isNewQuestionOrCommandDetected: false,
  classifierCalled: false,
  classifierTimeout: false,
  classifierError: false,
  isFollowUp: false,
}

// --- Write Builder Tests ---

describe('buildNoteManifestWritePayload', () => {
  it('produces correct payload for state_info', () => {
    const payload = buildNoteManifestWritePayload({
      rawQueryText: 'which note is open?',
      resolvedCommand: stateInfoCommand,
      contextSnapshot: mockContextSnapshot,
    })

    expect(payload.intent_id).toBe('note_manifest:state_info.active_note')
    expect(payload.intent_class).toBe('info_intent')
    expect(payload.slots_json.action_type).toBe('note_manifest_cache')
    expect(payload.slots_json.intentFamily).toBe('state_info')
    expect(payload.slots_json.manifestVersion).toBe(NOTE_MANIFEST_VERSION)
    expect(payload.target_ids).toEqual([])
    expect(payload.risk_tier).toBe('low')
  })

  it('produces correct payload for navigate with noteTitle', () => {
    const payload = buildNoteManifestWritePayload({
      rawQueryText: 'open note Project Plan',
      resolvedCommand: navigateCommand,
      contextSnapshot: mockContextSnapshot,
    })

    expect(payload.intent_id).toBe('note_manifest:navigate.open_note')
    expect(payload.intent_class).toBe('action_intent')
    expect(payload.slots_json.action_type).toBe('note_manifest_cache')
    expect(payload.slots_json.intentFamily).toBe('navigate')
    expect((payload.slots_json.arguments as Record<string, unknown>).noteTitle).toBe('Project Plan')
    expect(payload.target_ids).toEqual([])
    expect(payload.risk_tier).toBe('low')
  })

  it('uses note_manifest_cache action_type for all families', () => {
    const p1 = buildNoteManifestWritePayload({
      rawQueryText: 'q1',
      resolvedCommand: stateInfoCommand,
      contextSnapshot: mockContextSnapshot,
    })
    const p2 = buildNoteManifestWritePayload({
      rawQueryText: 'q2',
      resolvedCommand: navigateCommand,
      contextSnapshot: mockContextSnapshot,
    })
    expect(p1.slots_json.action_type).toBe('note_manifest_cache')
    expect(p2.slots_json.action_type).toBe('note_manifest_cache')
  })
})

// --- Validator Tests ---

describe('validateMemoryCandidate — note_manifest_cache', () => {
  it('valid: matching version + entry + handler + policy', () => {
    const candidate = makeCacheCandidate()
    const result = validateMemoryCandidate(candidate, emptySnapshot)
    expect(result).toEqual({ valid: true })
  })

  it('valid: navigate with all required args', () => {
    const candidate = makeNavigateCacheCandidate()
    const result = validateMemoryCandidate(candidate, emptySnapshot)
    expect(result).toEqual({ valid: true })
  })

  it('rejects: mismatched manifest version', () => {
    const candidate = makeCacheCandidate({ manifestVersion: '0.9' })
    const result = validateMemoryCandidate(candidate, emptySnapshot)
    expect(result).toEqual({ valid: false, reason: 'manifest_version_mismatch' })
  })

  it('rejects: removed manifest entry', () => {
    const candidate = makeCacheCandidate({ intentFamily: 'mutate', intentSubtype: 'delete_note' })
    // This family+subtype doesn't exist in the manifest
    const result = validateMemoryCandidate(candidate, emptySnapshot)
    expect(result).toEqual({ valid: false, reason: 'manifest_entry_removed' })
  })

  it('rejects: changed execution policy', () => {
    const candidate = makeCacheCandidate({ executionPolicy: 'stage6_grounded_answer' })
    const result = validateMemoryCandidate(candidate, emptySnapshot)
    expect(result).toEqual({ valid: false, reason: 'execution_policy_changed' })
  })

  it('rejects: changed handler ID', () => {
    const candidate = makeCacheCandidate({ handlerId: 'old_handler_v1' })
    const result = validateMemoryCandidate(candidate, emptySnapshot)
    expect(result).toEqual({ valid: false, reason: 'handler_id_changed' })
  })

  it('rejects: changed replay policy', () => {
    const candidate = makeCacheCandidate({ replayPolicy: 'never_direct_replay' })
    const result = validateMemoryCandidate(candidate, emptySnapshot)
    expect(result).toEqual({ valid: false, reason: 'replay_policy_changed' })
  })

  it('rejects: navigate missing required noteTitle argument', () => {
    const candidate = makeNavigateCacheCandidate({ arguments: {} })
    const result = validateMemoryCandidate(candidate, emptySnapshot)
    expect(result).toEqual({ valid: false, reason: 'required_argument_missing' })
  })
})

// --- Action Builder Tests ---

describe('buildResultFromMemory — note_manifest_cache', () => {
  it('recovers handled:true + _resolvedNoteCommand with all fields', () => {
    const candidate = makeCacheCandidate()
    const result = buildResultFromMemory(candidate, defaultResult)

    expect(result).not.toBeNull()
    expect(result!.handled).toBe(true)
    expect(result!.tierLabel).toBe('memory_semantic:note_manifest:state_info.active_note')
    expect(result!._devProvenanceHint).toBe('memory_semantic')
    expect(result!._memoryCandidate).toBe(candidate)
    expect(result!._resolvedNoteCommand).toBeDefined()

    const cmd = result!._resolvedNoteCommand as Record<string, unknown>
    expect(cmd.surface).toBe('note')
    expect(cmd.manifestVersion).toBe(NOTE_MANIFEST_VERSION)
    expect(cmd.intentFamily).toBe('state_info')
    expect(cmd.executionPolicy).toBe('live_state_resolve')
    expect(cmd.handlerId).toBe('note_state_info_resolver')
  })

  it('navigate recovery preserves noteTitle in arguments', () => {
    const candidate = makeNavigateCacheCandidate()
    const result = buildResultFromMemory(candidate, defaultResult)

    expect(result).not.toBeNull()
    const cmd = result!._resolvedNoteCommand as Record<string, unknown>
    const args = cmd.arguments as Record<string, unknown>
    expect(args.noteTitle).toBe('Project Plan')
    expect(cmd.executionPolicy).toBe('open_note_in_current_workspace')
  })

  it('unknown action_type returns null', () => {
    const candidate = {
      ...makeCacheCandidate(),
      slots_json: { ...makeCacheCandidate().slots_json, action_type: 'unknown_thing' },
    }
    const result = buildResultFromMemory(candidate, defaultResult)
    expect(result).toBeNull()
  })
})

// --- B1 Dispatch Tests ---
//
// These test the dispatcher-level behavior when a note_manifest_cache B1 hit
// is processed. We test the dispatch logic by verifying the result shape
// that buildResultFromMemory produces (which the dispatcher consumes),
// and the dispatch contract each executionPolicy requires.

describe('B1 dispatch contract — note_manifest_cache', () => {
  it('live_state_resolve: result carries _resolvedNoteCommand for dispatcher to execute live', () => {
    const candidate = makeCacheCandidate()
    const result = buildResultFromMemory(candidate, defaultResult)!

    // B1 action builder returns handled: true (dispatcher keeps it for live_state_resolve)
    expect(result.handled).toBe(true)
    expect(result._resolvedNoteCommand).toBeDefined()
    expect(result._resolvedNoteCommand!.executionPolicy).toBe('live_state_resolve')
    // Dispatcher must call resolveNoteStateInfo() live — not return stale answer
    // _noteManifestNavigate must NOT be set for state_info
    expect((result as Record<string, unknown>)._noteManifestNavigate).toBeUndefined()
  })

  it('navigate_note: result carries _resolvedNoteCommand with noteTitle for dispatcher to convert', () => {
    const candidate = makeNavigateCacheCandidate()
    const result = buildResultFromMemory(candidate, defaultResult)!

    // B1 action builder returns handled: true; dispatcher flips to false + attaches _noteManifestNavigate
    expect(result.handled).toBe(true)
    expect(result._resolvedNoteCommand).toBeDefined()
    expect(result._resolvedNoteCommand!.executionPolicy).toBe('open_note_in_current_workspace')
    const args = result._resolvedNoteCommand!.arguments as Record<string, unknown>
    expect(args.noteTitle).toBe('Project Plan')
    // Dispatcher is responsible for: memoryAction.handled = false, memoryAction._noteManifestNavigate = { noteTitle }
  })

  it('unknown policy: result still carries _resolvedNoteCommand, dispatcher must reject', () => {
    // Simulate a cached row with an unsupported executionPolicy
    const candidate = makeCacheCandidate({
      executionPolicy: 'confirm_then_mutate',
      // Also need matching family/subtype that would pass validator, but for this test
      // we're testing the action builder output shape, not the validator
    })
    const result = buildResultFromMemory(candidate, defaultResult)!

    // Action builder still recovers the command — it's the dispatcher's job to reject unknown policies
    expect(result.handled).toBe(true)
    expect(result._resolvedNoteCommand).toBeDefined()
    expect(result._resolvedNoteCommand!.executionPolicy).toBe('confirm_then_mutate')
    // Dispatcher must: set noteManifestRejected = true, skip Gate 6/8/return, fall through
  })

  it('navigate: _pendingMemoryWrite and _pendingMemoryLog must not be set by action builder', () => {
    // Memory log/write are built by the dispatcher, not the action builder.
    // Client Block F only fires them after confirmed navigate API success.
    const candidate = makeNavigateCacheCandidate()
    const result = buildResultFromMemory(candidate, defaultResult)!

    // Action builder must NOT pre-attach these — that's the dispatcher's responsibility
    expect((result as Record<string, unknown>)._pendingMemoryLog).toBeUndefined()
    expect((result as Record<string, unknown>)._pendingMemoryWrite).toBeUndefined()
  })

  it('navigate failure/ambiguity: deferred writes are not emitted by action builder', () => {
    // Verifies that the action builder does not eagerly emit memory writes.
    // In the real flow, if navigate API returns ambiguity (not success),
    // Block F does NOT fire _pendingMemoryLog/_pendingMemoryWrite.
    // This test confirms the action builder leaves those fields unset.
    const candidate = makeNavigateCacheCandidate()
    const result = buildResultFromMemory(candidate, defaultResult)!

    // Only the dispatcher and client should manage these fields
    expect(result._memoryCandidate).toBe(candidate)
    expect((result as Record<string, unknown>)._pendingMemoryLog).toBeUndefined()
    expect((result as Record<string, unknown>)._pendingMemoryWrite).toBeUndefined()
  })
})
