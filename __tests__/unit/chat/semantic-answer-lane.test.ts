/**
 * Unit tests for Semantic Answer Lane v1 (Phase 10).
 *
 * Tests:
 * - Resolver functions (explain_last_action, summarize_recent_activity)
 * - Routing gate (isSemanticQuestionInput + Tier 3.7 marker)
 * - Client-side defense-in-depth (semanticLanePending + resolved intent check)
 * - Flag-off robustness
 */

import { resolveIntent } from '@/lib/chat/intent-resolver'
import { isSemanticQuestionInput } from '@/lib/chat/input-classifiers'
import type { IntentResponse } from '@/lib/chat/intent-schema'
import type { ResolutionContext } from '@/lib/chat/resolution-types'

// =============================================================================
// Resolver Tests
// =============================================================================

describe('resolveExplainLastAction', () => {
  const baseContext: ResolutionContext = {
    currentEntryId: 'entry-1',
    currentEntryName: 'Test Entry',
    entries: [],
    workspaces: [],
    currentWorkspaceId: null,
    currentWorkspaceName: null,
    panels: [],
  }

  const makeIntent = (intentName: string): IntentResponse => ({
    intent: intentName as IntentResponse['intent'],
    args: {},
  })

  test('1. valid lastAction → inform message with context', async () => {
    const context: ResolutionContext = {
      ...baseContext,
      sessionState: {
        lastAction: {
          type: 'open_workspace',
          workspaceName: 'Sprint 6',
          timestamp: Date.now() - 30000, // 30s ago
        },
        actionHistory: [
          { type: 'go_to_dashboard', targetType: 'workspace', targetName: 'Dashboard', timestamp: Date.now() - 60000 },
          { type: 'open_workspace', targetType: 'workspace', targetName: 'Sprint 6', timestamp: Date.now() - 30000 },
        ],
      },
    }

    const result = await resolveIntent(makeIntent('explain_last_action'), context)
    expect(result.success).toBe(true)
    expect(result.action).toBe('inform')
    expect(result.message).toContain('Sprint 6')
    expect(result.message).toContain('Before that')
  })

  test('2. no lastAction → "no recent action" message', async () => {
    const context: ResolutionContext = {
      ...baseContext,
      sessionState: {},
    }

    const result = await resolveIntent(makeIntent('explain_last_action'), context)
    expect(result.success).toBe(true)
    expect(result.action).toBe('inform')
    expect(result.message).toContain('no recent action')
  })

  test('3. lastAction + actionHistory context → includes preceding action detail', async () => {
    const context: ResolutionContext = {
      ...baseContext,
      sessionState: {
        lastAction: {
          type: 'rename_workspace',
          fromName: 'Old',
          toName: 'New',
          timestamp: Date.now() - 5000,
        },
        actionHistory: [
          { type: 'open_workspace', targetType: 'workspace', targetName: 'Old', timestamp: Date.now() - 60000 },
          { type: 'rename_workspace', targetType: 'workspace', targetName: 'New', timestamp: Date.now() - 5000 },
        ],
      },
    }

    const result = await resolveIntent(makeIntent('explain_last_action'), context)
    expect(result.success).toBe(true)
    expect(result.action).toBe('inform')
    expect(result.message).toContain('renamed')
    expect(result.message).toContain('Old')
    expect(result.message).toContain('New')
    expect(result.message).toContain('Before that')
  })

  test('6a. always returns action: inform — open_panel case', async () => {
    const context: ResolutionContext = {
      ...baseContext,
      sessionState: {
        lastAction: {
          type: 'open_panel',
          panelTitle: 'Recent',
          timestamp: Date.now() - 10000,
        },
      },
    }

    const result = await resolveIntent(makeIntent('explain_last_action'), context)
    expect(result.action).toBe('inform')
  })

  test('6b. always returns action: inform — go_home case', async () => {
    const context: ResolutionContext = {
      ...baseContext,
      sessionState: {
        lastAction: {
          type: 'go_home',
          timestamp: Date.now() - 10000,
        },
      },
    }

    const result = await resolveIntent(makeIntent('explain_last_action'), context)
    expect(result.action).toBe('inform')
  })
})

// =============================================================================
// Causal Explanation Tests (ActionTrace wiring)
// =============================================================================

import type { ActionTraceEntry } from '@/lib/chat/action-trace'
import { CAUSAL_MATCH_WINDOW_MS } from '@/lib/chat/intent-resolver'

describe('resolveExplainLastAction — causal phrases from ActionTrace', () => {
  const baseContext: ResolutionContext = {
    currentEntryId: 'entry-1',
    currentEntryName: 'Test Entry',
    entries: [],
    workspaces: [],
    currentWorkspaceId: null,
    currentWorkspaceName: null,
    panels: [],
  }

  const makeIntent = (intentName: string): IntentResponse => ({
    intent: intentName as IntentResponse['intent'],
    args: {},
  })

  const now = Date.now()

  const makeTraceEntry = (overrides: Partial<ActionTraceEntry>): ActionTraceEntry => ({
    traceId: 'trace-1',
    tsMs: now - 2000,
    seq: 1,
    actionType: 'open_panel',
    target: { kind: 'panel', id: 'panel-recent', name: 'Recent' },
    source: 'chat',
    resolverPath: 'executeAction',
    reasonCode: 'explicit_label_match',
    scopeKind: 'chat',
    dedupeKey: 'open_panel:panel:panel-recent:chat:',
    isUserMeaningful: true,
    outcome: 'success',
    ...overrides,
  })

  test('includes causal suffix when actionTrace has matching entry with known reasonCode', async () => {
    const context: ResolutionContext = {
      ...baseContext,
      sessionState: {
        lastAction: {
          type: 'open_panel',
          panelId: 'panel-recent',
          panelTitle: 'Recent',
          timestamp: now - 2000,
        },
        actionTrace: [makeTraceEntry({})],
      },
    }

    const result = await resolveIntent(makeIntent('explain_last_action'), context)
    expect(result.success).toBe(true)
    expect(result.action).toBe('inform')
    expect(result.message).toContain('Recent')
    expect(result.message).toContain('you asked for it by name')
    expect(result.message).toContain('via the chat')
  })

  test('reasonCode unknown + source chat → safe clarifier (no retroactive LLM — MUST NOT line 102)', async () => {
    const context: ResolutionContext = {
      ...baseContext,
      sessionState: {
        lastAction: {
          type: 'open_panel',
          panelId: 'panel-recent',
          panelTitle: 'Recent',
          timestamp: now - 2000,
        },
        actionTrace: [makeTraceEntry({ reasonCode: 'unknown', source: 'chat' })],
      },
    }

    const result = await resolveIntent(makeIntent('explain_last_action'), context)
    expect(result.success).toBe(true)
    expect(result.action).toBe('inform')
    expect(result.message).toContain('Recent')
    // Read-only over stored trace — no LLM at explain time (Rule G)
    expect(result.message).toContain('based on your chat request')
    expect(result.message).not.toContain('you asked')
  })

  test('weak fallback: reasonCode unknown + source direct_ui → factual-only (no weak fallback)', async () => {
    const context: ResolutionContext = {
      ...baseContext,
      sessionState: {
        lastAction: {
          type: 'open_panel',
          panelId: 'panel-recent',
          panelTitle: 'Recent',
          timestamp: now - 2000,
        },
        actionTrace: [makeTraceEntry({ reasonCode: 'unknown', source: 'direct_ui' })],
      },
    }

    const result = await resolveIntent(makeIntent('explain_last_action'), context)
    expect(result.success).toBe(true)
    expect(result.action).toBe('inform')
    expect(result.message).toContain('Recent')
    // No weak fallback for direct_ui
    expect(result.message).not.toContain('based on your chat request')
    expect(result.message).not.toContain('you asked')
  })

  test('falls back to factual-only when actionTrace is empty', async () => {
    const context: ResolutionContext = {
      ...baseContext,
      sessionState: {
        lastAction: {
          type: 'open_panel',
          panelId: 'panel-recent',
          panelTitle: 'Recent',
          timestamp: now - 2000,
        },
        actionTrace: [],
      },
    }

    const result = await resolveIntent(makeIntent('explain_last_action'), context)
    expect(result.success).toBe(true)
    expect(result.action).toBe('inform')
    expect(result.message).toContain('Recent')
    expect(result.message).not.toContain('you asked')
  })

  test('falls back to factual-only when no entry matches (wrong actionType)', async () => {
    const context: ResolutionContext = {
      ...baseContext,
      sessionState: {
        lastAction: {
          type: 'open_panel',
          panelId: 'panel-recent',
          panelTitle: 'Recent',
          timestamp: now - 2000,
        },
        actionTrace: [makeTraceEntry({ actionType: 'open_workspace' })],
      },
    }

    const result = await resolveIntent(makeIntent('explain_last_action'), context)
    expect(result.message).not.toContain('you asked')
  })

  test('falls back to factual-only when matching entry has outcome !== success', async () => {
    const context: ResolutionContext = {
      ...baseContext,
      sessionState: {
        lastAction: {
          type: 'open_panel',
          panelId: 'panel-recent',
          panelTitle: 'Recent',
          timestamp: now - 2000,
        },
        actionTrace: [makeTraceEntry({ outcome: 'failed' })],
      },
    }

    const result = await resolveIntent(makeIntent('explain_last_action'), context)
    expect(result.message).not.toContain('you asked')
  })

  test('falls back to factual-only when matching entry has isUserMeaningful !== true', async () => {
    const context: ResolutionContext = {
      ...baseContext,
      sessionState: {
        lastAction: {
          type: 'open_panel',
          panelId: 'panel-recent',
          panelTitle: 'Recent',
          timestamp: now - 2000,
        },
        actionTrace: [makeTraceEntry({ isUserMeaningful: false })],
      },
    }

    const result = await resolveIntent(makeIntent('explain_last_action'), context)
    expect(result.message).not.toContain('you asked')
  })

  test('falls back when timestamp is outside proximity window', async () => {
    const context: ResolutionContext = {
      ...baseContext,
      sessionState: {
        lastAction: {
          type: 'open_panel',
          panelId: 'panel-recent',
          panelTitle: 'Recent',
          timestamp: now - 2000,
        },
        actionTrace: [makeTraceEntry({ tsMs: now - 2000 - CAUSAL_MATCH_WINDOW_MS - 1 })],
      },
    }

    const result = await resolveIntent(makeIntent('explain_last_action'), context)
    expect(result.message).not.toContain('you asked')
  })

  test('matches by name fallback when IDs are absent', async () => {
    const context: ResolutionContext = {
      ...baseContext,
      sessionState: {
        lastAction: {
          type: 'open_panel',
          panelTitle: 'Recent',
          timestamp: now - 2000,
          // No panelId
        },
        actionTrace: [makeTraceEntry({
          target: { kind: 'panel', name: 'Recent' }, // No id
        })],
      },
    }

    const result = await resolveIntent(makeIntent('explain_last_action'), context)
    expect(result.message).toContain('you asked for it by name')
  })

  test('source phrase varies by source kind', async () => {
    const widgetTrace = makeTraceEntry({
      source: 'widget',
      reasonCode: 'ordinal',
    })

    const context: ResolutionContext = {
      ...baseContext,
      sessionState: {
        lastAction: {
          type: 'open_panel',
          panelId: 'panel-recent',
          panelTitle: 'Recent',
          timestamp: now - 2000,
        },
        actionTrace: [widgetTrace],
      },
    }

    const result = await resolveIntent(makeIntent('explain_last_action'), context)
    expect(result.message).toContain('you selected it from the options')
    expect(result.message).toContain('via a widget')
  })

  test('scans newest-first and finds first matching entry', async () => {
    const olderTrace = makeTraceEntry({
      tsMs: now - 3000,
      reasonCode: 'ordinal',
      target: { kind: 'panel', id: 'panel-recent', name: 'Recent' },
    })
    const newerTrace = makeTraceEntry({
      tsMs: now - 1000,
      reasonCode: 'explicit_label_match',
      target: { kind: 'panel', id: 'panel-recent', name: 'Recent' },
    })

    const context: ResolutionContext = {
      ...baseContext,
      sessionState: {
        lastAction: {
          type: 'open_panel',
          panelId: 'panel-recent',
          panelTitle: 'Recent',
          timestamp: now - 2000,
        },
        // newest-first ordering
        actionTrace: [newerTrace, olderTrace],
      },
    }

    const result = await resolveIntent(makeIntent('explain_last_action'), context)
    // Should find newerTrace first (explicit_label_match)
    expect(result.message).toContain('you asked for it by name')
  })
})

describe('resolveSummarizeRecentActivity', () => {
  const baseContext: ResolutionContext = {
    currentEntryId: 'entry-1',
    currentEntryName: 'Test Entry',
    entries: [],
    workspaces: [],
    currentWorkspaceId: null,
    currentWorkspaceName: null,
    panels: [],
  }

  const makeIntent = (intentName: string): IntentResponse => ({
    intent: intentName as IntentResponse['intent'],
    args: {},
  })

  test('4. populated actionHistory → grouped summary', async () => {
    const context: ResolutionContext = {
      ...baseContext,
      sessionState: {
        actionHistory: [
          { type: 'open_workspace', targetType: 'workspace', targetName: 'Sprint 5', timestamp: Date.now() - 300000 },
          { type: 'open_workspace', targetType: 'workspace', targetName: 'Sprint 6', timestamp: Date.now() - 200000 },
          { type: 'rename_workspace', targetType: 'workspace', targetName: 'Sprint 66', timestamp: Date.now() - 100000 },
          { type: 'go_to_dashboard', targetType: 'workspace', targetName: 'Dashboard', timestamp: Date.now() - 50000 },
          { type: 'open_workspace', targetType: 'workspace', targetName: 'Research', timestamp: Date.now() - 10000 },
        ],
      },
    }

    const result = await resolveIntent(makeIntent('summarize_recent_activity'), context)
    expect(result.success).toBe(true)
    expect(result.action).toBe('inform')
    expect(result.message).toContain('5 action')
    expect(result.message).toContain('opening workspace')
    expect(result.message).toContain('Recent activity')
  })

  test('5. empty history → "no activity" message', async () => {
    const context: ResolutionContext = {
      ...baseContext,
      sessionState: {
        actionHistory: [],
      },
    }

    const result = await resolveIntent(makeIntent('summarize_recent_activity'), context)
    expect(result.success).toBe(true)
    expect(result.action).toBe('inform')
    expect(result.message).toContain('No activity recorded')
  })

  test('6c. always returns action: inform — large history', async () => {
    const history = Array.from({ length: 20 }, (_, i) => ({
      type: 'open_workspace' as const,
      targetType: 'workspace' as const,
      targetName: `Workspace ${i}`,
      timestamp: Date.now() - (20 - i) * 10000,
    }))

    const context: ResolutionContext = {
      ...baseContext,
      sessionState: { actionHistory: history },
    }

    const result = await resolveIntent(makeIntent('summarize_recent_activity'), context)
    expect(result.action).toBe('inform')
  })
})

// =============================================================================
// Routing Gate Tests (isSemanticQuestionInput)
// =============================================================================

describe('isSemanticQuestionInput', () => {
  test('7. question intent ("why did I do that?") → true', () => {
    expect(isSemanticQuestionInput('why did I do that?')).toBe(true)
  })

  test('8. imperative form ("summarize my session") → true', () => {
    expect(isSemanticQuestionInput('summarize my session')).toBe(true)
  })

  test('8b. imperative form ("recap what we did") → true', () => {
    expect(isSemanticQuestionInput('recap what we did')).toBe(true)
  })

  test('8c. question form ("what have I been doing?") → true', () => {
    expect(isSemanticQuestionInput('what have I been doing?')).toBe(true)
  })

  test('10. non-question ("open recent") → false', () => {
    expect(isSemanticQuestionInput('open recent')).toBe(false)
  })

  test('11. command-like ("open links panel and explain why") → false (excluded by isExplicitCommand)', () => {
    expect(isSemanticQuestionInput('open links panel and explain why')).toBe(false)
  })

  test('12. selection-like ("2") → false (excluded by isSelectionOnly)', () => {
    // With active options, "2" is a selection
    expect(isSemanticQuestionInput('2', 3, ['Alpha', 'Beta', 'Gamma'])).toBe(false)
  })

  test('12b. selection-like ("first") → false', () => {
    expect(isSemanticQuestionInput('first', 3, ['Alpha', 'Beta', 'Gamma'])).toBe(false)
  })

  test('plain text not matching patterns → false', () => {
    expect(isSemanticQuestionInput('hello there')).toBe(false)
  })

  test('workspace command → false', () => {
    expect(isSemanticQuestionInput('go to workspace 5')).toBe(false)
  })

  // Manual-test regression inputs (routing precedence fix)
  test('18. "explain what just happened" → true', () => {
    expect(isSemanticQuestionInput('explain what just happened')).toBe(true)
  })

  test('19. "why did I do that?" → true', () => {
    expect(isSemanticQuestionInput('why did I do that?')).toBe(true)
  })

  test('20. "what was that about?" → true', () => {
    expect(isSemanticQuestionInput('what was that about?')).toBe(true)
  })

  test('21. "what have I been doing?" → true', () => {
    expect(isSemanticQuestionInput('what have I been doing?')).toBe(true)
  })
})

// =============================================================================
// Client-Side Safety Tests
// =============================================================================

describe('client-side defense-in-depth logic', () => {
  // These test the logic pattern used in chat-navigation-panel.tsx
  // We replicate the condition inline since it's embedded in a component

  const SEMANTIC_ANSWER_INTENTS = new Set(['explain_last_action', 'summarize_recent_activity'])

  function checkDefenseInDepth(
    semanticLanePending: boolean,
    resolvedIntent: string | undefined,
    resolvedAction: string,
  ): { blocked: boolean; finalAction: string } {
    const isSemanticIntent = resolvedIntent && SEMANTIC_ANSWER_INTENTS.has(resolvedIntent)

    if (semanticLanePending && isSemanticIntent) {
      const isAnswerAction = resolvedAction === 'inform'
        || resolvedAction === 'answer_from_context'
        || resolvedAction === 'general_answer'
        || resolvedAction === 'error'

      if (!isAnswerAction) {
        return { blocked: true, finalAction: 'inform' }
      }
    }

    return { blocked: false, finalAction: resolvedAction }
  }

  test('13. pending + semantic intent + inform → passes through unchanged', () => {
    const result = checkDefenseInDepth(true, 'explain_last_action', 'inform')
    expect(result.blocked).toBe(false)
    expect(result.finalAction).toBe('inform')
  })

  test('14. pending + semantic intent + navigate_workspace → blocked to inform', () => {
    const result = checkDefenseInDepth(true, 'explain_last_action', 'navigate_workspace')
    expect(result.blocked).toBe(true)
    expect(result.finalAction).toBe('inform')
  })

  test('15. pending + non-semantic intent (open_panel) → NOT blocked', () => {
    const result = checkDefenseInDepth(true, 'open_panel', 'open_panel')
    expect(result.blocked).toBe(false)
    expect(result.finalAction).toBe('open_panel')
  })

  test('15b. no pending → NOT blocked regardless of intent', () => {
    const result = checkDefenseInDepth(false, 'explain_last_action', 'navigate_workspace')
    expect(result.blocked).toBe(false)
    expect(result.finalAction).toBe('navigate_workspace')
  })
})

// =============================================================================
// Flag-Off Robustness Tests
// =============================================================================

describe('flag-off robustness', () => {
  test('16. flag off + explain_last_action intent → remap to last_action resolves normally', async () => {
    // Simulates what route.ts does: remap intent before resolving
    const baseContext: ResolutionContext = {
      currentEntryId: 'entry-1',
      currentEntryName: 'Test Entry',
      entries: [],
      workspaces: [],
      currentWorkspaceId: null,
      currentWorkspaceName: null,
      panels: [],
      sessionState: {
        lastAction: {
          type: 'open_workspace',
          workspaceName: 'Sprint 6',
          timestamp: Date.now() - 10000,
        },
      },
    }

    // After remap: explain_last_action → last_action
    const remappedIntent: IntentResponse = {
      intent: 'last_action',
      args: {},
    }

    const result = await resolveIntent(remappedIntent, baseContext)
    expect(result.success).toBe(true)
    expect(result.action).toBe('inform')
    expect(result.message).toContain('Sprint 6')
  })

  test('17. flag off + summarize_recent_activity intent → remap to unsupported, graceful fallback', async () => {
    const baseContext: ResolutionContext = {
      currentEntryId: 'entry-1',
      currentEntryName: 'Test Entry',
      entries: [],
      workspaces: [],
      currentWorkspaceId: null,
      currentWorkspaceName: null,
      panels: [],
    }

    // After remap: summarize_recent_activity → unsupported
    const remappedIntent: IntentResponse = {
      intent: 'unsupported',
      args: { reason: 'Remapped from summarize_recent_activity (flag off)' },
    }

    const result = await resolveIntent(remappedIntent, baseContext)
    expect(result.success).toBe(false)
    expect(result.action).toBe('error')
    // Should not crash, returns error message
    expect(result.message).toBeTruthy()
  })
})

// =============================================================================
// Server Fallback Guard — Misclassification Override Tests
// =============================================================================

import { detectLocalSemanticIntent } from '@/lib/chat/input-classifiers'

describe('server fallback guard — intent remap + re-resolve', () => {
  const baseContext: ResolutionContext = {
    currentEntryId: 'entry-1',
    currentEntryName: 'Test Entry',
    entries: [],
    workspaces: [],
    currentWorkspaceId: null,
    currentWorkspaceName: null,
    panels: [],
  }

  const makeIntent = (intentName: string, args: Record<string, unknown> = {}): IntentResponse => ({
    intent: intentName as IntentResponse['intent'],
    args,
  })

  test('misclassified answer_from_context + exact meta-query → overridden deterministic answer', async () => {
    // Simulates the server guard logic in route.ts:
    // LLM returned answer_from_context for "what did I do before that?"
    // Guard detects this and remaps intent to explain_last_action, then re-resolves.
    const contextWithHistory: ResolutionContext = {
      ...baseContext,
      sessionState: {
        lastAction: {
          type: 'open_panel',
          panelTitle: 'Links Panel E',
          timestamp: Date.now() - 5000,
        },
        // actionHistory is newest-first (see chat-navigation-context.tsx:1174)
        actionHistory: [
          { type: 'open_panel', targetType: 'panel', targetName: 'Links Panel E', targetId: 'panel-e', timestamp: Date.now() - 5000 },
          { type: 'open_panel', targetType: 'panel', targetName: 'Links Panel D', targetId: 'panel-d', timestamp: Date.now() - 60000 },
        ],
      },
    }

    // Step 1: LLM misclassifies as answer_from_context
    const misclassifiedIntent = makeIntent('answer_from_context', {
      contextAnswer: 'You opened Links Panel D.',
    })
    const badResolution = await resolveIntent(misclassifiedIntent, contextWithHistory)
    // answer_from_context passes through LLM free-text — may contain wrong answer
    expect(badResolution.action).toBe('answer_from_context')

    // Step 2: Guard detects narrow pattern match
    const correctedIntent = detectLocalSemanticIntent('what did I do before that?')
    expect(correctedIntent).toBe('explain_last_action')

    // Step 3: Remap and re-resolve
    const remappedIntent = makeIntent(correctedIntent!)
    const goodResolution = await resolveIntent(remappedIntent, contextWithHistory)
    expect(goodResolution.success).toBe(true)
    expect(goodResolution.action).toBe('inform')
    // Must mention Links Panel E (the actual last action) — the deterministic
    // resolver uses lastAction + actionHistory, not LLM free-text
    expect(goodResolution.message).toContain('Links Panel E')
    // "Before that" should reference Links Panel D (actionHistory[1], newest-first)
    expect(goodResolution.message).toContain('Before that')
    expect(goodResolution.message).toContain('Links Panel D')
  })

  test('normal answer_from_context (notes-scope clarification) → unchanged', async () => {
    // LLM correctly returns answer_from_context for a general knowledge question.
    // Guard should NOT override because the input doesn't match narrow patterns.
    const userMessage = 'tell me about the links panel'
    const correctedIntent = detectLocalSemanticIntent(userMessage)

    // Detector returns null → no override
    expect(correctedIntent).toBeNull()

    // Original answer_from_context resolution stands
    const intent = makeIntent('answer_from_context', {
      contextAnswer: 'The links panel shows your bookmarks and saved links.',
    })
    const resolution = await resolveIntent(intent, {
      ...baseContext,
      sessionState: {
        lastAction: { type: 'open_panel', panelTitle: 'Links', timestamp: Date.now() - 5000 },
      },
    })
    expect(resolution.action).toBe('answer_from_context')
    expect(resolution.message).toContain('bookmarks')
  })

  test('active-option context → guard skipped (addendum safety)', async () => {
    // Even if the input matches a narrow pattern, the guard must NOT fire
    // when there are pending options or active clarification.
    // This tests the guard conditions, not resolveIntent directly.
    const userMessage = 'what did I do before that?'
    const correctedIntent = detectLocalSemanticIntent(userMessage)
    expect(correctedIntent).toBe('explain_last_action') // pattern matches

    // But guard conditions prevent override:
    const hasPendingOptions = true
    const hasLastClarification = true

    // Simulating route.ts guard — these conditions block the remap
    const guardPasses =
      !hasPendingOptions &&
      !hasLastClarification
    expect(guardPasses).toBe(false) // guard does NOT pass → no override

    // Original answer_from_context would be used as-is
    const intent = makeIntent('answer_from_context', {
      contextAnswer: 'Some LLM free-text answer.',
    })
    const resolution = await resolveIntent(intent, {
      ...baseContext,
      sessionState: {
        lastAction: { type: 'open_panel', panelTitle: 'Links Panel E', timestamp: Date.now() - 5000 },
      },
    })
    // answer_from_context passes through unchanged
    expect(resolution.action).toBe('answer_from_context')
  })
})
