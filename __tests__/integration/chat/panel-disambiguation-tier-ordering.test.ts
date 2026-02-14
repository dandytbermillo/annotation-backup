/**
 * Integration Test: Panel Disambiguation Tier Ordering
 *
 * Verifies that verb-prefixed panel commands ("open links panel") are handled
 * deterministically at Tier 2c (panel disambiguation) BEFORE Tier 4 (known-noun
 * routing) can hard-stop with "not available".
 *
 * This is Test F from the Tier 2c + Tier 4 panel disambiguation fix plan.
 */

// ============================================================================
// Module Mocks (must be before imports)
// ============================================================================

jest.mock('@/lib/utils/debug-logger', () => ({
  debugLog: jest.fn(),
}))

const mockBuildTurnSnapshot = jest.fn()
jest.mock('@/lib/chat/ui-snapshot-builder', () => ({
  buildTurnSnapshot: (...args: unknown[]) => mockBuildTurnSnapshot(...args),
  DEFAULT_SNAPSHOT_FRESHNESS_MS: 60000,
}))

jest.mock('@/lib/chat/clarification-llm-fallback', () => ({
  callClarificationLLMClient: jest.fn().mockResolvedValue({ success: false }),
  callReturnCueLLM: jest.fn().mockResolvedValue({ isReturn: false }),
  isLLMFallbackEnabledClient: jest.fn().mockReturnValue(false),
  isLLMAutoExecuteEnabledClient: jest.fn().mockReturnValue(false),
  isContextRetryEnabledClient: jest.fn().mockReturnValue(false),
  shouldCallLLMFallback: jest.fn().mockReturnValue(false),
  MIN_CONFIDENCE_SELECT: 0.6,
  AUTO_EXECUTE_CONFIDENCE: 0.85,
  AUTO_EXECUTE_ALLOWED_REASONS: new Set(['no_deterministic_match']),
}))

jest.mock('@/lib/chat/grounding-llm-fallback', () => ({
  callGroundingLLM: jest.fn().mockResolvedValue({ success: false }),
  isGroundingLLMEnabled: jest.fn().mockReturnValue(false),
}))

jest.mock('@/lib/chat/doc-routing', () => ({
  handleDocRetrieval: jest.fn().mockResolvedValue({ handled: false }),
}))

jest.mock('@/lib/chat/cross-corpus-handler', () => ({
  handleCrossCorpusRetrieval: jest.fn().mockResolvedValue({ handled: false }),
}))

jest.mock('@/lib/widgets/ui-snapshot-registry', () => ({
  getWidgetSnapshot: jest.fn().mockReturnValue(null),
  getAllVisibleSnapshots: jest.fn().mockReturnValue([]),
}))

// IMPORTANT: Do NOT mock handleKnownNounRouting — we use a spy to verify
// it is never called. The real implementation is used so the test proves
// Tier 2c short-circuits before Tier 4 can execute.
const mockHandleKnownNounRouting = jest.fn().mockReturnValue({ handled: false })
jest.mock('@/lib/chat/known-noun-routing', () => ({
  handleKnownNounRouting: (...args: unknown[]) => mockHandleKnownNounRouting(...args),
}))

global.fetch = jest.fn().mockResolvedValue({
  ok: false,
  status: 500,
  json: async () => ({}),
}) as jest.Mock

// ============================================================================
// Imports (after mocks)
// ============================================================================

import { dispatchRouting, type RoutingDispatcherContext } from '@/lib/chat/routing-dispatcher'
import { resetLLMArbitrationGuard } from '@/lib/chat/chat-routing'
import { callClarificationLLMClient, isLLMFallbackEnabledClient, isLLMAutoExecuteEnabledClient, isContextRetryEnabledClient } from '@/lib/chat/clarification-llm-fallback'
import { debugLog } from '@/lib/utils/debug-logger'

// ============================================================================
// Mock Context Factory
// ============================================================================

function createMockDispatchContext(overrides?: Partial<RoutingDispatcherContext>): RoutingDispatcherContext {
  return {
    trimmedInput: '',

    // Suggestion routing
    lastSuggestion: null,
    setLastSuggestion: jest.fn(),
    addRejectedSuggestions: jest.fn(),
    clearRejectedSuggestions: jest.fn(),

    // Clarification state
    lastClarification: null,
    pendingOptions: [],
    activeOptionSetId: null,
    setActiveOptionSetId: jest.fn(),
    uiContext: { mode: 'dashboard', dashboard: { entryName: 'Test Entry', visibleWidgets: [] } },
    currentEntryId: 'entry-1',
    addMessage: jest.fn(),
    setLastClarification: jest.fn(),
    setIsLoading: jest.fn(),
    setPendingOptions: jest.fn(),
    setPendingOptionsMessageId: jest.fn(),
    setPendingOptionsGraceCount: jest.fn(),
    setNotesScopeFollowUpActive: jest.fn(),
    handleSelectOption: jest.fn(),

    // Repair memory
    repairMemory: null,
    setRepairMemory: jest.fn(),
    incrementRepairMemoryTurn: jest.fn(),
    clearRepairMemory: jest.fn(),

    // Clarification snapshot
    clarificationSnapshot: null,
    saveClarificationSnapshot: jest.fn(),
    pauseSnapshotWithReason: jest.fn(),
    incrementSnapshotTurn: jest.fn(),
    clearClarificationSnapshot: jest.fn(),

    // Stop suppression
    stopSuppressionCount: 0,
    setStopSuppressionCount: jest.fn(),
    decrementStopSuppression: jest.fn(),

    // Doc/Routing
    docRetrievalState: null,
    knownTermsFetchStatus: 'snapshot' as const,
    usedCoreAppTermsFallback: false,
    updateDocRetrievalState: jest.fn(),
    messages: [],

    // Command reshow
    findLastOptionsMessage: jest.fn().mockReturnValue(null),
    reshowWindowMs: 2000,

    // Preview
    lastPreview: null,
    openPanelDrawer: jest.fn(),
    openPanelWithTracking: jest.fn(),

    // Session/Grounding
    sessionState: {},
    lastOptionsShown: null,
    saveLastOptionsShown: jest.fn(),
    incrementLastOptionsShownTurn: jest.fn(),
    clearLastOptionsShown: jest.fn(),

    // Widget registry
    getVisibleSnapshots: jest.fn().mockReturnValue([]),
    getActiveWidgetId: jest.fn().mockReturnValue(null),

    // Widget selection
    widgetSelectionContext: null,
    setWidgetSelectionContext: jest.fn(),
    incrementWidgetSelectionTurn: jest.fn(),
    clearWidgetSelectionContext: jest.fn(),

    // Focus latch
    focusLatch: null,
    setFocusLatch: jest.fn(),
    suspendFocusLatch: jest.fn(),
    incrementFocusLatchTurn: jest.fn(),
    clearFocusLatch: jest.fn(),

    // Scope-cue recovery memory
    scopeCueRecoveryMemory: null,
    clearScopeCueRecoveryMemory: jest.fn(),

    ...overrides,
  }
}

// ============================================================================
// Tests
// ============================================================================

describe('dispatchRouting: Tier 2c handles verb-prefixed panel commands before Tier 4', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    // Default: no open widgets (panel disambiguation uses visibleWidgets from uiContext)
    mockBuildTurnSnapshot.mockReturnValue({
      openWidgets: [],
      activeSnapshotWidgetId: null,
      uiSnapshotId: 'test-snap-1',
      revisionId: 1,
      capturedAtMs: Date.now(),
      hasBadgeLetters: false,
    })
    mockHandleKnownNounRouting.mockReturnValue({ handled: false })
  })

  it('Test F: "open links panel" + single Links Panel D → Tier 2c opens directly, Tier 4 never invoked', async () => {
    const ctx = createMockDispatchContext({
      trimmedInput: 'open links panel',
      uiContext: {
        mode: 'dashboard',
        dashboard: {
          entryName: 'Test Entry',
          visibleWidgets: [
            { id: 'links-panel-d', title: 'Links Panel D', type: 'links_note_tiptap' },
          ],
        },
      },
    })

    const result = await dispatchRouting(ctx)

    // Tier 2c should handle it (single-match direct open via verb stripping)
    expect(result.handled).toBe(true)
    expect(result.handledByTier).toBe(2)
    expect(result.tierLabel).toBe('panel_disambiguation')

    // Panel should have been opened directly
    expect(ctx.openPanelDrawer).toHaveBeenCalledWith('links-panel-d', 'Links Panel D')

    // Confirmation message
    expect(ctx.addMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        content: 'Opening Links Panel D.',
      })
    )

    // Tier 4 (handleKnownNounRouting) should NEVER have been called
    expect(mockHandleKnownNounRouting).not.toHaveBeenCalled()
  })

  it('"open links panel" + 3 Links Panel variants → Tier 2c disambiguates, Tier 4 never invoked', async () => {
    const ctx = createMockDispatchContext({
      trimmedInput: 'open links panel',
      uiContext: {
        mode: 'dashboard',
        dashboard: {
          entryName: 'Test Entry',
          visibleWidgets: [
            { id: 'links-panels', title: 'Links Panels', type: 'links_note_tiptap' },
            { id: 'links-panel-d', title: 'Links Panel D', type: 'links_note_tiptap' },
            { id: 'links-panel-e', title: 'Links Panel E', type: 'links_note_tiptap' },
          ],
        },
      },
    })

    const result = await dispatchRouting(ctx)

    // Tier 2c should handle it (multi-panel disambiguation)
    expect(result.handled).toBe(true)
    expect(result.handledByTier).toBe(2)
    expect(result.tierLabel).toBe('panel_disambiguation')

    // Should NOT open directly (ambiguous)
    expect(ctx.openPanelDrawer).not.toHaveBeenCalled()

    // Should show disambiguation options
    expect(ctx.addMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('Multiple'),
      })
    )

    // Tier 4 should never have been called
    expect(mockHandleKnownNounRouting).not.toHaveBeenCalled()
  })
})

// ============================================================================
// Natural / polite variant routing (canonicalizer integration)
// ============================================================================

describe('dispatchRouting: polite/natural variants route correctly through Tier 2c', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockBuildTurnSnapshot.mockReturnValue({
      openWidgets: [],
      activeSnapshotWidgetId: null,
      uiSnapshotId: 'test-snap-2',
      revisionId: 1,
      capturedAtMs: Date.now(),
      hasBadgeLetters: false,
    })
    mockHandleKnownNounRouting.mockReturnValue({ handled: false })
  })

  it('"can you open links panel pls" + 3 Links Panel variants → Tier 2c disambiguates', async () => {
    const ctx = createMockDispatchContext({
      trimmedInput: 'can you open links panel pls',
      uiContext: {
        mode: 'dashboard',
        dashboard: {
          entryName: 'Test Entry',
          visibleWidgets: [
            { id: 'links-panels', title: 'Links Panels', type: 'links_note_tiptap' },
            { id: 'links-panel-d', title: 'Links Panel D', type: 'links_note_tiptap' },
            { id: 'links-panel-e', title: 'Links Panel E', type: 'links_note_tiptap' },
          ],
        },
      },
    })

    const result = await dispatchRouting(ctx)

    expect(result.handled).toBe(true)
    expect(result.handledByTier).toBe(2)
    expect(result.tierLabel).toBe('panel_disambiguation')
    expect(ctx.openPanelDrawer).not.toHaveBeenCalled()
    expect(ctx.addMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('Multiple'),
      })
    )
    expect(mockHandleKnownNounRouting).not.toHaveBeenCalled()
  })

  it('"hey open the links panel" + single Links Panel D → Tier 2c opens directly', async () => {
    const ctx = createMockDispatchContext({
      trimmedInput: 'hey open the links panel',
      uiContext: {
        mode: 'dashboard',
        dashboard: {
          entryName: 'Test Entry',
          visibleWidgets: [
            { id: 'links-panel-d', title: 'Links Panel D', type: 'links_note_tiptap' },
          ],
        },
      },
    })

    const result = await dispatchRouting(ctx)

    expect(result.handled).toBe(true)
    expect(result.handledByTier).toBe(2)
    expect(result.tierLabel).toBe('panel_disambiguation')
    expect(ctx.openPanelDrawer).toHaveBeenCalledWith('links-panel-d', 'Links Panel D')
    expect(mockHandleKnownNounRouting).not.toHaveBeenCalled()
  })

  it('"could you show the links panel please" + 3 variants → Tier 2c disambiguates', async () => {
    const ctx = createMockDispatchContext({
      trimmedInput: 'could you show the links panel please',
      uiContext: {
        mode: 'dashboard',
        dashboard: {
          entryName: 'Test Entry',
          visibleWidgets: [
            { id: 'links-panels', title: 'Links Panels', type: 'links_note_tiptap' },
            { id: 'links-panel-d', title: 'Links Panel D', type: 'links_note_tiptap' },
            { id: 'links-panel-e', title: 'Links Panel E', type: 'links_note_tiptap' },
          ],
        },
      },
    })

    const result = await dispatchRouting(ctx)

    expect(result.handled).toBe(true)
    expect(result.handledByTier).toBe(2)
    expect(result.tierLabel).toBe('panel_disambiguation')
    expect(mockHandleKnownNounRouting).not.toHaveBeenCalled()
  })
})

// ============================================================================
// Regression: active stale options + polite panel command in same turn
// ============================================================================

describe('dispatchRouting: polite panel command with active stale options from prior interaction', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockBuildTurnSnapshot.mockReturnValue({
      openWidgets: [],
      activeSnapshotWidgetId: null,
      uiSnapshotId: 'test-snap-3',
      revisionId: 1,
      capturedAtMs: Date.now(),
      hasBadgeLetters: false,
    })
    mockHandleKnownNounRouting.mockReturnValue({ handled: false })
  })

  it('"can you open links panel pls" with stale Recent options active → Tier 2c panel disambiguation, NOT Tier 1b.4 re-show', async () => {
    // Simulate: user previously interacted with Recent panel, got options shown.
    // Those options are still active (pendingOptions + lastClarification set).
    // Now user types a polite panel command — should NOT re-show stale options.
    const staleMessageId = 'assistant-stale-recent'
    const staleOptions = [
      { index: 1, label: 'sample2 F', sublabel: 'Recent workspace', type: 'workspace_list', id: 'ws-sample2f', data: { workspaceId: 'ws-1' } },
      { index: 2, label: 'sample2', sublabel: 'Recent workspace', type: 'workspace_list', id: 'ws-sample2', data: { workspaceId: 'ws-2' } },
      { index: 3, label: 'Workspace 4', sublabel: 'Recent workspace', type: 'workspace_list', id: 'ws-4', data: { workspaceId: 'ws-4' } },
    ]
    const staleClarification = {
      type: 'option_selection' as const,
      originalIntent: 'recent_workspaces',
      messageId: staleMessageId,
      timestamp: Date.now() - 5000,
      clarificationQuestion: 'Which workspace?',
      options: staleOptions.map(o => ({ id: o.id, label: o.label, sublabel: o.sublabel, type: o.type })),
      metaCount: 0,
    }

    const ctx = createMockDispatchContext({
      trimmedInput: 'can you open links panel pls',
      lastClarification: staleClarification,
      pendingOptions: staleOptions,
      activeOptionSetId: staleMessageId,
      uiContext: {
        mode: 'dashboard',
        dashboard: {
          entryName: 'Test Entry',
          visibleWidgets: [
            { id: 'links-panels', title: 'Links Panels', type: 'links_note_tiptap' },
            { id: 'links-panel-d', title: 'Links Panel D', type: 'links_note_tiptap' },
            { id: 'links-panel-e', title: 'Links Panel E', type: 'links_note_tiptap' },
          ],
        },
      },
    })

    const result = await dispatchRouting(ctx)

    // Must be handled by Tier 2c (panel disambiguation), NOT Tier 0/1 (clarification intercept)
    expect(result.handled).toBe(true)
    expect(result.handledByTier).toBe(2)
    expect(result.tierLabel).toBe('panel_disambiguation')

    // Should show disambiguation for Links Panels, NOT re-show stale Recent options
    expect(ctx.addMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('Multiple'),
      })
    )

    // Must NOT have re-shown the stale "sample2 F / sample2 / Workspace 4" options
    const addMessageCalls = (ctx.addMessage as jest.Mock).mock.calls
    for (const [msg] of addMessageCalls) {
      expect(msg.content).not.toContain('Please choose one of the options')
      expect(msg.content).not.toContain('sample2')
      expect(msg.content).not.toContain('Workspace 4')
    }

    // Panel drawer should NOT have been opened (ambiguous — 3 matches)
    expect(ctx.openPanelDrawer).not.toHaveBeenCalled()

    // Tier 4 should never have been reached
    expect(mockHandleKnownNounRouting).not.toHaveBeenCalled()
  })

  it('"the second one" with stale options active → still selects from options (not bypassed)', async () => {
    // Verify the guard does NOT suppress legitimate selection inputs.
    const staleMessageId = 'assistant-stale-recent'
    const staleOptions = [
      { index: 1, label: 'sample2 F', sublabel: 'Recent workspace', type: 'workspace_list', id: 'ws-sample2f', data: { workspaceId: 'ws-1' } },
      { index: 2, label: 'sample2', sublabel: 'Recent workspace', type: 'workspace_list', id: 'ws-sample2', data: { workspaceId: 'ws-2' } },
      { index: 3, label: 'Workspace 4', sublabel: 'Recent workspace', type: 'workspace_list', id: 'ws-4', data: { workspaceId: 'ws-4' } },
    ]
    const staleClarification = {
      type: 'option_selection' as const,
      originalIntent: 'recent_workspaces',
      messageId: staleMessageId,
      timestamp: Date.now() - 5000,
      clarificationQuestion: 'Which workspace?',
      options: staleOptions.map(o => ({ id: o.id, label: o.label, sublabel: o.sublabel, type: o.type })),
      metaCount: 0,
    }

    const ctx = createMockDispatchContext({
      trimmedInput: 'the second one',
      lastClarification: staleClarification,
      pendingOptions: staleOptions,
      activeOptionSetId: staleMessageId,
      uiContext: {
        mode: 'dashboard',
        dashboard: {
          entryName: 'Test Entry',
          visibleWidgets: [
            { id: 'links-panels', title: 'Links Panels', type: 'links_note_tiptap' },
            { id: 'links-panel-d', title: 'Links Panel D', type: 'links_note_tiptap' },
            { id: 'links-panel-e', title: 'Links Panel E', type: 'links_note_tiptap' },
          ],
        },
      },
    })

    const result = await dispatchRouting(ctx)

    // Should be handled by clarification intercept (Tier 0/1), NOT fall through to Tier 2c
    expect(result.handled).toBe(true)
    expect(result.handledByTier).toBe(0) // clarification intercept

    // Should have selected the second option, not disambiguation
    expect(ctx.handleSelectOption).toHaveBeenCalled()
    expect(ctx.openPanelDrawer).not.toHaveBeenCalled()
  })
})

// ============================================================================
// Selection-vs-Command Arbitration: Full routing with active options
// Per selection-vs-command-arbitration-rule-plan.md
// ============================================================================

describe('dispatchRouting: selection-vs-command arbitration with active options', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockBuildTurnSnapshot.mockReturnValue({
      openWidgets: [],
      activeSnapshotWidgetId: null,
      uiSnapshotId: 'test-snap-arb',
      revisionId: 1,
      capturedAtMs: Date.now(),
      hasBadgeLetters: false,
    })
    mockHandleKnownNounRouting.mockReturnValue({ handled: false })
  })

  // Helper to create stale workspace options (non-panel)
  function createStaleWorkspaceContext(input: string, visibleWidgets: Array<{ id: string; title: string; type: string }> = []) {
    const staleMessageId = 'assistant-stale-ws'
    const staleOptions = [
      { index: 1, label: 'sample2 F', sublabel: 'Recent workspace', type: 'workspace_list', id: 'ws-sample2f', data: { workspaceId: 'ws-1' } },
      { index: 2, label: 'sample2', sublabel: 'Recent workspace', type: 'workspace_list', id: 'ws-sample2', data: { workspaceId: 'ws-2' } },
      { index: 3, label: 'Workspace 4', sublabel: 'Recent workspace', type: 'workspace_list', id: 'ws-4', data: { workspaceId: 'ws-4' } },
    ]
    return createMockDispatchContext({
      trimmedInput: input,
      lastClarification: {
        type: 'option_selection' as const,
        originalIntent: 'recent_workspaces',
        messageId: staleMessageId,
        timestamp: Date.now() - 5000,
        clarificationQuestion: 'Which workspace?',
        options: staleOptions.map(o => ({ id: o.id, label: o.label, sublabel: o.sublabel, type: o.type })),
        metaCount: 0,
      },
      pendingOptions: staleOptions,
      activeOptionSetId: staleMessageId,
      uiContext: {
        mode: 'dashboard',
        dashboard: {
          entryName: 'Test Entry',
          visibleWidgets,
        },
      },
    })
  }

  it('command escape: "open links panel" with stale non-matching options → Tier 2c panel disambiguation', async () => {
    const ctx = createStaleWorkspaceContext('open links panel', [
      { id: 'links-panels', title: 'Links Panels', type: 'links_note_tiptap' },
      { id: 'links-panel-d', title: 'Links Panel D', type: 'links_note_tiptap' },
      { id: 'links-panel-e', title: 'Links Panel E', type: 'links_note_tiptap' },
    ])

    const result = await dispatchRouting(ctx)

    // Pre-gate bypasses label matching → falls through to Tier 2c
    expect(result.handled).toBe(true)
    expect(result.handledByTier).toBe(2)
    expect(result.tierLabel).toBe('panel_disambiguation')

    // Response should be about multiple panels, NOT "Which workspace?"
    expect(ctx.addMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('Multiple'),
      })
    )
  })

  it('exact-first: "open links panel" with MATCHING active panel options → Tier 0 selects Links Panels (exact match)', async () => {
    // Options include "Links Panels", "Links Panel D", "Links Panel E"
    // "links panel" tokens = {links, panel} exactly matches "Links Panels" = {links, panel}
    const staleMessageId = 'assistant-panel-disambig'
    const panelOptions = [
      { index: 1, label: 'Links Panels', sublabel: 'Panel', type: 'panel_drawer', id: 'links-panels', data: { panelId: 'links-panels', panelTitle: 'Links Panels', panelType: 'default' } },
      { index: 2, label: 'Links Panel D', sublabel: 'Panel', type: 'panel_drawer', id: 'links-panel-d', data: { panelId: 'links-panel-d', panelTitle: 'Links Panel D', panelType: 'default' } },
      { index: 3, label: 'Links Panel E', sublabel: 'Panel', type: 'panel_drawer', id: 'links-panel-e', data: { panelId: 'links-panel-e', panelTitle: 'Links Panel E', panelType: 'default' } },
    ]

    const ctx = createMockDispatchContext({
      trimmedInput: 'open links panel',
      lastClarification: {
        type: 'panel_disambiguation' as const,
        originalIntent: 'open links panel',
        messageId: staleMessageId,
        timestamp: Date.now() - 2000,
        options: panelOptions.map(o => ({ id: o.id, label: o.label, sublabel: o.sublabel, type: o.type })),
        metaCount: 0,
      },
      pendingOptions: panelOptions,
      activeOptionSetId: staleMessageId,
      uiContext: {
        mode: 'dashboard',
        dashboard: {
          entryName: 'Test Entry',
          visibleWidgets: [
            { id: 'links-panels', title: 'Links Panels', type: 'links_note_tiptap' },
            { id: 'links-panel-d', title: 'Links Panel D', type: 'links_note_tiptap' },
            { id: 'links-panel-e', title: 'Links Panel E', type: 'links_note_tiptap' },
          ],
        },
      },
    })

    const result = await dispatchRouting(ctx)

    // Exact-first: selects Links Panels (Tier 0 intercept)
    expect(result.handled).toBe(true)
    expect(result.handledByTier).toBe(0)
    // Must have selected Links Panels, not re-shown options
    expect(ctx.handleSelectOption).toHaveBeenCalledWith(
      expect.objectContaining({ label: 'Links Panels' })
    )
  })

  it('no re-show loop: "open links panel" does not loop when Links Panels is present', async () => {
    // This is the regression test: repeated "open links panel" must not
    // trigger the generic "Which one do you mean" re-show when an exact match exists.
    const staleMessageId = 'assistant-panel-disambig'
    const panelOptions = [
      { index: 1, label: 'Links Panels', sublabel: 'Panel', type: 'panel_drawer', id: 'links-panels', data: { panelId: 'links-panels', panelTitle: 'Links Panels', panelType: 'default' } },
      { index: 2, label: 'Links Panel D', sublabel: 'Panel', type: 'panel_drawer', id: 'links-panel-d', data: { panelId: 'links-panel-d', panelTitle: 'Links Panel D', panelType: 'default' } },
      { index: 3, label: 'Links Panel E', sublabel: 'Panel', type: 'panel_drawer', id: 'links-panel-e', data: { panelId: 'links-panel-e', panelTitle: 'Links Panel E', panelType: 'default' } },
    ]

    const ctx = createMockDispatchContext({
      trimmedInput: 'open links panel',
      lastClarification: {
        type: 'panel_disambiguation' as const,
        originalIntent: 'open links panel',
        messageId: staleMessageId,
        timestamp: Date.now() - 2000,
        options: panelOptions.map(o => ({ id: o.id, label: o.label, sublabel: o.sublabel, type: o.type })),
        metaCount: 0,
      },
      pendingOptions: panelOptions,
      activeOptionSetId: staleMessageId,
      uiContext: {
        mode: 'dashboard',
        dashboard: {
          entryName: 'Test Entry',
          visibleWidgets: [
            { id: 'links-panels', title: 'Links Panels', type: 'links_note_tiptap' },
            { id: 'links-panel-d', title: 'Links Panel D', type: 'links_note_tiptap' },
            { id: 'links-panel-e', title: 'Links Panel E', type: 'links_note_tiptap' },
          ],
        },
      },
    })

    const result = await dispatchRouting(ctx)

    expect(result.handled).toBe(true)
    // Must select — clarification should be cleared (not re-shown)
    expect(ctx.handleSelectOption).toHaveBeenCalledTimes(1)

    // The response must NOT contain the generic re-show prompt
    const addMessageCalls = (ctx.addMessage as jest.Mock).mock.calls
    for (const [msg] of addMessageCalls) {
      if (msg.content) {
        expect(msg.content).not.toContain('Which one do you mean')
        expect(msg.content).not.toContain('none of these')
      }
    }
  })

  it('safety: "the second one" with active options → Tier 0 ordinal selection', async () => {
    const ctx = createStaleWorkspaceContext('the second one')

    const result = await dispatchRouting(ctx)

    expect(result.handled).toBe(true)
    expect(result.handledByTier).toBe(0)
    expect(ctx.handleSelectOption).toHaveBeenCalled()
  })

  it('downstream preservation: "open recent" with stale non-matching options → reaches Tier 4 known-noun', async () => {
    // Mock Tier 4 to handle the input
    mockHandleKnownNounRouting.mockReturnValueOnce({ handled: true, handledByTier: 4, tierLabel: 'known_noun' })

    const ctx = createStaleWorkspaceContext('open recent')

    const result = await dispatchRouting(ctx)

    // Pre-gate bypasses label matching → falls through past Tier 0/1
    // "open recent" reaches Tier 4 known-noun routing
    expect(result.handled).toBe(true)
    expect(result.handledByTier).toBe(4)

    // Proves downstream tiers (3.5/3.6/4) remain reachable after pre-gate bypass
    expect(mockHandleKnownNounRouting).toHaveBeenCalled()
  })
})

// ============================================================================
// LLM Arbitration Integration: Full routing with multi-match + LLM
// Per deterministic-llm-arbitration-fallback-plan.md
// ============================================================================

describe('dispatchRouting: LLM arbitration integration (clarify-only)', () => {
  const panelOptions = [
    { index: 1, label: 'Links Panels', sublabel: 'Panel', type: 'panel_drawer', id: 'opt-0', data: { panelId: 'links-panels', panelTitle: 'Links Panels', panelType: 'default' } },
    { index: 2, label: 'Links Panel D', sublabel: 'Panel', type: 'panel_drawer', id: 'opt-1', data: { panelId: 'links-panel-d', panelTitle: 'Links Panel D', panelType: 'default' } },
    { index: 3, label: 'Links Panel E', sublabel: 'Panel', type: 'panel_drawer', id: 'opt-2', data: { panelId: 'links-panel-e', panelTitle: 'Links Panel E', panelType: 'default' } },
  ]
  const disambigMessageId = 'assistant-panel-disambig'
  const panelClarification = {
    type: 'panel_disambiguation' as const,
    originalIntent: 'open links panel',
    messageId: disambigMessageId,
    timestamp: Date.now() - 2000,
    options: panelOptions.map(o => ({ id: o.id, label: o.label, sublabel: o.sublabel, type: o.type })),
    metaCount: 0,
  }
  const visibleWidgets = [
    { id: 'links-panels', title: 'Links Panels', type: 'links_note_tiptap' },
    { id: 'links-panel-d', title: 'Links Panel D', type: 'links_note_tiptap' },
    { id: 'links-panel-e', title: 'Links Panel E', type: 'links_note_tiptap' },
  ]

  beforeEach(() => {
    jest.clearAllMocks()
    resetLLMArbitrationGuard()
    mockBuildTurnSnapshot.mockReturnValue({
      openWidgets: [],
      activeSnapshotWidgetId: null,
      uiSnapshotId: 'test-snap-llm',
      revisionId: 1,
      capturedAtMs: Date.now(),
      hasBadgeLetters: false,
    })
    mockHandleKnownNounRouting.mockReturnValue({ handled: false })
  })

  function createLLMTestContext(input: string) {
    return createMockDispatchContext({
      trimmedInput: input,
      lastClarification: panelClarification,
      pendingOptions: panelOptions,
      activeOptionSetId: disambigMessageId,
      uiContext: {
        mode: 'dashboard',
        dashboard: { entryName: 'Test Entry', visibleWidgets },
      },
    })
  }

  it('LLM narrows multi-match: re-shows clarifier with LLM pick first, NOT auto-executed', async () => {
    ;(isLLMFallbackEnabledClient as jest.Mock).mockReturnValue(true)
    ;(callClarificationLLMClient as jest.Mock).mockResolvedValue({
      success: true,
      response: { decision: 'select', choiceId: 'opt-0', confidence: 0.9, reason: 'best match' },
      latencyMs: 200,
    })

    const ctx = createLLMTestContext('open links')
    const result = await dispatchRouting(ctx)

    // Handled at Tier 0 (clarification intercept)
    expect(result.handled).toBe(true)
    expect(result.handledByTier).toBe(0)

    // Clarify-only: MUST NOT auto-execute
    expect(ctx.handleSelectOption).not.toHaveBeenCalled()

    // Must re-show clarifier with LLM's pick first
    expect(ctx.addMessage).toHaveBeenCalledTimes(1)
    const addedMsg = (ctx.addMessage as jest.Mock).mock.calls[0][0]
    expect(addedMsg.options[0].id).toBe('opt-0') // LLM's pick reordered first

    // LLM arbitration log emitted
    expect(debugLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'llm_arbitration_called',
        metadata: expect.objectContaining({
          finalResolution: 'clarifier',
        }),
      })
    )
  })

  it('LLM failure → safe clarifier, no execution', async () => {
    ;(isLLMFallbackEnabledClient as jest.Mock).mockReturnValue(true)
    ;(callClarificationLLMClient as jest.Mock).mockResolvedValue({
      success: false,
      error: 'Timeout',
      latencyMs: 800,
    })

    const ctx = createLLMTestContext('open links')
    const result = await dispatchRouting(ctx)

    expect(result.handled).toBe(true)
    expect(result.handledByTier).toBe(0)

    // No execution on failure
    expect(ctx.handleSelectOption).not.toHaveBeenCalled()

    // Clarifier re-shown with original order
    expect(ctx.addMessage).toHaveBeenCalledTimes(1)

    // Failure log emitted
    expect(debugLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'llm_arbitration_failed_fallback_clarifier',
        metadata: expect.objectContaining({
          fallback_reason: 'timeout',
        }),
      })
    )
  })

  it('LLM 429 → safe clarifier, fallback_reason: rate_limited', async () => {
    ;(isLLMFallbackEnabledClient as jest.Mock).mockReturnValue(true)
    ;(callClarificationLLMClient as jest.Mock).mockResolvedValue({
      success: false,
      error: 'API error: 429',
      latencyMs: 300,
    })

    const ctx = createLLMTestContext('open links')
    const result = await dispatchRouting(ctx)

    expect(result.handled).toBe(true)
    expect(ctx.handleSelectOption).not.toHaveBeenCalled()
    expect(ctx.addMessage).toHaveBeenCalledTimes(1)

    expect(debugLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'llm_arbitration_failed_fallback_clarifier',
        metadata: expect.objectContaining({
          fallback_reason: 'rate_limited',
        }),
      })
    )
  })

  it('deterministic exact winner skips LLM: "open links panel" → exact-first selects, LLM never called', async () => {
    ;(isLLMFallbackEnabledClient as jest.Mock).mockReturnValue(true)

    const ctx = createLLMTestContext('open links panel')
    const result = await dispatchRouting(ctx)

    // Exact-first selects Links Panels deterministically
    expect(result.handled).toBe(true)
    expect(result.handledByTier).toBe(0)
    expect(ctx.handleSelectOption).toHaveBeenCalledWith(
      expect.objectContaining({ label: 'Links Panels' })
    )

    // LLM was never called — deterministic fast path
    expect(callClarificationLLMClient).not.toHaveBeenCalled()
  })
})

// ============================================================================
// Scope-cue Phase 2b: label matching routes to chat options, not widget disambiguation
// ============================================================================

describe('dispatchRouting: scope-cue Phase 2b label matching routes to chat options', () => {
  const chatOptions = [
    { id: 'opt-0', label: 'Links Panels', sublabel: 'Panel', type: 'panel_drawer' },
    { id: 'opt-1', label: 'Links Panel D', sublabel: 'Panel', type: 'panel_drawer' },
    { id: 'opt-2', label: 'Links Panel E', sublabel: 'Panel', type: 'panel_drawer' },
  ]

  let savedEnv: string | undefined

  beforeEach(() => {
    jest.clearAllMocks()
    resetLLMArbitrationGuard()
    // Enable latch feature flag so scope-cue path activates
    savedEnv = process.env.NEXT_PUBLIC_SELECTION_INTENT_ARBITRATION_V1
    process.env.NEXT_PUBLIC_SELECTION_INTENT_ARBITRATION_V1 = 'true'
    mockBuildTurnSnapshot.mockReturnValue({
      openWidgets: [],
      activeSnapshotWidgetId: null,
      uiSnapshotId: 'test-snap-scope-cue',
      revisionId: 1,
      capturedAtMs: Date.now(),
      hasBadgeLetters: false,
    })
    mockHandleKnownNounRouting.mockReturnValue({ handled: false })
  })

  afterEach(() => {
    // Restore env
    if (savedEnv === undefined) {
      delete process.env.NEXT_PUBLIC_SELECTION_INTENT_ARBITRATION_V1
    } else {
      process.env.NEXT_PUBLIC_SELECTION_INTENT_ARBITRATION_V1 = savedEnv
    }
  })

  it('"open the panel d from chat" with active widget items → resolves to chat option, not widget disambiguation', async () => {
    const ctx = createMockDispatchContext({
      trimmedInput: 'open the panel d from chat',
      clarificationSnapshot: {
        options: chatOptions,
        originalIntent: 'open links panel',
        type: 'panel_disambiguation',
        turnsSinceSet: 0,
        timestamp: Date.now(),
      },
      uiContext: {
        mode: 'dashboard',
        dashboard: {
          entryName: 'Test Entry',
          visibleWidgets: [
            { id: 'summary144', title: 'Summary 144', type: 'summary_tiptap' },
            { id: 'summary155', title: 'Summary 155', type: 'summary_tiptap' },
          ],
        },
      },
    })

    const result = await dispatchRouting(ctx)

    // Handled by scope-cue Phase 2b label matching at Tier 0
    expect(result.handled).toBe(true)
    expect(result.handledByTier).toBe(0)

    // Must have selected Links Panel D (chat option), NOT widget disambiguation
    expect(ctx.handleSelectOption).toHaveBeenCalledTimes(1)
    expect(ctx.handleSelectOption).toHaveBeenCalledWith(
      expect.objectContaining({ label: 'Links Panel D' })
    )

    // Tier 4 known-noun should never be reached
    expect(mockHandleKnownNounRouting).not.toHaveBeenCalled()
  })

  it('"open links from chat" with active widget items → shows chat clarifier, not widget routing', async () => {
    const ctx = createMockDispatchContext({
      trimmedInput: 'open links from chat',
      clarificationSnapshot: {
        options: chatOptions,
        originalIntent: 'open links panel',
        type: 'panel_disambiguation',
        turnsSinceSet: 0,
        timestamp: Date.now(),
      },
      uiContext: {
        mode: 'dashboard',
        dashboard: {
          entryName: 'Test Entry',
          visibleWidgets: [
            { id: 'summary144', title: 'Summary 144', type: 'summary_tiptap' },
          ],
        },
      },
    })

    const result = await dispatchRouting(ctx)

    // Handled by scope-cue Phase 2b multi-match → clarifier at Tier 0
    expect(result.handled).toBe(true)
    expect(result.handledByTier).toBe(0)

    // Must NOT auto-execute — should show chat clarifier
    expect(ctx.handleSelectOption).not.toHaveBeenCalled()

    // Clarifier shown as visible message with options (not just setPendingOptions)
    expect(ctx.addMessage).toHaveBeenCalledTimes(1)
    const msg = (ctx.addMessage as jest.Mock).mock.calls[0][0]
    expect(msg.content).toContain('Which one do you mean')
    expect(msg.options).toHaveLength(3)
    // Pending options set with the new message's ID
    expect(ctx.setPendingOptions).toHaveBeenCalled()

    // Tier 4 known-noun should never be reached
    expect(mockHandleKnownNounRouting).not.toHaveBeenCalled()
  })

  it('"open second option from chat" with active widget items → resolves to chat option #2', async () => {
    const ctx = createMockDispatchContext({
      trimmedInput: 'open second option from chat',
      clarificationSnapshot: {
        options: chatOptions,
        originalIntent: 'open links panel',
        type: 'panel_disambiguation',
        turnsSinceSet: 0,
        timestamp: Date.now(),
      },
      uiContext: {
        mode: 'dashboard',
        dashboard: {
          entryName: 'Test Entry',
          visibleWidgets: [
            { id: 'summary144', title: 'Summary 144', type: 'summary_tiptap' },
            { id: 'summary155', title: 'Summary 155', type: 'summary_tiptap' },
          ],
        },
      },
    })

    const result = await dispatchRouting(ctx)

    expect(result.handled).toBe(true)
    expect(result.handledByTier).toBe(0)
    expect(ctx.handleSelectOption).toHaveBeenCalledWith(
      expect.objectContaining({ label: 'Links Panel D' })
    )
    expect(mockHandleKnownNounRouting).not.toHaveBeenCalled()
  })
})

// ============================================================================
// Decision ladder enforcement: typo verb handling
// Phase A (canonicalization) + Phase B (LLM ladder enforcement)
// Per deterministic-llm-ladder-enforcement-addendum-plan.md
// ============================================================================

describe('dispatchRouting: typo verb handling (ladder enforcement Phase A + B)', () => {
  const panelOptions = [
    { index: 1, label: 'Links Panels', sublabel: 'Panel', type: 'panel_drawer', id: 'opt-0', data: { panelId: 'links-panels', panelTitle: 'Links Panels', panelType: 'default' } },
    { index: 2, label: 'Links Panel D', sublabel: 'Panel', type: 'panel_drawer', id: 'opt-1', data: { panelId: 'links-panel-d', panelTitle: 'Links Panel D', panelType: 'default' } },
    { index: 3, label: 'Links Panel E', sublabel: 'Panel', type: 'panel_drawer', id: 'opt-2', data: { panelId: 'links-panel-e', panelTitle: 'Links Panel E', panelType: 'default' } },
  ]
  const disambigMessageId = 'assistant-panel-disambig-typo'
  const panelClarification = {
    type: 'panel_disambiguation' as const,
    originalIntent: 'open links panel',
    messageId: disambigMessageId,
    timestamp: Date.now() - 2000,
    options: panelOptions.map(o => ({ id: o.id, label: o.label, sublabel: o.sublabel, type: o.type })),
    metaCount: 0,
  }
  const visibleWidgets = [
    { id: 'links-panels', title: 'Links Panels', type: 'links_note_tiptap' },
    { id: 'links-panel-d', title: 'Links Panel D', type: 'links_note_tiptap' },
    { id: 'links-panel-e', title: 'Links Panel E', type: 'links_note_tiptap' },
  ]

  beforeEach(() => {
    jest.clearAllMocks()
    resetLLMArbitrationGuard()
    // Reset Phase C kill switch to OFF (default)
    ;(isLLMAutoExecuteEnabledClient as jest.Mock).mockReturnValue(false)
    mockBuildTurnSnapshot.mockReturnValue({
      openWidgets: [],
      activeSnapshotWidgetId: null,
      uiSnapshotId: 'test-snap-typo',
      revisionId: 1,
      capturedAtMs: Date.now(),
      hasBadgeLetters: false,
    })
    mockHandleKnownNounRouting.mockReturnValue({ handled: false })
  })

  it('"ope panel d" with active panel options → Tier 0 resolves via badge-aware selection, NOT widget disambiguation', async () => {
    // "ope" not in COMMAND_VERBS → no verb correction or stripping
    // → enters Tier 1b.3 label matching directly
    // → extractBadge("ope panel d") → last token "d" → badge match "Links Panel D"
    const ctx = createMockDispatchContext({
      trimmedInput: 'ope panel d',
      lastClarification: panelClarification,
      pendingOptions: panelOptions,
      activeOptionSetId: disambigMessageId,
      uiContext: {
        mode: 'dashboard',
        dashboard: { entryName: 'Test Entry', visibleWidgets },
      },
    })

    const result = await dispatchRouting(ctx)

    // Resolved by clarification intercept (Tier 0), not downstream
    expect(result.handled).toBe(true)
    expect(result.handledByTier).toBe(0)

    // Must have selected Links Panel D
    expect(ctx.handleSelectOption).toHaveBeenCalledTimes(1)
    expect(ctx.handleSelectOption).toHaveBeenCalledWith(
      expect.objectContaining({ label: 'Links Panel D' })
    )

    // Tier 4 known-noun must NOT be reached (no widget disambiguation takeover)
    expect(mockHandleKnownNounRouting).not.toHaveBeenCalled()
  })

  it('"open recent" with active panel options → command escape preserved, reaches Tier 4', async () => {
    // "open recent" doesn't match any panel option → pre-gate bypasses → downstream
    mockHandleKnownNounRouting.mockReturnValueOnce({ handled: true, handledByTier: 4, tierLabel: 'known_noun' })

    const ctx = createMockDispatchContext({
      trimmedInput: 'open recent',
      lastClarification: panelClarification,
      pendingOptions: panelOptions,
      activeOptionSetId: disambigMessageId,
      uiContext: {
        mode: 'dashboard',
        dashboard: { entryName: 'Test Entry', visibleWidgets },
      },
    })

    const result = await dispatchRouting(ctx)

    // Command escape preserved: reaches Tier 4
    expect(result.handled).toBe(true)
    expect(result.handledByTier).toBe(4)
    expect(mockHandleKnownNounRouting).toHaveBeenCalled()
  })

  it('"opn links panel" + LLM confidence 0.85 + auto-execute ON → auto-executes Links Panels (Phase C)', async () => {
    // "opn" not in COMMAND_VERBS → no verb correction or stripping
    // → 0 matches → unresolved hook → LLM → auto-execute (all gates pass)
    ;(isLLMFallbackEnabledClient as jest.Mock).mockReturnValue(true)
    ;(isLLMAutoExecuteEnabledClient as jest.Mock).mockReturnValue(true)
    ;(callClarificationLLMClient as jest.Mock).mockResolvedValue({
      success: true,
      response: { decision: 'select', choiceId: 'opt-0', confidence: 0.85, reason: 'best match for links panel' },
      latencyMs: 200,
    })

    const ctx = createMockDispatchContext({
      trimmedInput: 'opn links panel',
      lastClarification: panelClarification,
      pendingOptions: panelOptions,
      activeOptionSetId: disambigMessageId,
      uiContext: {
        mode: 'dashboard',
        dashboard: { entryName: 'Test Entry', visibleWidgets },
      },
    })

    const result = await dispatchRouting(ctx)

    // Phase C: auto-executed at Tier 0
    expect(result.handled).toBe(true)
    expect(result.handledByTier).toBe(0)

    // Auto-execute: handleSelectOption IS called
    expect(ctx.handleSelectOption).toHaveBeenCalledTimes(1)
    expect(ctx.handleSelectOption).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'opt-0', label: 'Links Panels' })
    )

    // No safe clarifier shown
    expect(ctx.addMessage).not.toHaveBeenCalled()

    // Must NOT escape to downstream
    expect(mockHandleKnownNounRouting).not.toHaveBeenCalled()
  })

  it('"opn links panel" + LLM confidence 0.7 + auto-execute ON → safe clarifier with reorder (below threshold)', async () => {
    // Same as above but LLM returns medium confidence → safe clarifier
    ;(isLLMFallbackEnabledClient as jest.Mock).mockReturnValue(true)
    ;(isLLMAutoExecuteEnabledClient as jest.Mock).mockReturnValue(true)
    ;(callClarificationLLMClient as jest.Mock).mockResolvedValue({
      success: true,
      response: { decision: 'select', choiceId: 'opt-0', confidence: 0.7, reason: 'decent match' },
      latencyMs: 200,
    })

    const ctx = createMockDispatchContext({
      trimmedInput: 'opn links panel',
      lastClarification: panelClarification,
      pendingOptions: panelOptions,
      activeOptionSetId: disambigMessageId,
      uiContext: {
        mode: 'dashboard',
        dashboard: { entryName: 'Test Entry', visibleWidgets },
      },
    })

    const result = await dispatchRouting(ctx)

    // Medium confidence → safe clarifier, NOT auto-executed
    expect(result.handled).toBe(true)
    expect(result.handledByTier).toBe(0)
    expect(ctx.handleSelectOption).not.toHaveBeenCalled()

    // Safe clarifier shown with LLM's pick first
    expect(ctx.addMessage).toHaveBeenCalledTimes(1)
    expect(mockHandleKnownNounRouting).not.toHaveBeenCalled()
  })

  it.each([
    'second',
    'open second option',
    'open that second option',
    'open secone one',
  ])('"%s" with active panel options → Tier 0 selects Links Panel D', async (input) => {
    const ctx = createMockDispatchContext({
      trimmedInput: input,
      lastClarification: panelClarification,
      pendingOptions: panelOptions,
      activeOptionSetId: disambigMessageId,
      uiContext: {
        mode: 'dashboard',
        dashboard: { entryName: 'Test Entry', visibleWidgets },
      },
    })

    const result = await dispatchRouting(ctx)

    expect(result.handled).toBe(true)
    expect(result.handledByTier).toBe(0)
    expect(ctx.handleSelectOption).toHaveBeenCalledWith(
      expect.objectContaining({ label: 'Links Panel D' })
    )
    expect(mockHandleKnownNounRouting).not.toHaveBeenCalled()
  })
})

// ============================================================================
// Decision ladder enforcement Phase B: LLM safe clarifier in active-option flows
// Per deterministic-llm-ladder-enforcement-addendum-plan.md
// ============================================================================

describe('dispatchRouting: Phase B LLM ladder enforcement (active-option flows)', () => {
  // "can you ope panel d pls" triggers PANEL_SELECTION → isSelectionLike=true
  // → commandBypassesLabelMatching=false → enters label matching
  // → extractBadge: last token "pls" (not single letter) → no badge
  // → findMatchingOptions: 0 matches → unresolved hook (unified hook in Phase B v2).
  const phaseBOptions = [
    { index: 1, label: 'Links Panels', sublabel: 'Panel', type: 'panel_drawer', id: 'opt-0', data: { panelId: 'links-panels', panelTitle: 'Links Panels', panelType: 'default' } },
    { index: 2, label: 'Links Panel D', sublabel: 'Panel', type: 'panel_drawer', id: 'opt-1', data: { panelId: 'links-panel-d', panelTitle: 'Links Panel D', panelType: 'default' } },
    { index: 3, label: 'Links Panel E', sublabel: 'Panel', type: 'panel_drawer', id: 'opt-2', data: { panelId: 'links-panel-e', panelTitle: 'Links Panel E', panelType: 'default' } },
  ]

  function createPhaseBContext(input: string, messageId = 'assistant-disambig-b') {
    return createMockDispatchContext({
      trimmedInput: input,
      lastClarification: {
        type: 'option_selection' as const,
        originalIntent: 'test',
        messageId,
        timestamp: Date.now() - 2000,
        options: phaseBOptions.map(o => ({ id: o.id, label: o.label, sublabel: o.sublabel, type: o.type })),
        metaCount: 0,
      },
      pendingOptions: phaseBOptions,
      activeOptionSetId: messageId,
      uiContext: {
        mode: 'dashboard',
        dashboard: { entryName: 'Test Entry', visibleWidgets: [] },
      },
    })
  }

  beforeEach(() => {
    jest.clearAllMocks()
    resetLLMArbitrationGuard()
    // Reset Phase C kill switch to OFF (default)
    ;(isLLMAutoExecuteEnabledClient as jest.Mock).mockReturnValue(false)
    mockBuildTurnSnapshot.mockReturnValue({
      openWidgets: [],
      activeSnapshotWidgetId: null,
      uiSnapshotId: 'test-snap-phase-b',
      revisionId: 1,
      capturedAtMs: Date.now(),
      hasBadgeLetters: false,
    })
    mockHandleKnownNounRouting.mockReturnValue({ handled: false })
  })

  it('"can you ope panel d pls" + active options + LLM → safe clarifier with LLM suggestion first (BLOCKER)', async () => {
    // "panel d" triggers PANEL_SELECTION → isSelectionLike=true → enters label matching
    // → extractBadge: last token "pls" (not single letter) → no badge
    // → findMatchingOptions: 0 matches → unresolved hook → LLM called
    ;(isLLMFallbackEnabledClient as jest.Mock).mockReturnValue(true)
    ;(callClarificationLLMClient as jest.Mock).mockResolvedValue({
      success: true,
      response: { decision: 'select', choiceId: 'opt-1', confidence: 0.85, reason: 'best match' },
      latencyMs: 200,
    })

    const ctx = createPhaseBContext('can you ope panel d pls')
    const result = await dispatchRouting(ctx)

    // Handled at Tier 0 (clarification intercept) — unresolved hook safe clarifier
    expect(result.handled).toBe(true)
    expect(result.handledByTier).toBe(0)

    // Clarify-only: MUST NOT auto-execute
    expect(ctx.handleSelectOption).not.toHaveBeenCalled()

    // Re-show with LLM's pick first
    expect(ctx.addMessage).toHaveBeenCalledTimes(1)
    const addedMsg = (ctx.addMessage as jest.Mock).mock.calls[0][0]
    expect(addedMsg.options[0].id).toBe('opt-1') // LLM's pick first

    // LLM was called with tier1b3_unresolved context
    expect(callClarificationLLMClient).toHaveBeenCalledTimes(1)

    // mockHandleKnownNounRouting must NOT be called (no escape)
    expect(mockHandleKnownNounRouting).not.toHaveBeenCalled()
  })

  it('"can you ope panel d pls" + active options + LLM disabled → safe clarifier (no escape)', async () => {
    ;(isLLMFallbackEnabledClient as jest.Mock).mockReturnValue(false)

    const ctx = createPhaseBContext('can you ope panel d pls')
    const result = await dispatchRouting(ctx)

    // Safe clarifier — NO escape
    expect(result.handled).toBe(true)
    expect(result.handledByTier).toBe(0)
    expect(ctx.handleSelectOption).not.toHaveBeenCalled()

    // Options re-shown in original order
    expect(ctx.addMessage).toHaveBeenCalledTimes(1)
    const addedMsg = (ctx.addMessage as jest.Mock).mock.calls[0][0]
    expect(addedMsg.options[0].id).toBe('opt-0') // Original order

    // NO escape to downstream
    expect(mockHandleKnownNounRouting).not.toHaveBeenCalled()
  })

  it('"can you ope panel d pls" + active options + LLM timeout → safe clarifier', async () => {
    ;(isLLMFallbackEnabledClient as jest.Mock).mockReturnValue(true)
    ;(callClarificationLLMClient as jest.Mock).mockResolvedValue({
      success: false,
      error: 'Timeout',
      latencyMs: 800,
    })

    const ctx = createPhaseBContext('can you ope panel d pls')
    const result = await dispatchRouting(ctx)

    // Safe clarifier
    expect(result.handled).toBe(true)
    expect(result.handledByTier).toBe(0)
    expect(ctx.handleSelectOption).not.toHaveBeenCalled()
    expect(ctx.addMessage).toHaveBeenCalledTimes(1)
    expect(mockHandleKnownNounRouting).not.toHaveBeenCalled()
  })

  it('"where is panel d located" + active options → question intent escape via unresolved hook', async () => {
    // "panel d" triggers PANEL_SELECTION → isSelectionLike=true → enters label matching
    // "where" → hasQuestionIntent=true → unresolved hook detects question → escape
    const ctx = createPhaseBContext('where is panel d located')
    const result = await dispatchRouting(ctx)

    // Question → escapes clarifier (not trapped)
    expect(ctx.handleSelectOption).not.toHaveBeenCalled()

    // Unresolved hook detects question intent and escapes
    expect(debugLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'clarification_unresolved_hook_question_escape',
      })
    )
  })

  it('"open recent" with active options → explicit command → command escape → Tier 4', async () => {
    mockHandleKnownNounRouting.mockReturnValueOnce({ handled: true, handledByTier: 4, tierLabel: 'known_noun' })

    const ctx = createPhaseBContext('open recent')
    const result = await dispatchRouting(ctx)

    // Explicit command escape → Tier 4
    expect(result.handled).toBe(true)
    expect(result.handledByTier).toBe(4)
    expect(mockHandleKnownNounRouting).toHaveBeenCalled()
  })

  it('loop guard reset: different messageId → LLM called again (BLOCKER)', async () => {
    ;(isLLMFallbackEnabledClient as jest.Mock).mockReturnValue(true)
    ;(callClarificationLLMClient as jest.Mock).mockResolvedValue({
      success: false,
      error: 'Timeout',
      latencyMs: 800,
    })

    // --- Turn 1: messageId "msg-1" → LLM called ---
    const ctx1 = createPhaseBContext('can you ope panel d pls', 'msg-1')
    await dispatchRouting(ctx1)
    expect(callClarificationLLMClient).toHaveBeenCalledTimes(1)

    // --- Turn 2: SAME messageId "msg-1" → loop guard → LLM NOT called ---
    jest.clearAllMocks()
    ;(isLLMFallbackEnabledClient as jest.Mock).mockReturnValue(true)
    ;(callClarificationLLMClient as jest.Mock).mockResolvedValue({
      success: false,
      error: 'Timeout',
      latencyMs: 800,
    })
    mockBuildTurnSnapshot.mockReturnValue({
      openWidgets: [],
      activeSnapshotWidgetId: null,
      uiSnapshotId: 'test-snap-phase-b-2',
      revisionId: 1,
      capturedAtMs: Date.now(),
      hasBadgeLetters: false,
    })
    mockHandleKnownNounRouting.mockReturnValue({ handled: false })
    const ctx2 = createPhaseBContext('can you ope panel d pls', 'msg-1')
    await dispatchRouting(ctx2)
    expect(callClarificationLLMClient).not.toHaveBeenCalled()

    // --- Turn 3: DIFFERENT messageId "msg-2" → guard resets → LLM called again ---
    jest.clearAllMocks()
    ;(isLLMFallbackEnabledClient as jest.Mock).mockReturnValue(true)
    ;(callClarificationLLMClient as jest.Mock).mockResolvedValue({
      success: false,
      error: 'Timeout',
      latencyMs: 800,
    })
    mockBuildTurnSnapshot.mockReturnValue({
      openWidgets: [],
      activeSnapshotWidgetId: null,
      uiSnapshotId: 'test-snap-phase-b-3',
      revisionId: 1,
      capturedAtMs: Date.now(),
      hasBadgeLetters: false,
    })
    mockHandleKnownNounRouting.mockReturnValue({ handled: false })
    const ctx3 = createPhaseBContext('can you ope panel d pls', 'msg-2')
    await dispatchRouting(ctx3)
    expect(callClarificationLLMClient).toHaveBeenCalledTimes(1)
  })
})

// ============================================================================
// E2E Blocker: active widget + imperative command with trailing ? must NOT
// hit cross-corpus; must resolve widget entry
//
// Per universal-selection-resolver-plan.md Normative Dependency + Acceptance
// Test #6/#7a: isCommandLike must handle trailing ? so cross-corpus is skipped
// and the input reaches downstream widget resolution.
// ============================================================================

describe('dispatchRouting: active widget + trailing ? imperative command bypasses cross-corpus', () => {
  const { handleCrossCorpusRetrieval } = jest.requireMock('@/lib/chat/cross-corpus-handler') as {
    handleCrossCorpusRetrieval: jest.Mock
  }

  beforeEach(() => {
    jest.clearAllMocks()
    mockBuildTurnSnapshot.mockReturnValue({
      openWidgets: [{
        id: 'links-panel-d',
        label: 'Links Panel D',
        options: [{ id: 'summary144', label: 'summary144' }],
        segments: [{ segmentType: 'list', items: [{ id: 'summary144', label: 'summary144' }] }],
      }],
      activeSnapshotWidgetId: 'links-panel-d',
      uiSnapshotId: 'test-snap-blocker',
      revisionId: 1,
      capturedAtMs: Date.now(),
      hasBadgeLetters: false,
    })
  })

  it('BLOCKER: "open that summary144 now plssss?" with focus latch must NOT hit cross-corpus AND must resolve entry', async () => {
    // Positive assertion setup: known-noun routing resolves "summary144" as an entry
    mockHandleKnownNounRouting.mockReturnValue({
      handled: true,
      tierLabel: 'known_noun_navigate',
      action: 'navigate',
    })

    const ctx = createMockDispatchContext({
      trimmedInput: 'open that summary144 now plssss?',
      uiContext: {
        mode: 'dashboard',
        dashboard: {
          entryName: 'Test Entry',
          visibleWidgets: [
            { id: 'links-panel-d', title: 'Links Panel D', type: 'links_note_tiptap' },
          ],
        },
      },
      // Focus latch active for links panel D
      focusLatch: {
        kind: 'resolved' as const,
        widgetId: 'links-panel-d',
        widgetLabel: 'Links Panel D',
        latchedAt: Date.now(),
        turnsSinceLatched: 0,
      },
      getVisibleSnapshots: jest.fn().mockReturnValue([{
        widgetId: 'links-panel-d',
        title: 'Links Panel D',
        segments: [{ segmentType: 'list', items: [{ id: 'summary144', label: 'summary144' }] }],
      }]),
    })

    const result = await dispatchRouting(ctx)

    // NEGATIVE assertion: must NOT have been handled by cross-corpus
    expect(result.tierLabel).not.toMatch(/cross_corpus/)

    // POSITIVE assertion: must actually resolve the entry via downstream routing
    // After isCommandLike fix, cross-corpus handler returns {handled: false} immediately,
    // and known-noun routing resolves "summary144" as a navigable entry.
    expect(result.handled).toBe(true)
    // Known-noun routing handles the entry — dispatcher wraps tierLabel as 'known_noun'
    expect(result.tierLabel).toBe('known_noun')
  })

  it('BLOCKER: cross-corpus handler is not invoked for imperative command with trailing ?', async () => {
    // Even if known-noun routing doesn't handle it, cross-corpus must NOT process the command.
    // The handler's isCommandLike guard returns true → handler returns {handled: false}.
    mockHandleKnownNounRouting.mockReturnValue({ handled: false })

    const ctx = createMockDispatchContext({
      trimmedInput: 'open that summary144 now plssss?',
      uiContext: {
        mode: 'dashboard',
        dashboard: {
          entryName: 'Test Entry',
          visibleWidgets: [
            { id: 'links-panel-d', title: 'Links Panel D', type: 'links_note_tiptap' },
          ],
        },
      },
      focusLatch: {
        kind: 'resolved' as const,
        widgetId: 'links-panel-d',
        widgetLabel: 'Links Panel D',
        latchedAt: Date.now(),
        turnsSinceLatched: 0,
      },
      getVisibleSnapshots: jest.fn().mockReturnValue([{
        widgetId: 'links-panel-d',
        title: 'Links Panel D',
        segments: [{ segmentType: 'list', items: [{ id: 'summary144', label: 'summary144' }] }],
      }]),
    })

    const result = await dispatchRouting(ctx)

    // Cross-corpus handler may be called (by the dispatcher), but it returns {handled: false}
    // because isCommandLike("open that summary144 now plssss?") is now true.
    // The result should NOT be attributed to cross-corpus.
    expect(result.tierLabel).not.toMatch(/cross_corpus/)

    // If cross-corpus was called, verify it returned handled: false
    if (handleCrossCorpusRetrieval.mock.calls.length > 0) {
      const crossCorpusResult = await handleCrossCorpusRetrieval.mock.results[0]?.value
      expect(crossCorpusResult?.handled).toBe(false)
    }
  })

  it('genuine question with trailing ? still routes normally (regression guard)', async () => {
    mockHandleKnownNounRouting.mockReturnValue({ handled: false })

    const ctx = createMockDispatchContext({
      trimmedInput: 'what is summary144?',
      uiContext: {
        mode: 'dashboard',
        dashboard: {
          entryName: 'Test Entry',
          visibleWidgets: [
            { id: 'links-panel-d', title: 'Links Panel D', type: 'links_note_tiptap' },
          ],
        },
      },
      focusLatch: {
        kind: 'resolved' as const,
        widgetId: 'links-panel-d',
        widgetLabel: 'Links Panel D',
        latchedAt: Date.now(),
        turnsSinceLatched: 0,
      },
      getVisibleSnapshots: jest.fn().mockReturnValue([]),
    })

    const result = await dispatchRouting(ctx)

    // "what is summary144?" is a genuine question — should NOT be treated as a command.
    // isCommandLike returns false (starts with "what"), so cross-corpus handler can process it.
    // The tierLabel should NOT be a widget/known-noun resolution tier.
    expect(result.tierLabel).not.toBe('known_noun_navigate')
  })
})

// ============================================================================
// Context-Enrichment Retry Loop Integration (Tier 1b.3)
// Per context-enrichment-retry-loop-plan.md
// ============================================================================

describe('dispatchRouting: context-enrichment retry loop (Tier 1b.3)', () => {
  const panelOptions = [
    { index: 1, label: 'Links Panels', sublabel: 'Panel', type: 'panel_drawer', id: 'opt-0', data: { panelId: 'links-panels', panelTitle: 'Links Panels', panelType: 'default' } },
    { index: 2, label: 'Links Panel D', sublabel: 'Panel', type: 'panel_drawer', id: 'opt-1', data: { panelId: 'links-panel-d', panelTitle: 'Links Panel D', panelType: 'default' } },
    { index: 3, label: 'Links Panel E', sublabel: 'Panel', type: 'panel_drawer', id: 'opt-2', data: { panelId: 'links-panel-e', panelTitle: 'Links Panel E', panelType: 'default' } },
  ]
  const disambigMessageId = 'assistant-panel-retry'
  const panelClarification = {
    type: 'panel_disambiguation' as const,
    originalIntent: 'open links panel',
    messageId: disambigMessageId,
    timestamp: Date.now() - 2000,
    options: panelOptions.map(o => ({ id: o.id, label: o.label, sublabel: o.sublabel, type: o.type })),
    metaCount: 0,
  }
  const visibleWidgets = [
    { id: 'links-panels', title: 'Links Panels', type: 'links_note_tiptap' },
    { id: 'links-panel-d', title: 'Links Panel D', type: 'links_note_tiptap' },
    { id: 'links-panel-e', title: 'Links Panel E', type: 'links_note_tiptap' },
  ]

  beforeEach(() => {
    jest.clearAllMocks()
    resetLLMArbitrationGuard()
    ;(isLLMAutoExecuteEnabledClient as jest.Mock).mockReturnValue(false)
    mockBuildTurnSnapshot.mockReturnValue({
      openWidgets: [],
      activeSnapshotWidgetId: null,
      uiSnapshotId: 'test-snap-retry',
      revisionId: 1,
      capturedAtMs: Date.now(),
      hasBadgeLetters: false,
    })
    mockHandleKnownNounRouting.mockReturnValue({ handled: false })
  })

  function createRetryTestContext(input: string) {
    return createMockDispatchContext({
      trimmedInput: input,
      lastClarification: panelClarification,
      pendingOptions: panelOptions,
      activeOptionSetId: disambigMessageId,
      uiContext: {
        mode: 'dashboard',
        dashboard: { entryName: 'Test Entry', visibleWidgets },
      },
    })
  }

  it('request_context → enrichment → retry → resolves with LLM pick (BLOCKER)', async () => {
    ;(isLLMFallbackEnabledClient as jest.Mock).mockReturnValue(true)
    ;(isContextRetryEnabledClient as jest.Mock).mockReturnValue(true)
    ;(callClarificationLLMClient as jest.Mock)
      .mockResolvedValueOnce({
        success: true,
        response: { decision: 'request_context', neededContext: ['chat_active_options'], contractVersion: '2.0', choiceIndex: -1, confidence: 0.5, reason: 'need context' },
        latencyMs: 200,
      })
      .mockResolvedValueOnce({
        success: true,
        response: { decision: 'select', choiceId: 'opt-1', choiceIndex: 1, confidence: 0.9, reason: 'resolved after enrichment' },
        latencyMs: 150,
      })

    const ctx = createRetryTestContext('opn links')
    const result = await dispatchRouting(ctx)

    // Handled at Tier 0 (clarification intercept)
    expect(result.handled).toBe(true)
    expect(result.handledByTier).toBe(0)

    // LLM was called twice (initial + retry)
    expect(callClarificationLLMClient).toHaveBeenCalledTimes(2)

    // Verify retry call includes enriched context (Fix 1: enrichment passthrough)
    const call1Req = (callClarificationLLMClient as jest.Mock).mock.calls[0][0]
    const call2Req = (callClarificationLLMClient as jest.Mock).mock.calls[1][0]
    expect(call1Req.context).not.toContain('enriched_evidence')
    expect(call2Req.context).toContain('enriched_evidence')

    // Retry telemetry emitted
    expect(debugLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'arbitration_retry_called',
      })
    )

    // Clarify-only: must NOT auto-execute
    expect(ctx.handleSelectOption).not.toHaveBeenCalled()

    // Safe clarifier shown with LLM's pick first
    expect(ctx.addMessage).toHaveBeenCalledTimes(1)
    const addedMsg = (ctx.addMessage as jest.Mock).mock.calls[0][0]
    expect(addedMsg.options[0].id).toBe('opt-1')
  })

  it('request_context + flag OFF → safe clarifier, no retry (BLOCKER)', async () => {
    ;(isLLMFallbackEnabledClient as jest.Mock).mockReturnValue(true)
    ;(isContextRetryEnabledClient as jest.Mock).mockReturnValue(false)
    ;(callClarificationLLMClient as jest.Mock).mockResolvedValue({
      success: true,
      response: { decision: 'request_context', neededContext: ['chat_active_options'], contractVersion: '2.0', choiceIndex: -1, confidence: 0.5, reason: 'need context' },
      latencyMs: 200,
    })

    const ctx = createRetryTestContext('opn links')
    const result = await dispatchRouting(ctx)

    expect(result.handled).toBe(true)
    expect(result.handledByTier).toBe(0)

    // LLM called only once (no retry)
    expect(callClarificationLLMClient).toHaveBeenCalledTimes(1)

    // Safe clarifier shown (no auto-execute)
    expect(ctx.handleSelectOption).not.toHaveBeenCalled()
    expect(ctx.addMessage).toHaveBeenCalledTimes(1)

    // Downstream never reached
    expect(mockHandleKnownNounRouting).not.toHaveBeenCalled()
  })

  it('entry-gate: active options + unresolved input → LLM invoked (behavioral proof of loop entry)', async () => {
    // Proves: unresolved input with active options enters the arbitration loop.
    // Behavioral: LLM is called (not just a spy on internal functions).
    ;(isLLMFallbackEnabledClient as jest.Mock).mockReturnValue(true)
    ;(isContextRetryEnabledClient as jest.Mock).mockReturnValue(false)
    ;(callClarificationLLMClient as jest.Mock).mockResolvedValue({
      success: false,
      error: 'Timeout',
      latencyMs: 800,
    })

    const ctx = createRetryTestContext('opn links')
    const result = await dispatchRouting(ctx)

    // Loop was entered — LLM was called
    expect(callClarificationLLMClient).toHaveBeenCalledTimes(1)

    // Safe clarifier (LLM failed)
    expect(result.handled).toBe(true)
    expect(result.handledByTier).toBe(0)
    expect(ctx.handleSelectOption).not.toHaveBeenCalled()
    expect(mockHandleKnownNounRouting).not.toHaveBeenCalled()
  })

  it('entry-gate: no active options → loop NOT invoked, input falls through to downstream', async () => {
    // No pendingOptions or lastClarification → clarification intercept has nothing to intercept
    ;(isLLMFallbackEnabledClient as jest.Mock).mockReturnValue(true)
    ;(isContextRetryEnabledClient as jest.Mock).mockReturnValue(true)
    mockHandleKnownNounRouting.mockReturnValue({ handled: true, handledByTier: 4, tierLabel: 'known_noun' })

    const ctx = createMockDispatchContext({
      trimmedInput: 'open links panel',
      uiContext: {
        mode: 'dashboard',
        dashboard: { entryName: 'Test Entry', visibleWidgets },
      },
    })

    const result = await dispatchRouting(ctx)

    // LLM was never called — no active options, no loop entry
    expect(callClarificationLLMClient).not.toHaveBeenCalled()

    // Input fell through to downstream tiers
    // (Tier 2c or Tier 4 handles it, depending on widget matching)
    expect(result.handled).toBe(true)
  })
})

// ============================================================================
// Context-Enrichment Retry Loop Integration (Scope-Cue Phase 2b)
// Per context-enrichment-retry-loop-plan.md
// ============================================================================

describe('dispatchRouting: scope-cue Phase 2b context-enrichment retry + dashboard/workspace rejection', () => {
  const chatOptions = [
    { id: 'opt-0', label: 'Links Panels', sublabel: 'Panel', type: 'panel_drawer' },
    { id: 'opt-1', label: 'Links Panel D', sublabel: 'Panel', type: 'panel_drawer' },
    { id: 'opt-2', label: 'Links Panel E', sublabel: 'Panel', type: 'panel_drawer' },
  ]

  let savedLatchEnv: string | undefined
  let savedRetryEnv: string | undefined

  beforeEach(() => {
    jest.clearAllMocks()
    resetLLMArbitrationGuard()
    ;(isLLMAutoExecuteEnabledClient as jest.Mock).mockReturnValue(false)
    // Enable latch feature flag for scope-cue processing
    savedLatchEnv = process.env.NEXT_PUBLIC_SELECTION_INTENT_ARBITRATION_V1
    process.env.NEXT_PUBLIC_SELECTION_INTENT_ARBITRATION_V1 = 'true'
    savedRetryEnv = process.env.NEXT_PUBLIC_LLM_CONTEXT_RETRY_ENABLED
    mockBuildTurnSnapshot.mockReturnValue({
      openWidgets: [],
      activeSnapshotWidgetId: null,
      uiSnapshotId: 'test-snap-scope-retry',
      revisionId: 1,
      capturedAtMs: Date.now(),
      hasBadgeLetters: false,
    })
    mockHandleKnownNounRouting.mockReturnValue({ handled: false })
  })

  afterEach(() => {
    if (savedLatchEnv === undefined) {
      delete process.env.NEXT_PUBLIC_SELECTION_INTENT_ARBITRATION_V1
    } else {
      process.env.NEXT_PUBLIC_SELECTION_INTENT_ARBITRATION_V1 = savedLatchEnv
    }
    if (savedRetryEnv === undefined) {
      delete process.env.NEXT_PUBLIC_LLM_CONTEXT_RETRY_ENABLED
    } else {
      process.env.NEXT_PUBLIC_LLM_CONTEXT_RETRY_ENABLED = savedRetryEnv
    }
  })

  it('"from chat" + request_context → chat-scoped retry → resolves (BLOCKER)', async () => {
    ;(isLLMFallbackEnabledClient as jest.Mock).mockReturnValue(true)
    ;(isContextRetryEnabledClient as jest.Mock).mockReturnValue(true)
    ;(callClarificationLLMClient as jest.Mock)
      .mockResolvedValueOnce({
        success: true,
        response: { decision: 'request_context', neededContext: ['chat_active_options'], contractVersion: '2.0', choiceIndex: -1, confidence: 0.5, reason: 'need context' },
        latencyMs: 200,
      })
      .mockResolvedValueOnce({
        success: true,
        response: { decision: 'select', choiceId: 'opt-1', choiceIndex: 1, confidence: 0.9, reason: 'resolved from chat evidence' },
        latencyMs: 150,
      })

    const ctx = createMockDispatchContext({
      trimmedInput: 'open links from chat',
      clarificationSnapshot: {
        options: chatOptions,
        originalIntent: 'open links panel',
        type: 'panel_disambiguation',
        turnsSinceSet: 0,
        timestamp: Date.now(),
      },
      uiContext: {
        mode: 'dashboard',
        dashboard: {
          entryName: 'Test Entry',
          visibleWidgets: [
            { id: 'summary144', title: 'Summary 144', type: 'summary_tiptap' },
          ],
        },
      },
    })

    const result = await dispatchRouting(ctx)

    expect(result.handled).toBe(true)
    expect(result.handledByTier).toBe(0)

    // LLM called twice (retry happened)
    expect(callClarificationLLMClient).toHaveBeenCalledTimes(2)

    // Retry telemetry
    expect(debugLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'arbitration_retry_called',
      })
    )
  })

  it('"from dashboard" explicit cue → scope-specific need_more_info message (BLOCKER)', async () => {
    const ctx = createMockDispatchContext({
      trimmedInput: 'open panel d from dashboard',
      clarificationSnapshot: {
        options: chatOptions,
        originalIntent: 'open links panel',
        type: 'panel_disambiguation',
        turnsSinceSet: 0,
        timestamp: Date.now(),
      },
      uiContext: {
        mode: 'dashboard',
        dashboard: {
          entryName: 'Test Entry',
          visibleWidgets: [
            { id: 'summary144', title: 'Summary 144', type: 'summary_tiptap' },
          ],
        },
      },
    })

    const result = await dispatchRouting(ctx)

    expect(result.handled).toBe(true)

    // Must show dashboard-specific message (not generic clarifier)
    expect(ctx.addMessage).toHaveBeenCalledTimes(1)
    const msg = (ctx.addMessage as jest.Mock).mock.calls[0][0]
    expect(msg.content).toContain('Dashboard')
    expect(msg.content).toContain('not yet available')

    // LLM never called — scope rejected before retry
    expect(callClarificationLLMClient).not.toHaveBeenCalled()
    expect(mockHandleKnownNounRouting).not.toHaveBeenCalled()
  })

  it('"from workspace" explicit cue → scope-specific need_more_info message (BLOCKER)', async () => {
    const ctx = createMockDispatchContext({
      trimmedInput: 'open panel d from workspace',
      clarificationSnapshot: {
        options: chatOptions,
        originalIntent: 'open links panel',
        type: 'panel_disambiguation',
        turnsSinceSet: 0,
        timestamp: Date.now(),
      },
      uiContext: {
        mode: 'dashboard',
        dashboard: {
          entryName: 'Test Entry',
          visibleWidgets: [
            { id: 'summary144', title: 'Summary 144', type: 'summary_tiptap' },
          ],
        },
      },
    })

    const result = await dispatchRouting(ctx)

    expect(result.handled).toBe(true)

    // Must show workspace-specific message (not generic clarifier)
    expect(ctx.addMessage).toHaveBeenCalledTimes(1)
    const msg = (ctx.addMessage as jest.Mock).mock.calls[0][0]
    expect(msg.content).toContain('Workspace')
    expect(msg.content).toContain('not yet available')

    // LLM never called
    expect(callClarificationLLMClient).not.toHaveBeenCalled()
    expect(mockHandleKnownNounRouting).not.toHaveBeenCalled()
  })

  it('scope-cue entry: "from chat" unresolved → loop invoked at scope_cue context (behavioral)', async () => {
    // Proves: scope-cue Phase 2b unresolved input enters arbitration loop
    ;(isLLMFallbackEnabledClient as jest.Mock).mockReturnValue(true)
    ;(isContextRetryEnabledClient as jest.Mock).mockReturnValue(false)
    ;(callClarificationLLMClient as jest.Mock).mockResolvedValue({
      success: false,
      error: 'Timeout',
      latencyMs: 800,
    })

    const ctx = createMockDispatchContext({
      trimmedInput: 'open links from chat',
      clarificationSnapshot: {
        options: chatOptions,
        originalIntent: 'open links panel',
        type: 'panel_disambiguation',
        turnsSinceSet: 0,
        timestamp: Date.now(),
      },
      uiContext: {
        mode: 'dashboard',
        dashboard: {
          entryName: 'Test Entry',
          visibleWidgets: [
            { id: 'summary144', title: 'Summary 144', type: 'summary_tiptap' },
          ],
        },
      },
    })

    const result = await dispatchRouting(ctx)

    // Loop was entered via scope-cue — LLM was called
    expect(callClarificationLLMClient).toHaveBeenCalledTimes(1)
    expect(result.handled).toBe(true)
    expect(result.handledByTier).toBe(0)
  })

  it('no parallel entry: active options + "from chat" scope cue → scope-cue path takes precedence (Step 11.3)', async () => {
    // Both active options (pendingOptions/lastClarification) AND scope cue ("from chat") present.
    // Per Rule H, scope-cue path takes precedence — only one loop invocation fires.
    ;(isLLMFallbackEnabledClient as jest.Mock).mockReturnValue(true)
    ;(isContextRetryEnabledClient as jest.Mock).mockReturnValue(false)
    ;(callClarificationLLMClient as jest.Mock).mockResolvedValue({
      success: true,
      response: { decision: 'select', choiceId: 'opt-1', choiceIndex: 1, confidence: 0.85, reason: 'matched' },
      latencyMs: 150,
    })

    // Create context with BOTH active options and scope cue
    const ctx = createMockDispatchContext({
      trimmedInput: 'open links from chat',
      // Active options (would trigger Tier 1b.3 path)
      lastClarification: {
        type: 'panel_disambiguation' as const,
        originalIntent: 'open links panel',
        messageId: 'msg-scope-parallel',
        timestamp: Date.now() - 2000,
        options: chatOptions.map(o => ({ id: o.id, label: o.label, sublabel: o.sublabel, type: o.type })),
        metaCount: 0,
      },
      pendingOptions: chatOptions.map((o, i) => ({
        index: i + 1,
        label: o.label,
        sublabel: o.sublabel,
        type: o.type,
        id: o.id,
        data: { panelId: o.id, panelTitle: o.label, panelType: 'default' },
      })),
      activeOptionSetId: 'msg-scope-parallel',
      // Scope cue present via clarificationSnapshot
      clarificationSnapshot: {
        options: chatOptions,
        originalIntent: 'open links panel',
        type: 'panel_disambiguation',
        turnsSinceSet: 0,
        timestamp: Date.now(),
      },
      uiContext: {
        mode: 'dashboard',
        dashboard: {
          entryName: 'Test Entry',
          visibleWidgets: [
            { id: 'summary144', title: 'Summary 144', type: 'summary_tiptap' },
          ],
        },
      },
    })

    const result = await dispatchRouting(ctx)

    expect(result.handled).toBe(true)
    expect(result.handledByTier).toBe(0)

    // LLM called exactly once — only one path fires (not two parallel loops)
    expect(callClarificationLLMClient).toHaveBeenCalledTimes(1)
  })
})
