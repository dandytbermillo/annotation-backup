/**
 * Integration Tests: need_context → semantic rescue pipeline.
 *
 * Tests the full route.ts pipeline for need_context misclassification rescue:
 * - LLM returns need_context for a semantic query → trySemanticRescue → correct resolver
 * - Guard-blocked cases (pendingOptions, lastClarification) → unsupported
 * - Metrics include needContextRescueApplied flag
 */

import { resolveIntent } from '@/lib/chat/intent-resolver'
import type { IntentResponse } from '@/lib/chat/intent-schema'
import type { ResolutionContext } from '@/lib/chat/resolution-types'
import { trySemanticRescue } from '@/lib/chat/semantic-rescue'

// Replicate the need_context rescue pipeline from route.ts
async function applyNeedContextRescuePipeline(
  llmIntent: IntentResponse,
  resolutionContext: ResolutionContext,
  userMessage: string,
  opts: {
    isSemanticLaneEnabled: boolean
    pendingOptions?: unknown[]
    lastClarification?: unknown
  },
): Promise<{
  intent: IntentResponse
  resolution: Awaited<ReturnType<typeof resolveIntent>>
  needContextRescueApplied: boolean
}> {
  let intent = { ...llmIntent }
  let needContextRescueApplied = false

  // Simulate the need_context rescue from route.ts
  if (intent.intent === 'need_context') {
    const rescuedIntent = trySemanticRescue(
      userMessage,
      opts.isSemanticLaneEnabled,
      opts.pendingOptions,
      opts.lastClarification,
      resolutionContext.sessionState?.lastAction
    )
    if (rescuedIntent) {
      needContextRescueApplied = true
      intent = { intent: rescuedIntent, args: {} }
    } else {
      intent = {
        intent: 'unsupported',
        args: {
          reason: "I couldn't find enough context to answer that. Could you provide more details or rephrase your question?",
        },
      }
    }
  }

  const resolution = await resolveIntent(intent, resolutionContext)
  return { intent, resolution, needContextRescueApplied }
}

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
      type: 'open_panel',
      panelTitle: 'Recent',
      panelId: 'panel-recent',
      timestamp: Date.now() - 5000,
    },
    actionHistory: [
      { type: 'open_panel', targetType: 'panel', targetName: 'Recent', targetId: 'panel-recent', timestamp: Date.now() - 5000 },
      { type: 'open_panel', targetType: 'panel', targetName: 'Links Panel D', targetId: 'panel-d', timestamp: Date.now() - 60000 },
    ],
  },
}

describe('need_context → semantic rescue pipeline', () => {
  test('LLM returns need_context for noisy semantic query → rescue to explain_last_action', async () => {
    const { intent, resolution, needContextRescueApplied } = await applyNeedContextRescuePipeline(
      { intent: 'need_context', args: {} },
      baseContext,
      'assistant explain what did I do before that? thank you',
      { isSemanticLaneEnabled: true }
    )

    expect(needContextRescueApplied).toBe(true)
    expect(intent.intent).toBe('explain_last_action')
    expect(resolution.success).toBe(true)
    expect(resolution.action).toBe('inform')
    expect(resolution.message).toContain('Recent')
  })

  test('LLM returns need_context for "hey what did I just do? thanks" → rescue to last_action', async () => {
    const { intent, resolution, needContextRescueApplied } = await applyNeedContextRescuePipeline(
      { intent: 'need_context', args: {} },
      baseContext,
      'hey what did I just do? thanks',
      { isSemanticLaneEnabled: true }
    )

    expect(needContextRescueApplied).toBe(true)
    expect(intent.intent).toBe('last_action')
    expect(resolution.success).toBe(true)
    expect(resolution.action).toBe('inform')
  })

  test('need_context + pendingOptions → guard blocked → unsupported', async () => {
    const { intent, resolution, needContextRescueApplied } = await applyNeedContextRescuePipeline(
      { intent: 'need_context', args: {} },
      baseContext,
      'assistant explain what did I do before that? thank you',
      {
        isSemanticLaneEnabled: true,
        pendingOptions: [{ label: 'Option 1' }],
      }
    )

    expect(needContextRescueApplied).toBe(false)
    expect(intent.intent).toBe('unsupported')
    expect(resolution.success).toBe(false)
  })

  test('need_context + lastClarification → guard blocked → unsupported', async () => {
    const { intent, resolution, needContextRescueApplied } = await applyNeedContextRescuePipeline(
      { intent: 'need_context', args: {} },
      baseContext,
      'assistant explain what did I do before that? thank you',
      {
        isSemanticLaneEnabled: true,
        lastClarification: { question: 'Did you mean...?' },
      }
    )

    expect(needContextRescueApplied).toBe(false)
    expect(intent.intent).toBe('unsupported')
    expect(resolution.success).toBe(false)
  })

  test('need_context + flag disabled → guard blocked → unsupported', async () => {
    const { intent, resolution, needContextRescueApplied } = await applyNeedContextRescuePipeline(
      { intent: 'need_context', args: {} },
      baseContext,
      'what did I do before that?',
      { isSemanticLaneEnabled: false }
    )

    expect(needContextRescueApplied).toBe(false)
    expect(intent.intent).toBe('unsupported')
  })

  test('need_context + non-matching input → no rescue → unsupported', async () => {
    const { intent, needContextRescueApplied } = await applyNeedContextRescuePipeline(
      { intent: 'need_context', args: {} },
      baseContext,
      'tell me about the links panel',
      { isSemanticLaneEnabled: true }
    )

    expect(needContextRescueApplied).toBe(false)
    expect(intent.intent).toBe('unsupported')
  })

  test('need_context + no lastAction → guard blocked → unsupported', async () => {
    const contextNoLastAction: ResolutionContext = {
      ...baseContext,
      sessionState: {},
    }

    const { intent, needContextRescueApplied } = await applyNeedContextRescuePipeline(
      { intent: 'need_context', args: {} },
      contextNoLastAction,
      'what did I do before that?',
      { isSemanticLaneEnabled: true }
    )

    expect(needContextRescueApplied).toBe(false)
    expect(intent.intent).toBe('unsupported')
  })

  test('metrics include needContextRescueApplied: true when rescue triggers', async () => {
    // This test verifies the metric flag value that route.ts would include
    // in [navigate-llm-metrics] JSON output
    const { needContextRescueApplied } = await applyNeedContextRescuePipeline(
      { intent: 'need_context', args: {} },
      baseContext,
      'assistant what did I do before that?',
      { isSemanticLaneEnabled: true }
    )

    // Simulating the metrics output from route.ts
    const metricsPayload = {
      provider: 'gemini',
      path: 'intent',
      needContextRescueApplied,
      fallbackRemapApplied: false,
    }

    expect(metricsPayload.needContextRescueApplied).toBe(true)
  })

  test('metrics include needContextRescueApplied: false when rescue blocked', async () => {
    const { needContextRescueApplied } = await applyNeedContextRescuePipeline(
      { intent: 'need_context', args: {} },
      baseContext,
      'tell me about the links panel',
      { isSemanticLaneEnabled: true }
    )

    const metricsPayload = {
      provider: 'gemini',
      path: 'intent',
      needContextRescueApplied,
      fallbackRemapApplied: false,
    }

    expect(metricsPayload.needContextRescueApplied).toBe(false)
  })
})
