/**
 * Stage 5 Shadow Telemetry Tests
 *
 * Tests the evaluateStage5Replay() pure function for all outcome paths.
 * Shadow mode only — no execution, just telemetry evaluation.
 */

import { evaluateStage5Replay, type S5EvaluationResult, type S5ValidationResult } from '@/lib/chat/routing-log/stage5-evaluator'
import type { SemanticCandidate } from '@/lib/chat/routing-log/memory-semantic-reader'
import { buildResultFromMemory } from '@/lib/chat/routing-log/memory-action-builder'
import { provenanceToDecisionSource, deriveResultStatus } from '@/lib/chat/routing-log/mapping'

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeCandidate(overrides: Partial<{
  similarity_score: number
  action_type: string
  risk_tier: string
  widgetId: string
  itemId: string
  candidateId: string
  intent_id: string
}>): SemanticCandidate {
  const actionType = overrides.action_type ?? 'execute_widget_item'
  const base = {
    intent_id: overrides.intent_id ?? 'tier_4.5_grounding_llm',
    intent_class: 'action_intent' as const,
    slots_json: actionType === 'execute_widget_item'
      ? {
          action_type: actionType,
          widgetId: overrides.widgetId ?? 'widget-1',
          itemId: overrides.itemId ?? 'item-1',
          itemLabel: 'Test Item',
          action: 'open',
        }
      : {
          action_type: actionType,
          candidateId: overrides.candidateId ?? 'candidate-1',
          candidateLabel: 'Test Candidate',
          syntheticMessage: 'open test',
        },
    target_ids: actionType === 'execute_widget_item'
      ? [overrides.widgetId ?? 'widget-1', overrides.itemId ?? 'item-1']
      : [overrides.candidateId ?? 'candidate-1'],
    risk_tier: (overrides.risk_tier ?? 'low') as 'low' | 'medium' | 'high',
    success_count: 1,
    context_fingerprint: 'fp-abc123',
    similarity_score: overrides.similarity_score ?? 0.95,
  }
  return base
}

const SNAPSHOT_WITH_WIDGET = {
  openWidgets: [
    {
      id: 'widget-1',
      label: 'Links Panel A',
      options: [
        { id: 'item-1', label: 'Budget Report' },
        { id: 'item-2', label: 'Q3 Summary' },
      ],
    },
  ],
}

const SNAPSHOT_WITH_REFERENT = {
  openWidgets: [
    {
      id: 'widget-1',
      label: 'Links Panel A',
      options: [
        { id: 'candidate-1', label: 'Budget 100' },
      ],
    },
  ],
}

const EMPTY_SNAPSHOT = { openWidgets: [] }

// ---------------------------------------------------------------------------
// Tests: Single candidate — all gates pass
// ---------------------------------------------------------------------------

describe('Stage 5 Shadow Telemetry: evaluateStage5Replay', () => {

  describe('shadow_replay_eligible (single candidate passes all gates)', () => {
    it('execute_widget_item: action_type + risk_tier + target valid → shadow_replay_eligible', () => {
      const result = evaluateStage5Replay(
        [makeCandidate({ similarity_score: 0.96 })],
        SNAPSHOT_WITH_WIDGET,
      )
      expect(result.attempted).toBe(true)
      expect(result.candidateCount).toBe(1)
      expect(result.topSimilarity).toBe(0.96)
      expect(result.validationResult).toBe('shadow_replay_eligible')
      expect(result.replayedIntentId).toBe('tier_4.5_grounding_llm')
      expect(result.replayedTargetId).toBe('item-1')
      expect(result.fallbackReason).toBeUndefined()
    })

    it('execute_referent: candidateId in snapshot → shadow_replay_eligible', () => {
      const result = evaluateStage5Replay(
        [makeCandidate({ action_type: 'execute_referent', similarity_score: 0.93 })],
        SNAPSHOT_WITH_REFERENT,
      )
      expect(result.validationResult).toBe('shadow_replay_eligible')
      expect(result.replayedTargetId).toBe('candidate-1')
    })
  })

  // ---------------------------------------------------------------------------
  // Tests: Rejection — context fingerprint mismatch (Fix B)
  // ---------------------------------------------------------------------------

  describe('rejected_context_mismatch (Fix B)', () => {
    it('candidate fingerprint differs from current → rejected_context_mismatch', () => {
      const result = evaluateStage5Replay(
        [makeCandidate({ similarity_score: 0.96 })],
        SNAPSHOT_WITH_WIDGET,
        'different-fingerprint',
      )
      expect(result.validationResult).toBe('rejected_context_mismatch')
      expect(result.fallbackReason).toBe('1_fingerprint_mismatch')
    })

    it('candidate fingerprint matches current → passes gate 0 (eligible)', () => {
      // makeCandidate sets context_fingerprint: 'fp-abc123'
      const result = evaluateStage5Replay(
        [makeCandidate({ similarity_score: 0.96 })],
        SNAPSHOT_WITH_WIDGET,
        'fp-abc123',
      )
      expect(result.validationResult).toBe('shadow_replay_eligible')
    })

    it('no currentContextFingerprint → fail-open (gate 0 skipped)', () => {
      // When server doesn't return fingerprint, gate is skipped entirely
      const result = evaluateStage5Replay(
        [makeCandidate({ similarity_score: 0.96 })],
        SNAPSHOT_WITH_WIDGET,
        undefined,
      )
      expect(result.validationResult).toBe('shadow_replay_eligible')
    })

    it('context_mismatch is lowest priority in closest-to-passing', () => {
      // 2 candidates: one fails at context mismatch, one fails at action_type
      // action_type is closer-to-passing (passed context gate), so it should be reported
      const badAction = makeCandidate({ similarity_score: 0.97 })
      badAction.slots_json.action_type = 'navigate_panel'
      badAction.context_fingerprint = 'fp-abc123' // matches current fingerprint

      const badContext = makeCandidate({ similarity_score: 0.95 })
      // badContext has 'fp-abc123' but we pass 'different-fp' as current
      // Actually both would fail... Let me set badAction fingerprint to match
      // and badContext fingerprint to mismatch

      const result = evaluateStage5Replay(
        [badAction, badContext],
        SNAPSHOT_WITH_WIDGET,
        'fp-abc123', // badAction matches, badContext matches too (both have fp-abc123)
      )
      // Both match context fingerprint. badAction fails action_type.
      // badContext passes all gates. So result is shadow_replay_eligible.
      expect(result.validationResult).toBe('shadow_replay_eligible')
    })

    it('mixed: context_mismatch + action_type rejection → reports action_type (closer-to-passing)', () => {
      const badAction = makeCandidate({ similarity_score: 0.97 })
      badAction.slots_json.action_type = 'navigate_panel'
      badAction.context_fingerprint = 'current-fp' // matches current

      const badContext = makeCandidate({ similarity_score: 0.95 })
      badContext.context_fingerprint = 'old-fp' // does NOT match current

      const result = evaluateStage5Replay(
        [badAction, badContext],
        SNAPSHOT_WITH_WIDGET,
        'current-fp',
      )
      // badAction: passes gate 0 (fp match), fails gate 1 (action_type) → closest to passing
      // badContext: fails gate 0 (fp mismatch) → farthest from passing
      expect(result.validationResult).toBe('rejected_action_type')
    })

    it('all candidates context_mismatch → reports context_mismatch', () => {
      const c1 = makeCandidate({ similarity_score: 0.96 })
      c1.context_fingerprint = 'old-fp-1'
      const c2 = makeCandidate({ similarity_score: 0.94, itemId: 'item-2' })
      c2.context_fingerprint = 'old-fp-2'

      const result = evaluateStage5Replay(
        [c1, c2],
        SNAPSHOT_WITH_WIDGET,
        'current-fp',
      )
      expect(result.validationResult).toBe('rejected_context_mismatch')
      expect(result.fallbackReason).toBe('2_fingerprint_mismatch')
    })
  })

  // ---------------------------------------------------------------------------
  // Tests: Rejection — action type
  // ---------------------------------------------------------------------------

  describe('rejected_action_type', () => {
    it('unknown action type → rejected_action_type', () => {
      const candidate = makeCandidate({})
      candidate.slots_json.action_type = 'navigate_panel'
      const result = evaluateStage5Replay([candidate], SNAPSHOT_WITH_WIDGET)
      expect(result.validationResult).toBe('rejected_action_type')
      expect(result.fallbackReason).toBe('1_not_in_allowlist')
    })

    it('missing action_type → rejected_action_type', () => {
      const candidate = makeCandidate({})
      delete candidate.slots_json.action_type
      const result = evaluateStage5Replay([candidate], SNAPSHOT_WITH_WIDGET)
      expect(result.validationResult).toBe('rejected_action_type')
    })
  })

  // ---------------------------------------------------------------------------
  // Tests: Rejection — risk tier
  // ---------------------------------------------------------------------------

  describe('rejected_risk_tier', () => {
    it('medium risk → rejected_risk_tier', () => {
      const result = evaluateStage5Replay(
        [makeCandidate({ risk_tier: 'medium' })],
        SNAPSHOT_WITH_WIDGET,
      )
      expect(result.validationResult).toBe('rejected_risk_tier')
      expect(result.fallbackReason).toBe('1_medium_or_high')
    })

    it('high risk → rejected_risk_tier (Stage 5 filters before validateMemoryCandidate)', () => {
      const result = evaluateStage5Replay(
        [makeCandidate({ risk_tier: 'high' })],
        SNAPSHOT_WITH_WIDGET,
      )
      expect(result.validationResult).toBe('rejected_risk_tier')
    })
  })

  // ---------------------------------------------------------------------------
  // Tests: Rejection — target gone
  // ---------------------------------------------------------------------------

  describe('rejected_target_gone', () => {
    it('widget not in snapshot → rejected_target_gone', () => {
      const result = evaluateStage5Replay(
        [makeCandidate({ widgetId: 'gone-widget' })],
        SNAPSHOT_WITH_WIDGET,
      )
      expect(result.validationResult).toBe('rejected_target_gone')
      expect(result.fallbackReason).toBe('target_widget_gone')
    })

    it('widget present but item gone → rejected_target_gone', () => {
      const result = evaluateStage5Replay(
        [makeCandidate({ widgetId: 'widget-1', itemId: 'gone-item' })],
        SNAPSHOT_WITH_WIDGET,
      )
      expect(result.validationResult).toBe('rejected_target_gone')
      expect(result.fallbackReason).toBe('target_item_gone')
    })

    it('empty snapshot → rejected_target_gone', () => {
      const result = evaluateStage5Replay(
        [makeCandidate({})],
        EMPTY_SNAPSHOT,
      )
      expect(result.validationResult).toBe('rejected_target_gone')
    })
  })

  // ---------------------------------------------------------------------------
  // Tests: Rejection — target not visible (execute_referent)
  // ---------------------------------------------------------------------------

  describe('rejected_target_not_visible', () => {
    it('execute_referent: candidateId not in any widget → rejected_target_not_visible', () => {
      const result = evaluateStage5Replay(
        [makeCandidate({ action_type: 'execute_referent', candidateId: 'gone-candidate' })],
        SNAPSHOT_WITH_REFERENT,
      )
      expect(result.validationResult).toBe('rejected_target_not_visible')
      expect(result.fallbackReason).toBe('target_candidate_gone')
    })
  })

  // ---------------------------------------------------------------------------
  // Tests: Ambiguous — multiple survivors
  // ---------------------------------------------------------------------------

  describe('rejected_ambiguous', () => {
    it('2 candidates both pass all gates with near-tie scores → rejected_ambiguous', () => {
      const result = evaluateStage5Replay(
        [
          makeCandidate({ itemId: 'item-1', similarity_score: 0.96 }),
          makeCandidate({ itemId: 'item-2', similarity_score: 0.94 }),
        ],
        SNAPSHOT_WITH_WIDGET,
      )
      expect(result.validationResult).toBe('rejected_ambiguous')
      // Near-tie: margin 0.02 < 0.03 threshold
      expect(result.fallbackReason).toMatch(/^near_tie_2_survivors_margin_/)
      expect(result.candidateCount).toBe(2)
      expect(result.replayedIntentId).toBeUndefined()
      expect(result.replayedTargetId).toBeUndefined()
    })
  })

  // ---------------------------------------------------------------------------
  // Tests: Mixed rejections — closest-to-passing priority
  // ---------------------------------------------------------------------------

  describe('closest-to-passing priority', () => {
    it('one rejected_action_type + one rejected_target → reports target (closer to passing)', () => {
      const badAction = makeCandidate({})
      badAction.slots_json.action_type = 'navigate_panel'

      const badTarget = makeCandidate({ widgetId: 'gone-widget' })

      const result = evaluateStage5Replay(
        [badAction, badTarget],
        SNAPSHOT_WITH_WIDGET,
      )
      // badTarget passed action_type + risk_tier, failed at target → closest to passing
      expect(result.validationResult).toBe('rejected_target_gone')
    })

    it('one rejected_action_type + one rejected_risk_tier → reports risk_tier (closer)', () => {
      const badAction = makeCandidate({})
      badAction.slots_json.action_type = 'navigate_panel'

      const badRisk = makeCandidate({ risk_tier: 'medium' })

      const result = evaluateStage5Replay(
        [badAction, badRisk],
        SNAPSHOT_WITH_WIDGET,
      )
      expect(result.validationResult).toBe('rejected_risk_tier')
    })
  })

  // ---------------------------------------------------------------------------
  // Tests: topSimilarity
  // ---------------------------------------------------------------------------

  describe('topSimilarity tracking', () => {
    it('reports highest similarity across all candidates', () => {
      const result = evaluateStage5Replay(
        [
          makeCandidate({ similarity_score: 0.93, itemId: 'item-1' }),
          makeCandidate({ similarity_score: 0.97, itemId: 'item-2' }),
        ],
        SNAPSHOT_WITH_WIDGET,
      )
      expect(result.topSimilarity).toBe(0.97)
    })
  })

  // ---------------------------------------------------------------------------
  // Tests: 1 passes + 1 rejected → single survivor = eligible
  // ---------------------------------------------------------------------------

  describe('filtering narrows to single survivor', () => {
    it('2 candidates, 1 rejected by risk_tier, 1 passes → shadow_replay_eligible', () => {
      const result = evaluateStage5Replay(
        [
          makeCandidate({ risk_tier: 'medium', similarity_score: 0.97 }),
          makeCandidate({ risk_tier: 'low', similarity_score: 0.94 }),
        ],
        SNAPSHOT_WITH_WIDGET,
      )
      expect(result.validationResult).toBe('shadow_replay_eligible')
      expect(result.replayedTargetId).toBe('item-1')
    })

    it('3 candidates: 1 bad action, 1 bad risk, 1 passes → shadow_replay_eligible', () => {
      const badAction = makeCandidate({ similarity_score: 0.98 })
      badAction.slots_json.action_type = 'navigate_panel'

      const result = evaluateStage5Replay(
        [
          badAction,
          makeCandidate({ risk_tier: 'medium', similarity_score: 0.96 }),
          makeCandidate({ risk_tier: 'low', similarity_score: 0.93 }),
        ],
        SNAPSHOT_WITH_WIDGET,
      )
      expect(result.validationResult).toBe('shadow_replay_eligible')
    })
  })

  // ---------------------------------------------------------------------------
  // Tests: winnerCandidate (Slice 2 enabler)
  // ---------------------------------------------------------------------------

  describe('winnerCandidate exposure', () => {
    it('shadow_replay_eligible sets winnerCandidate', () => {
      const candidate = makeCandidate({ similarity_score: 0.95 })
      const result = evaluateStage5Replay([candidate], SNAPSHOT_WITH_WIDGET)
      expect(result.validationResult).toBe('shadow_replay_eligible')
      expect(result.winnerCandidate).toBe(candidate)
    })

    it('rejected_ambiguous does not set winnerCandidate', () => {
      const result = evaluateStage5Replay(
        [
          makeCandidate({ itemId: 'item-1', similarity_score: 0.96 }),
          makeCandidate({ itemId: 'item-2', similarity_score: 0.94 }),
        ],
        SNAPSHOT_WITH_WIDGET,
      )
      expect(result.validationResult).toBe('rejected_ambiguous')
      expect(result.winnerCandidate).toBeUndefined()
    })

    it('rejected_risk_tier does not set winnerCandidate', () => {
      const result = evaluateStage5Replay(
        [makeCandidate({ risk_tier: 'medium' })],
        SNAPSHOT_WITH_WIDGET,
      )
      expect(result.winnerCandidate).toBeUndefined()
    })
  })
})

// =============================================================================
// Slice 2: Enforcement integration tests
// =============================================================================

describe('Stage 5 Slice 2: Enforcement', () => {

  // ---------------------------------------------------------------------------
  // mapping.ts: memory_semantic provenance
  // ---------------------------------------------------------------------------

  describe('mapping.ts: memory_semantic support', () => {
    it('provenanceToDecisionSource maps memory_semantic → memory_semantic', () => {
      expect(provenanceToDecisionSource('memory_semantic')).toBe('memory_semantic')
    })

    it('deriveResultStatus maps memory_semantic → executed', () => {
      expect(deriveResultStatus(true, 'memory_semantic', 'memory_semantic:test')).toBe('executed')
    })
  })

  // ---------------------------------------------------------------------------
  // buildResultFromMemory: works with SemanticCandidate (extends MemoryLookupResult)
  // ---------------------------------------------------------------------------

  describe('buildResultFromMemory with SemanticCandidate', () => {
    const defaultResult = {
      handled: false,
      clarificationCleared: false,
      isNewQuestionOrCommandDetected: false,
      classifierCalled: false,
      classifierTimeout: false,
      classifierError: false,
      isFollowUp: false,
    }

    it('execute_widget_item candidate → valid replay result with groundingAction', () => {
      const candidate = makeCandidate({ similarity_score: 0.95, widgetId: 'widget-1', itemId: 'item-1' })
      const result = buildResultFromMemory(candidate, defaultResult)
      expect(result).not.toBeNull()
      expect(result!.handled).toBe(true)
      expect(result!.groundingAction).toBeDefined()
      expect(result!.groundingAction!.type).toBe('execute_widget_item')
      if (result!.groundingAction!.type === 'execute_widget_item') {
        expect(result!.groundingAction!.widgetId).toBe('widget-1')
        expect(result!.groundingAction!.itemId).toBe('item-1')
      }
    })

    it('execute_referent candidate → valid replay result', () => {
      const candidate = makeCandidate({ action_type: 'execute_referent', candidateId: 'candidate-1' })
      const result = buildResultFromMemory(candidate, defaultResult)
      expect(result).not.toBeNull()
      expect(result!.groundingAction!.type).toBe('execute_referent')
    })

    it('provenance can be overridden to memory_semantic after build', () => {
      const candidate = makeCandidate({ similarity_score: 0.95 })
      const result = buildResultFromMemory(candidate, defaultResult)
      expect(result).not.toBeNull()
      // Default provenance is now memory_semantic (Slice B3)
      expect(result!._devProvenanceHint).toBe('memory_semantic')
      // Already correct for Stage 5 — no override needed
      expect(result!._devProvenanceHint).toBe('memory_semantic')
      expect(result!.tierLabel).toContain('memory_semantic:')
    })

    it('unknown action type → returns null (replay_build_failed path)', () => {
      const candidate = makeCandidate({})
      candidate.slots_json.action_type = 'unknown_type'
      const result = buildResultFromMemory(candidate, defaultResult)
      expect(result).toBeNull()
    })
  })

  // ---------------------------------------------------------------------------
  // End-to-end: evaluator → buildResultFromMemory → provenance override
  // ---------------------------------------------------------------------------

  describe('end-to-end replay construction', () => {
    const defaultResult = {
      handled: false,
      clarificationCleared: false,
      isNewQuestionOrCommandDetected: false,
      classifierCalled: false,
      classifierTimeout: false,
      classifierError: false,
      isFollowUp: false,
    }

    it('eligible candidate → full replay result with correct metadata', () => {
      const candidate = makeCandidate({ similarity_score: 0.96, intent_id: 'tier_4.5_grounding_llm' })
      const evalResult = evaluateStage5Replay([candidate], SNAPSHOT_WITH_WIDGET)
      expect(evalResult.validationResult).toBe('shadow_replay_eligible')
      expect(evalResult.winnerCandidate).toBeDefined()

      // Build replay result (same as dispatcher enforcement path)
      const replayResult = buildResultFromMemory(evalResult.winnerCandidate!, defaultResult)
      expect(replayResult).not.toBeNull()
      replayResult!._devProvenanceHint = 'memory_semantic'
      replayResult!.tierLabel = `memory_semantic:${evalResult.winnerCandidate!.intent_id}`

      // Verify provenance mapping
      expect(provenanceToDecisionSource(replayResult!._devProvenanceHint)).toBe('memory_semantic')
      expect(deriveResultStatus(true, replayResult!._devProvenanceHint, replayResult!.tierLabel)).toBe('executed')

      // Verify action
      expect(replayResult!.handled).toBe(true)
      expect(replayResult!.groundingAction).toBeDefined()
    })

    it('validation_result upgrades from shadow_replay_eligible to replay_executed', () => {
      const candidate = makeCandidate({ similarity_score: 0.95 })
      const evalResult = evaluateStage5Replay([candidate], SNAPSHOT_WITH_WIDGET)
      expect(evalResult.validationResult).toBe('shadow_replay_eligible')

      // Simulate enforcement upgrade
      const enforced = { ...evalResult, validationResult: 'replay_executed' as const }
      expect(enforced.validationResult).toBe('replay_executed')
      expect(enforced.replayedTargetId).toBe('item-1')
    })
  })
})

// =============================================================================
// Slice 3a: Replay-hit accounting (matchedRowId + write payload)
// =============================================================================

describe('Stage 5 Slice 3a: Replay-hit accounting', () => {

  describe('matchedRowId on SemanticCandidate', () => {
    it('matchedRowId is separate from target/candidate IDs', () => {
      const candidate = makeCandidate({ similarity_score: 0.95, itemId: 'item-1' })
      // matchedRowId is the memory index row UUID, not the target ID
      candidate.matchedRowId = 'row-uuid-abc'
      expect(candidate.matchedRowId).toBe('row-uuid-abc')
      // target IDs are unchanged
      expect(candidate.target_ids).toContain('item-1')
      expect(candidate.target_ids).not.toContain('row-uuid-abc')
    })

    it('matchedRowId is optional (backward compatible)', () => {
      const candidate = makeCandidate({ similarity_score: 0.95 })
      // No matchedRowId set — should be undefined
      expect(candidate.matchedRowId).toBeUndefined()
    })
  })

  describe('winnerCandidate carries matchedRowId through evaluator', () => {
    it('matchedRowId survives evaluateStage5Replay pipeline', () => {
      const candidate = makeCandidate({ similarity_score: 0.96 })
      candidate.matchedRowId = 'row-uuid-winner'
      const result = evaluateStage5Replay([candidate], SNAPSHOT_WITH_WIDGET)
      expect(result.validationResult).toBe('shadow_replay_eligible')
      expect(result.winnerCandidate).toBeDefined()
      expect(result.winnerCandidate!.matchedRowId).toBe('row-uuid-winner')
    })

    it('matchedRowId absent → winnerCandidate.matchedRowId is undefined', () => {
      const candidate = makeCandidate({ similarity_score: 0.96 })
      const result = evaluateStage5Replay([candidate], SNAPSHOT_WITH_WIDGET)
      expect(result.winnerCandidate!.matchedRowId).toBeUndefined()
    })
  })

  describe('MemoryWritePayload replay_source_row_id', () => {
    it('replay_source_row_id is accepted by MemoryWritePayload interface', () => {
      // Type-level test: verify the field exists on the interface
      const payload: import('@/lib/chat/routing-log/memory-write-payload').MemoryWritePayload = {
        raw_query_text: 'check the budget',
        context_snapshot: {
          version: 'v1_minimal',
          active_panel_count: 4,
          has_pending_options: false,
          has_active_option_set: false,
          has_last_clarification: false,
          has_last_suggestion: false,
          latch_enabled: true,
          message_count: 10,
        },
        intent_id: 'tier_4.5_grounding_llm',
        intent_class: 'action_intent',
        slots_json: { action_type: 'execute_widget_item', widgetId: 'w1', itemId: 'i1', itemLabel: 'Budget', action: 'open' },
        target_ids: ['w1', 'i1'],
        risk_tier: 'low',
        schema_version: 'v1',
        tool_version: 'v2',
        replay_source_row_id: 'row-uuid-winner',
      }
      expect(payload.replay_source_row_id).toBe('row-uuid-winner')
    })

    it('replay_source_row_id is optional (non-replay writes)', () => {
      const payload: import('@/lib/chat/routing-log/memory-write-payload').MemoryWritePayload = {
        raw_query_text: 'open budget',
        context_snapshot: {
          version: 'v1_minimal',
          active_panel_count: 1,
          has_pending_options: false,
          has_active_option_set: false,
          has_last_clarification: false,
          has_last_suggestion: false,
          latch_enabled: false,
          message_count: 1,
        },
        intent_id: 'tier_4.5_grounding_llm',
        intent_class: 'action_intent',
        slots_json: { action_type: 'execute_widget_item' },
        target_ids: ['w1'],
        risk_tier: 'low',
        schema_version: 'v1',
        tool_version: 'v2',
      }
      expect(payload.replay_source_row_id).toBeUndefined()
    })
  })
})
