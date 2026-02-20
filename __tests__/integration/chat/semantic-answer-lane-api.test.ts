/**
 * API-Level Integration Tests for Semantic Answer Lane v1 (Phase 10).
 *
 * Tests the full intent→resolve→guard pipeline as it runs in route.ts.
 * Mocks the LLM call but exercises real resolvers and guard logic.
 *
 * Test categories:
 * 1. Intent parsing → resolver → response (flag on)
 * 2. Server-side guard blocks non-answer actions
 * 3. Flag-off remap behavior
 * 4. No-execution guarantee
 */

import { resolveIntent } from '@/lib/chat/intent-resolver'
import { parseIntentResponse } from '@/lib/chat/intent-schema'
import type { IntentResponse } from '@/lib/chat/intent-schema'
import type { ResolutionContext } from '@/lib/chat/resolution-types'

// Replicate the API-level guard logic from route.ts for testing
function applySemanticLaneGuards(
  intent: IntentResponse,
  resolution: { success: boolean; action: string; message: string; [key: string]: unknown },
  isSemanticLaneEnabled: boolean,
): { intent: IntentResponse; resolution: typeof resolution } {
  const SEMANTIC_ANSWER_INTENTS = new Set(['explain_last_action', 'summarize_recent_activity'])

  // 5a: Flag-off remap
  if (!isSemanticLaneEnabled && SEMANTIC_ANSWER_INTENTS.has(intent.intent)) {
    intent = {
      ...intent,
      intent: intent.intent === 'explain_last_action' ? 'last_action' : 'unsupported',
    }
  }

  // 5b: Answer-only enforcement (only when flag on)
  if (isSemanticLaneEnabled && SEMANTIC_ANSWER_INTENTS.has(intent.intent)) {
    const ALLOWED_ACTIONS = new Set(['inform', 'answer_from_context', 'general_answer', 'error'])

    if (!ALLOWED_ACTIONS.has(resolution.action)) {
      resolution = {
        ...resolution,
        action: 'inform',
        success: true,
        message: resolution.message
          || "I can answer questions about your activity, but I won't perform actions from here.",
      }
    }
  }

  return { intent, resolution }
}

const baseContext: ResolutionContext = {
  currentEntryId: 'entry-1',
  currentEntryName: 'Test Entry',
  entries: [{ id: 'entry-1', name: 'Test Entry' }],
  workspaces: [{ id: 'ws-1', name: 'Sprint 6', entryId: 'entry-1' }],
  currentWorkspaceId: 'ws-1',
  currentWorkspaceName: 'Sprint 6',
  panels: [],
  sessionState: {
    lastAction: {
      type: 'open_workspace',
      workspaceName: 'Sprint 6',
      timestamp: Date.now() - 30000,
    },
    actionHistory: [
      { type: 'go_to_dashboard', targetType: 'workspace', targetName: 'Dashboard', timestamp: Date.now() - 120000 },
      { type: 'open_workspace', targetType: 'workspace', targetName: 'Sprint 5', timestamp: Date.now() - 90000 },
      { type: 'open_workspace', targetType: 'workspace', targetName: 'Sprint 6', timestamp: Date.now() - 30000 },
    ],
  },
}

// =============================================================================
// Intent Parsing Tests (flag on)
// =============================================================================

describe('intent parsing → resolver (flag on)', () => {
  test('1. LLM returns explain_last_action → resolver returns action: inform', async () => {
    const rawLLMResponse = { intent: 'explain_last_action', args: {} }
    const parsedIntent = parseIntentResponse(rawLLMResponse)
    expect(parsedIntent.intent).toBe('explain_last_action')

    const resolution = await resolveIntent(parsedIntent, baseContext)
    expect(resolution.action).toBe('inform')
    expect(resolution.success).toBe(true)
    expect(resolution.message).toContain('Sprint 6')
  })

  test('2. LLM returns summarize_recent_activity → resolver returns action: inform', async () => {
    const rawLLMResponse = { intent: 'summarize_recent_activity', args: {} }
    const parsedIntent = parseIntentResponse(rawLLMResponse)
    expect(parsedIntent.intent).toBe('summarize_recent_activity')

    const resolution = await resolveIntent(parsedIntent, baseContext)
    expect(resolution.action).toBe('inform')
    expect(resolution.success).toBe(true)
    expect(resolution.message).toContain('3 action')
  })
})

// =============================================================================
// Server-Side Guard Tests
// =============================================================================

describe('server-side answer-only guard', () => {
  test('3. explain_last_action + navigate_workspace → blocked to inform', () => {
    const intent: IntentResponse = { intent: 'explain_last_action', args: {} }
    const badResolution = {
      success: true,
      action: 'navigate_workspace',
      message: 'Opening workspace Sprint 6',
    }

    const { resolution } = applySemanticLaneGuards(intent, badResolution, true)
    expect(resolution.action).toBe('inform')
    expect(resolution.success).toBe(true)
  })

  test('4. summarize_recent_activity + open_panel → blocked to inform', () => {
    const intent: IntentResponse = { intent: 'summarize_recent_activity', args: {} }
    const badResolution = {
      success: true,
      action: 'open_panel',
      message: 'Opening Recent panel',
    }

    const { resolution } = applySemanticLaneGuards(intent, badResolution, true)
    expect(resolution.action).toBe('inform')
  })

  test('guard does not block answer_from_context', () => {
    const intent: IntentResponse = { intent: 'explain_last_action', args: {} }
    const goodResolution = {
      success: true,
      action: 'answer_from_context',
      message: 'You opened Sprint 6 because...',
    }

    const { resolution } = applySemanticLaneGuards(intent, goodResolution, true)
    expect(resolution.action).toBe('answer_from_context')
  })

  test('guard does not block error action', () => {
    const intent: IntentResponse = { intent: 'explain_last_action', args: {} }
    const errorResolution = {
      success: false,
      action: 'error',
      message: 'Something went wrong',
    }

    const { resolution } = applySemanticLaneGuards(intent, errorResolution, true)
    expect(resolution.action).toBe('error')
  })
})

// =============================================================================
// Flag-Off Remap Tests
// =============================================================================

describe('flag-off remap behavior', () => {
  test('5. explain_last_action → remapped to last_action, resolves via resolveLastAction', async () => {
    const rawLLMResponse = { intent: 'explain_last_action', args: {} }
    const parsedIntent = parseIntentResponse(rawLLMResponse)

    // Apply flag-off remap
    const { intent: remappedIntent } = applySemanticLaneGuards(parsedIntent, { success: true, action: 'inform', message: '' }, false)
    expect(remappedIntent.intent).toBe('last_action')

    // Resolve with remapped intent
    const resolution = await resolveIntent(remappedIntent, baseContext)
    expect(resolution.success).toBe(true)
    expect(resolution.action).toBe('inform')
    expect(resolution.message).toContain('Sprint 6')
  })

  test('6. summarize_recent_activity → remapped to unsupported, safe fallback', async () => {
    const rawLLMResponse = { intent: 'summarize_recent_activity', args: {} }
    const parsedIntent = parseIntentResponse(rawLLMResponse)

    // Apply flag-off remap
    const { intent: remappedIntent } = applySemanticLaneGuards(parsedIntent, { success: true, action: 'inform', message: '' }, false)
    expect(remappedIntent.intent).toBe('unsupported')

    // Resolve with remapped intent
    const resolution = await resolveIntent(remappedIntent, baseContext)
    expect(resolution.success).toBe(false)
    expect(resolution.action).toBe('error')
  })

  test('7. flag-off remap is safe fallback — no new execution behavior', async () => {
    // Verify that both remapped intents produce only inform/error actions
    const intentsToRemap = ['explain_last_action', 'summarize_recent_activity'] as const

    for (const intentName of intentsToRemap) {
      const rawLLMResponse = { intent: intentName, args: {} }
      const parsedIntent = parseIntentResponse(rawLLMResponse)
      const { intent: remappedIntent } = applySemanticLaneGuards(parsedIntent, { success: true, action: 'inform', message: '' }, false)

      const resolution = await resolveIntent(remappedIntent, baseContext)
      // Should never produce navigation/execution actions
      expect(['inform', 'error']).toContain(resolution.action)
    }
  })
})

// =============================================================================
// No-Execution Guarantee Tests
// =============================================================================

describe('no-execution guarantee (flag on)', () => {
  const EXECUTION_ACTIONS = new Set([
    'navigate_workspace', 'open_panel', 'rename_workspace',
    'delete_workspace', 'create_workspace', 'go_to_dashboard',
    'go_home', 'move_items', 'open_panel_drawer',
  ])

  test('8. semantic intents never produce execution actions', async () => {
    const semanticIntents: IntentResponse[] = [
      { intent: 'explain_last_action', args: {} },
      { intent: 'summarize_recent_activity', args: {} },
    ]

    for (const intent of semanticIntents) {
      const resolution = await resolveIntent(intent, baseContext)

      // Resolver itself should return inform
      expect(resolution.action).toBe('inform')
      expect(EXECUTION_ACTIONS.has(resolution.action)).toBe(false)

      // Even if we simulate a buggy resolver returning execution action,
      // the guard catches it
      const badResolution = { success: true, action: 'navigate_workspace', message: 'bug' }
      const { resolution: guarded } = applySemanticLaneGuards(intent, badResolution, true)
      expect(guarded.action).toBe('inform')
      expect(EXECUTION_ACTIONS.has(guarded.action)).toBe(false)
    }
  })
})
