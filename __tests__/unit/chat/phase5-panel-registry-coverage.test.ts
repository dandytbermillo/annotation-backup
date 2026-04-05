/**
 * Phase 5 Panel Registry Replay Coverage Tests
 *
 * Locks:
 * 4a. Resolver-seam: executePanelIntent → open_panel_drawer result flows through resolvePanelIntent
 * 4b. Resolver-wiring: built-in panel resolves through open-drawer handler when not in visibleWidgets
 * 4c. Registry coverage: all replay-safe built-ins registered, generic writeback, exclusions
 */

import { panelRegistry } from '@/lib/panels/panel-registry'
import { buildPhase5NavigationWritePayload } from '@/lib/chat/routing-log/memory-write-payload'
import { buildResultFromMemory } from '@/lib/chat/routing-log/memory-action-builder'
import type { MemoryLookupResult } from '@/lib/chat/routing-log/memory-reader'
import { buildContextSnapshot } from '@/lib/chat/routing-log/context-snapshot'

// ---------------------------------------------------------------------------
// 4a. Resolver-seam test: executePanelIntent → open_panel_drawer
//
// Tests the resolvePanelIntent seam by calling resolveIntent with mocked
// executePanelIntent that returns open_panel_drawer. This locks the fix
// where the action was previously discarded to 'inform'.
// ---------------------------------------------------------------------------

// Mock DB and other resolvers (deterministic, no live DB)
jest.mock('@/lib/db/pool', () => ({
  serverPool: {
    query: jest.fn().mockResolvedValue({ rows: [] }),
  },
}))

jest.mock('@/lib/chat/workspace-resolver', () => ({
  resolveWorkspace: jest.fn().mockResolvedValue({ status: 'not_found' }),
  resolveRecentWorkspace: jest.fn().mockResolvedValue({ status: 'not_found' }),
  listWorkspaces: jest.fn().mockResolvedValue({ workspaces: [] }),
  renameWorkspace: jest.fn(),
  deleteWorkspace: jest.fn(),
}))

jest.mock('@/lib/chat/note-resolver', () => ({
  resolveNote: jest.fn().mockResolvedValue({ status: 'not_found' }),
}))

jest.mock('@/lib/chat/entry-resolver', () => ({
  resolveEntry: jest.fn().mockResolvedValue({ status: 'not_found' }),
}))

jest.mock('@/lib/utils/debug-logger', () => ({
  debugLog: jest.fn(),
}))

// Mock executePanelIntent to simulate the open-drawer handler response
const mockExecutePanelIntent = jest.fn()
jest.mock('@/lib/panels/panel-registry', () => {
  const actual = jest.requireActual('@/lib/panels/panel-registry')
  return {
    ...actual,
    executePanelIntent: (...args: unknown[]) => mockExecutePanelIntent(...args),
  }
})

// Re-import after mocking
import { resolveIntent } from '@/lib/chat/intent-resolver'
import type { IntentResponse } from '@/lib/chat/intent-schema'
import type { ResolutionContext } from '@/lib/chat/resolution-types'

const baseContext: ResolutionContext = {
  currentEntryId: 'entry-1',
  currentEntryName: 'Test Entry',
  userId: 'user-1',
  visibleWidgets: [], // empty — no visibleWidgets match
}

// ---------------------------------------------------------------------------
// 4a. Resolver-seam: executePanelIntent → open_panel_drawer not dropped
// ---------------------------------------------------------------------------

describe('4a. resolvePanelIntent open_panel_drawer seam', () => {
  beforeEach(() => {
    mockExecutePanelIntent.mockReset()
  })

  it('returns open_panel_drawer when executePanelIntent returns open_panel_drawer action', async () => {
    // Simulate the open-drawer handler returning a successful open_panel_drawer
    mockExecutePanelIntent.mockResolvedValue({
      success: true,
      action: 'open_panel_drawer',
      panelId: 'uuid-123',
      panelTitle: 'Links Overview',
      semanticPanelId: 'links-overview',
      message: 'Opening Links Overview...',
    })

    const intent: IntentResponse = {
      intent: 'panel_intent',
      args: {
        panelId: 'links-overview',
        intentName: 'open_drawer',
        params: {},
      },
    }

    const result = await resolveIntent(intent, baseContext)

    expect(result.action).toBe('open_panel_drawer')
    expect(result.panelId).toBe('uuid-123')
    expect(result.panelTitle).toBe('Links Overview')
    expect(result.success).toBe(true)
  })

  it('does NOT return inform when executePanelIntent returns open_panel_drawer', async () => {
    mockExecutePanelIntent.mockResolvedValue({
      success: true,
      action: 'open_panel_drawer',
      panelId: 'uuid-456',
      panelTitle: 'Navigator',
      semanticPanelId: 'navigator',
      message: 'Opening Navigator...',
    })

    const intent: IntentResponse = {
      intent: 'panel_intent',
      args: {
        panelId: 'some-unknown-panel',
        intentName: 'open_drawer',
        params: {},
      },
    }

    const result = await resolveIntent(intent, baseContext)

    // Must NOT fall through to 'inform'
    expect(result.action).not.toBe('inform')
    expect(result.action).toBe('open_panel_drawer')
  })

  it('still returns inform for non-drawer successful results without items or navigateTo', async () => {
    mockExecutePanelIntent.mockResolvedValue({
      success: true,
      message: 'Some informational response.',
    })

    const intent: IntentResponse = {
      intent: 'panel_intent',
      args: {
        panelId: 'some-panel',
        intentName: 'some_action',
        params: {},
      },
    }

    const result = await resolveIntent(intent, baseContext)

    expect(result.action).toBe('inform')
  })
})

// ---------------------------------------------------------------------------
// 4b. Resolver wiring: built-in panel resolves through handler without visibleWidgets
// ---------------------------------------------------------------------------

describe('4b. resolver wiring for non-visibleWidgets path', () => {
  beforeEach(() => {
    mockExecutePanelIntent.mockReset()
  })

  it('links-overview resolves to open_panel_drawer via handler when not in visibleWidgets', async () => {
    // links-overview dynamic fallback fails (links_overview ≠ category_navigator in DB)
    // but executePanelIntent calls the open-drawer handler which has the correct mapping
    mockExecutePanelIntent.mockResolvedValue({
      success: true,
      action: 'open_panel_drawer',
      panelId: 'uuid-links-overview',
      panelTitle: 'Links Overview',
      semanticPanelId: 'links-overview',
      message: 'Opening Links Overview...',
    })

    const intent: IntentResponse = {
      intent: 'panel_intent',
      args: {
        panelId: 'links-overview',
        intentName: 'open_drawer',
        params: {},
      },
    }

    const contextWithoutLinksOverview: ResolutionContext = {
      ...baseContext,
      visibleWidgets: [], // explicitly empty — no visibleWidgets catch
    }

    const result = await resolveIntent(intent, contextWithoutLinksOverview)

    expect(result.action).toBe('open_panel_drawer')
    expect(result.panelId).toBe('uuid-links-overview')
    expect(result.success).toBe(true)
  })

  it('navigator resolves to open_panel_drawer via handler when not in visibleWidgets', async () => {
    mockExecutePanelIntent.mockResolvedValue({
      success: true,
      action: 'open_panel_drawer',
      panelId: 'uuid-navigator',
      panelTitle: 'Navigator',
      semanticPanelId: 'navigator',
      message: 'Opening Navigator...',
    })

    const intent: IntentResponse = {
      intent: 'panel_intent',
      args: {
        panelId: 'navigator',
        intentName: 'open_drawer',
        params: {},
      },
    }

    const result = await resolveIntent(intent, {
      ...baseContext,
      visibleWidgets: [],
    })

    expect(result.action).toBe('open_panel_drawer')
    expect(result.panelId).toBe('uuid-navigator')
  })
})

// ---------------------------------------------------------------------------
// 4c. Registry coverage
// ---------------------------------------------------------------------------

describe('4c. registry coverage', () => {
  const REPLAY_SAFE_BUILTINS = [
    'recent',
    'navigator',
    'widget-manager',
    'quick-capture',
    'continue',
    'links-overview',
  ]

  // Quick-links badges A through E
  const QUICK_LINKS_BADGES = ['a', 'b', 'c', 'd', 'e']

  describe('all replay-safe built-ins are registered', () => {
    it.each(REPLAY_SAFE_BUILTINS)('panelRegistry contains %s', (panelId) => {
      const supported = panelRegistry.getSupportedActions(panelId)
      expect(supported.length).toBeGreaterThan(0)
    })

    it.each(QUICK_LINKS_BADGES)('panelRegistry contains quick-links-%s', (badge) => {
      // Ensure quick-links manifests are loaded
      panelRegistry.ensureQuickLinksManifest(`quick-links-${badge}`)
      const supported = panelRegistry.getSupportedActions(`quick-links-${badge}`)
      expect(supported.length).toBeGreaterThan(0)
    })
  })

  describe('each replay-safe built-in has open/show examples', () => {
    const panelsWithOpenIntents = [
      { panelId: 'navigator', expectedIntent: 'open_drawer' },
      { panelId: 'widget-manager', expectedIntent: 'open_drawer' },
      { panelId: 'quick-capture', expectedIntent: 'open_drawer' },
      { panelId: 'continue', expectedIntent: 'open_drawer' },
      { panelId: 'links-overview', expectedIntent: 'open_drawer' },
    ]

    it.each(panelsWithOpenIntents)(
      '$panelId has $expectedIntent intent with open/show examples',
      ({ panelId, expectedIntent }) => {
        const match = panelRegistry.findIntent({
          panelId,
          intentName: expectedIntent,
          params: {},
        })
        expect(match).not.toBeNull()
        expect(match!.intent.examples.length).toBeGreaterThan(0)
        const hasOpenOrShow = match!.intent.examples.some(
          (ex: string) => /\b(open|show)\b/i.test(ex)
        )
        expect(hasOpenOrShow).toBe(true)
      }
    )

    it('recent has list_recent intent with open/show examples', () => {
      const match = panelRegistry.findIntent({
        panelId: 'recent',
        intentName: 'list_recent',
        params: {},
      })
      expect(match).not.toBeNull()
      expect(match!.intent.examples.some(
        (ex: string) => /\b(show|recent)\b/i.test(ex)
      )).toBe(true)
    })

    it('quick-links-a has show_links intent with open/show examples', () => {
      panelRegistry.ensureQuickLinksManifest('quick-links-a')
      const match = panelRegistry.findIntent({
        panelId: 'quick-links-a',
        intentName: 'show_links',
        params: {},
      })
      expect(match).not.toBeNull()
      expect(match!.intent.examples.some(
        (ex: string) => /\b(show|open)\b/i.test(ex)
      )).toBe(true)
    })
  })

  describe('writeback payload shape is generic for open_panel', () => {
    const snapshot = buildContextSnapshot({
      openWidgetCount: 1,
      pendingOptionsCount: 0,
      activeOptionSetId: null,
      hasLastClarification: false,
      hasLastSuggestion: false,
      latchEnabled: false,
      messageCount: 2,
    })

    it('produces slots_json with panelId + panelTitle for any panel', () => {
      const payload = buildPhase5NavigationWritePayload({
        rawQueryText: 'open navigator',
        intentId: 'open_panel',
        resolution: {
          success: true,
          action: 'open_panel_drawer',
          panel: { id: 'uuid-nav', title: 'Navigator' },
        },
        contextSnapshot: snapshot,
      })

      expect(payload).not.toBeNull()
      expect(payload!.intent_id).toBe('open_panel')
      expect(payload!.slots_json.panelId).toBe('uuid-nav')
      expect(payload!.slots_json.panelTitle).toBe('Navigator')
      expect(payload!.slots_json.action_type).toBe('open_panel')
    })

    it('produces same shape for different panel', () => {
      const payload = buildPhase5NavigationWritePayload({
        rawQueryText: 'open widget manager',
        intentId: 'open_panel',
        resolution: {
          success: true,
          action: 'open_panel_drawer',
          panel: { id: 'uuid-wm', title: 'Widget Manager' },
        },
        contextSnapshot: snapshot,
      })

      expect(payload).not.toBeNull()
      expect(payload!.intent_id).toBe('open_panel')
      expect(payload!.slots_json.panelId).toBe('uuid-wm')
      expect(payload!.slots_json.panelTitle).toBe('Widget Manager')
    })
  })

  describe('replay reconstruction is panel-agnostic', () => {
    const DEFAULT_RESULT = {
      handled: false,
      clarificationCleared: false,
      isNewQuestionOrCommandDetected: false,
      classifierCalled: false,
      classifierTimeout: false,
      classifierError: false,
      isFollowUp: false,
    }

    it('open_panel replay uses only panelId + panelTitle regardless of panel identity', () => {
      const panels = [
        { panelId: 'uuid-recent', panelTitle: 'Recent' },
        { panelId: 'uuid-nav', panelTitle: 'Navigator' },
        { panelId: 'uuid-wm', panelTitle: 'Widget Manager' },
        { panelId: 'uuid-qc', panelTitle: 'Quick Capture' },
        { panelId: 'uuid-lo', panelTitle: 'Links Overview' },
      ]

      for (const { panelId, panelTitle } of panels) {
        const candidate: MemoryLookupResult = {
          intent_id: 'open_panel',
          intent_class: 'action_intent',
          slots_json: {
            action_type: 'open_panel',
            panelId,
            panelTitle,
          },
          target_ids: [panelId],
          risk_tier: 'medium',
          success_count: 1,
          context_fingerprint: 'fp-test',
        }

        const result = buildResultFromMemory(candidate, DEFAULT_RESULT)
        expect(result).not.toBeNull()
        expect(result!.navigationReplayAction).toEqual({
          type: 'open_panel',
          panelId,
          panelTitle,
        })
        // No panel-specific branching
        expect(result!.groundingAction).toBeUndefined()
      }
    })
  })

  describe('exclusion: non-open intents do not produce open_panel writeback', () => {
    const snapshot = buildContextSnapshot({
      openWidgetCount: 1,
      pendingOptionsCount: 0,
      activeOptionSetId: null,
      hasLastClarification: false,
      hasLastSuggestion: false,
      latchEnabled: false,
      messageCount: 2,
    })

    it('clear_recent does not produce open_panel writeback', () => {
      // clear_recent would never be called with intentId 'open_panel',
      // but verify the writeback builder rejects it if someone tried
      const payload = buildPhase5NavigationWritePayload({
        rawQueryText: 'clear recent',
        intentId: 'open_panel',
        resolution: {
          success: true,
          action: 'clear_recent',
          // No panel data
        },
        contextSnapshot: snapshot,
      })

      // Rejected: no panel.id
      expect(payload).toBeNull()
    })

    it('add_link does not produce open_panel writeback', () => {
      const payload = buildPhase5NavigationWritePayload({
        rawQueryText: 'add link to panel a',
        intentId: 'open_panel',
        resolution: {
          success: true,
          action: 'add_link',
        },
        contextSnapshot: snapshot,
      })

      expect(payload).toBeNull()
    })

    it('remove_link does not produce open_panel writeback', () => {
      const payload = buildPhase5NavigationWritePayload({
        rawQueryText: 'remove link from panel b',
        intentId: 'open_panel',
        resolution: {
          success: true,
          action: 'remove_link',
        },
        contextSnapshot: snapshot,
      })

      expect(payload).toBeNull()
    })
  })
})

// ---------------------------------------------------------------------------
// 4d. Grounding panel-execute writeback seam
//
// Locks the new client-side writeback path: when the grounding tier opens a
// panel drawer (Tier 4.5 visible_panels), the dispatcher result carries
// _groundingPanelOpen + _phase5ReplaySnapshot. The client builds a pending
// Phase 5 write from these, enabling later B1 exact replay.
// ---------------------------------------------------------------------------

describe('4d. grounding panel-execute writeback seam', () => {
  const snapshot = buildContextSnapshot({
    openWidgetCount: 2,
    pendingOptionsCount: 0,
    activeOptionSetId: null,
    hasLastClarification: false,
    hasLastSuggestion: false,
    latchEnabled: false,
    messageCount: 3,
  })

  it('_groundingPanelOpen + snapshot produces valid open_panel pending write', () => {
    // Simulate what chat-navigation-panel.tsx:2061 does:
    // when routingResult._groundingPanelOpen && routingResult._phase5ReplaySnapshot
    const gp = { panelId: 'uuid-recent-123', panelTitle: 'Recent' }

    const pendingWrite = buildPhase5NavigationWritePayload({
      rawQueryText: 'open recent widget',
      intentId: 'open_panel',
      resolution: {
        success: true,
        action: 'open_panel_drawer',
        panel: { id: gp.panelId, title: gp.panelTitle },
      },
      contextSnapshot: snapshot,
    })

    expect(pendingWrite).not.toBeNull()
    expect(pendingWrite!.intent_id).toBe('open_panel')
    expect(pendingWrite!.intent_class).toBe('action_intent')
    expect(pendingWrite!.raw_query_text).toBe('open recent widget')
    expect(pendingWrite!.slots_json.panelId).toBe('uuid-recent-123')
    expect(pendingWrite!.slots_json.panelTitle).toBe('Recent')
    expect(pendingWrite!.slots_json.action_type).toBe('open_panel')
    expect(pendingWrite!.target_ids).toEqual(['uuid-recent-123'])
  })

  it('works for any panel identity (widget manager)', () => {
    const gp = { panelId: 'uuid-wm-456', panelTitle: 'Widget Manager' }

    const pendingWrite = buildPhase5NavigationWritePayload({
      rawQueryText: 'open widget manager',
      intentId: 'open_panel',
      resolution: {
        success: true,
        action: 'open_panel_drawer',
        panel: { id: gp.panelId, title: gp.panelTitle },
      },
      contextSnapshot: snapshot,
    })

    expect(pendingWrite).not.toBeNull()
    expect(pendingWrite!.slots_json.panelId).toBe('uuid-wm-456')
    expect(pendingWrite!.slots_json.panelTitle).toBe('Widget Manager')
  })

  it('rejects when panelTitle is missing (incomplete grounding data)', () => {
    const pendingWrite = buildPhase5NavigationWritePayload({
      rawQueryText: 'open something',
      intentId: 'open_panel',
      resolution: {
        success: true,
        action: 'open_panel_drawer',
        panel: { id: 'uuid-123', title: undefined as unknown as string },
      },
      contextSnapshot: snapshot,
    })

    // buildPhase5NavigationWritePayload rejects when panel.title is falsy
    expect(pendingWrite).toBeNull()
  })

  it('rejects when panel.id is missing', () => {
    const pendingWrite = buildPhase5NavigationWritePayload({
      rawQueryText: 'open something',
      intentId: 'open_panel',
      resolution: {
        success: true,
        action: 'open_panel_drawer',
        panel: { id: undefined as unknown as string, title: 'Recent' },
      },
      contextSnapshot: snapshot,
    })

    expect(pendingWrite).toBeNull()
  })

  it('produced write is replayable by memory-action-builder', () => {
    // End-to-end: writeback → stored row → B1 lookup → replay reconstruction
    const gp = { panelId: 'uuid-nav-789', panelTitle: 'Navigator' }

    const pendingWrite = buildPhase5NavigationWritePayload({
      rawQueryText: 'open navigator',
      intentId: 'open_panel',
      resolution: {
        success: true,
        action: 'open_panel_drawer',
        panel: { id: gp.panelId, title: gp.panelTitle },
      },
      contextSnapshot: snapshot,
    })

    expect(pendingWrite).not.toBeNull()

    // Simulate B1 returning this as a stored row
    const storedCandidate: MemoryLookupResult = {
      intent_id: pendingWrite!.intent_id,
      intent_class: pendingWrite!.intent_class,
      slots_json: pendingWrite!.slots_json,
      target_ids: pendingWrite!.target_ids,
      risk_tier: pendingWrite!.risk_tier,
      success_count: 1,
      context_fingerprint: 'fp-grounding',
    }

    const DEFAULT_RESULT = {
      handled: false,
      clarificationCleared: false,
      isNewQuestionOrCommandDetected: false,
      classifierCalled: false,
      classifierTimeout: false,
      classifierError: false,
      isFollowUp: false,
    }

    const replayResult = buildResultFromMemory(storedCandidate, DEFAULT_RESULT)

    expect(replayResult).not.toBeNull()
    expect(replayResult!.handled).toBe(true)
    expect(replayResult!._devProvenanceHint).toBe('memory_semantic')
    expect(replayResult!.navigationReplayAction).toEqual({
      type: 'open_panel',
      panelId: 'uuid-nav-789',
      panelTitle: 'Navigator',
    })
  })
})
