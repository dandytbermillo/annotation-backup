import { buildResultFromMemory } from '@/lib/chat/routing-log/memory-action-builder'
import type { MemoryLookupResult } from '@/lib/chat/routing-log/memory-reader'

// --- Test helpers ---

const DEFAULT_RESULT = {
  handled: false,
  clarificationCleared: false,
  isNewQuestionOrCommandDetected: false,
  classifierCalled: false,
  classifierTimeout: false,
  classifierError: false,
  isFollowUp: false,
}

function makeWidgetItemCandidate(): MemoryLookupResult {
  return {
    intent_id: 'grounding_widget_item_execute',
    intent_class: 'action_intent',
    slots_json: {
      action_type: 'execute_widget_item',
      widgetId: 'recent-panel',
      segmentId: 'seg-1',
      itemId: 'item-1',
      itemLabel: 'Resume.pdf',
      action: 'open',
    },
    target_ids: ['recent-panel', 'item-1'],
    risk_tier: 'medium',
    success_count: 3,
    context_fingerprint: 'abc123',
  }
}

function makeReferentCandidate(): MemoryLookupResult {
  return {
    intent_id: 'grounding_referent_execute',
    intent_class: 'action_intent',
    slots_json: {
      action_type: 'execute_referent',
      syntheticMessage: 'open Resume.pdf',
      candidateId: 'cand-1',
      candidateLabel: 'Resume.pdf',
      actionHint: 'open',
    },
    target_ids: ['cand-1'],
    risk_tier: 'medium',
    success_count: 5,
    context_fingerprint: 'abc123',
  }
}

// --- Tests ---

describe('buildResultFromMemory', () => {
  describe('execute_widget_item', () => {
    it('returns correct groundingAction', () => {
      const result = buildResultFromMemory(makeWidgetItemCandidate(), DEFAULT_RESULT)
      expect(result).not.toBeNull()
      expect(result!.groundingAction).toEqual({
        type: 'execute_widget_item',
        widgetId: 'recent-panel',
        segmentId: 'seg-1',
        itemId: 'item-1',
        itemLabel: 'Resume.pdf',
        action: 'open',
      })
    })

    it('handles null segmentId → undefined', () => {
      const candidate = makeWidgetItemCandidate()
      candidate.slots_json.segmentId = null
      const result = buildResultFromMemory(candidate, DEFAULT_RESULT)
      expect(result!.groundingAction!.type).toBe('execute_widget_item')
      if (result!.groundingAction!.type === 'execute_widget_item') {
        expect(result!.groundingAction!.segmentId).toBeUndefined()
      }
    })
  })

  describe('execute_referent', () => {
    it('returns correct groundingAction', () => {
      const result = buildResultFromMemory(makeReferentCandidate(), DEFAULT_RESULT)
      expect(result).not.toBeNull()
      expect(result!.groundingAction).toEqual({
        type: 'execute_referent',
        syntheticMessage: 'open Resume.pdf',
        candidateId: 'cand-1',
        candidateLabel: 'Resume.pdf',
        actionHint: 'open',
      })
    })

    it('handles null actionHint → undefined', () => {
      const candidate = makeReferentCandidate()
      candidate.slots_json.actionHint = null
      const result = buildResultFromMemory(candidate, DEFAULT_RESULT)
      expect(result!.groundingAction!.type).toBe('execute_referent')
      if (result!.groundingAction!.type === 'execute_referent') {
        expect(result!.groundingAction!.actionHint).toBeUndefined()
      }
    })
  })

  describe('metadata', () => {
    it('sets handled: true', () => {
      const result = buildResultFromMemory(makeWidgetItemCandidate(), DEFAULT_RESULT)
      expect(result!.handled).toBe(true)
    })

    it('sets handledByTier: undefined (memory lane, not a tier)', () => {
      const result = buildResultFromMemory(makeWidgetItemCandidate(), DEFAULT_RESULT)
      expect(result!.handledByTier).toBeUndefined()
    })

    it('sets tierLabel to memory_semantic:<intent_id>', () => {
      const result = buildResultFromMemory(makeWidgetItemCandidate(), DEFAULT_RESULT)
      expect(result!.tierLabel).toBe('memory_semantic:grounding_widget_item_execute')
    })

    it('sets _devProvenanceHint to memory_semantic (Gate 2: distinct from deterministic)', () => {
      const result = buildResultFromMemory(makeWidgetItemCandidate(), DEFAULT_RESULT)
      expect(result!._devProvenanceHint).toBe('memory_semantic')
    })

    it('attaches _memoryCandidate for commit-point revalidation (Gate 1)', () => {
      const candidate = makeWidgetItemCandidate()
      const result = buildResultFromMemory(candidate, DEFAULT_RESULT)
      expect(result!._memoryCandidate).toBe(candidate)
    })

    it('preserves defaultResult fields', () => {
      const result = buildResultFromMemory(makeWidgetItemCandidate(), DEFAULT_RESULT)
      expect(result!.clarificationCleared).toBe(false)
      expect(result!.isNewQuestionOrCommandDetected).toBe(false)
      expect(result!.classifierCalled).toBe(false)
      expect(result!.isFollowUp).toBe(false)
    })
  })

  describe('Phase 5 navigation replay reconstruction', () => {
    it('open_entry → navigationReplayAction with all required fields', () => {
      const candidate: MemoryLookupResult = {
        intent_id: 'open_entry',
        intent_class: 'action_intent',
        slots_json: {
          action_type: 'open_entry',
          entryId: 'entry-123',
          entryName: 'budget100 B',
          dashboardWorkspaceId: 'ws-dash-1',
        },
        target_ids: ['entry-123'],
        risk_tier: 'medium',
        success_count: 2,
        context_fingerprint: 'fp-1',
      }
      const result = buildResultFromMemory(candidate, DEFAULT_RESULT)
      expect(result).not.toBeNull()
      expect(result!.navigationReplayAction).toEqual({
        type: 'open_entry',
        entryId: 'entry-123',
        entryName: 'budget100 B',
        dashboardWorkspaceId: 'ws-dash-1',
      })
      expect(result!.groundingAction).toBeUndefined()
      expect(result!._devProvenanceHint).toBe('memory_semantic')
    })

    it('open_workspace → navigationReplayAction with all required fields', () => {
      const candidate: MemoryLookupResult = {
        intent_id: 'open_workspace',
        intent_class: 'action_intent',
        slots_json: {
          action_type: 'open_workspace',
          workspaceId: 'ws-456',
          workspaceName: 'budget100',
          entryId: 'entry-parent',
          entryName: 'Home',
          isDefault: false,
        },
        target_ids: ['ws-456'],
        risk_tier: 'medium',
        success_count: 1,
        context_fingerprint: 'fp-2',
      }
      const result = buildResultFromMemory(candidate, DEFAULT_RESULT)
      expect(result).not.toBeNull()
      expect(result!.navigationReplayAction).toEqual({
        type: 'open_workspace',
        workspaceId: 'ws-456',
        workspaceName: 'budget100',
        entryId: 'entry-parent',
        entryName: 'Home',
        isDefault: false,
      })
      expect(result!.groundingAction).toBeUndefined()
    })

    it('open_panel → navigationReplayAction with panelId and panelTitle', () => {
      const candidate: MemoryLookupResult = {
        intent_id: 'open_panel',
        intent_class: 'action_intent',
        slots_json: {
          action_type: 'open_panel',
          panelId: 'links-b',
          panelTitle: 'Links Panel B',
        },
        target_ids: ['links-b'],
        risk_tier: 'medium',
        success_count: 4,
        context_fingerprint: 'fp-3',
      }
      const result = buildResultFromMemory(candidate, DEFAULT_RESULT)
      expect(result).not.toBeNull()
      expect(result!.navigationReplayAction).toEqual({
        type: 'open_panel',
        panelId: 'links-b',
        panelTitle: 'Links Panel B',
      })
      expect(result!.groundingAction).toBeUndefined()
    })

    it('go_home → navigationReplayAction with type only', () => {
      const candidate: MemoryLookupResult = {
        intent_id: 'go_home',
        intent_class: 'action_intent',
        slots_json: { action_type: 'go_home' },
        target_ids: [],
        risk_tier: 'medium',
        success_count: 3,
        context_fingerprint: 'fp-4',
      }
      const result = buildResultFromMemory(candidate, DEFAULT_RESULT)
      expect(result).not.toBeNull()
      expect(result!.navigationReplayAction).toEqual({ type: 'go_home' })
      expect(result!.groundingAction).toBeUndefined()
    })
  })

  describe('unknown action type', () => {
    it('returns null for unknown action_type', () => {
      const candidate: MemoryLookupResult = {
        ...makeWidgetItemCandidate(),
        slots_json: { action_type: 'unknown_thing', foo: 'bar' },
      }
      const result = buildResultFromMemory(candidate, DEFAULT_RESULT)
      expect(result).toBeNull()
    })

    it('returns null when action_type is missing', () => {
      const candidate: MemoryLookupResult = {
        ...makeWidgetItemCandidate(),
        slots_json: { widgetId: 'w1' },
      }
      const result = buildResultFromMemory(candidate, DEFAULT_RESULT)
      expect(result).toBeNull()
    })
  })
})
