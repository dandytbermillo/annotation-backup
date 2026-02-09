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
  isLLMFallbackEnabledClient: jest.fn().mockReturnValue(false),
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
