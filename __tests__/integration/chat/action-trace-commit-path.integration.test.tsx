import React, { useEffect } from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { ChatNavigationProvider, useChatNavigationContext } from '@/lib/chat/chat-navigation-context'

jest.mock('@/lib/utils/debug-logger', () => ({
  debugLog: jest.fn(),
}))

function ContextProbe(props: { onReady: (ctx: ReturnType<typeof useChatNavigationContext>) => void }) {
  const ctx = useChatNavigationContext()

  useEffect(() => {
    props.onReady(ctx)
  }, [ctx, props])

  return null
}

describe('ActionTrace commit-path integration', () => {
  const fetchMock = jest.fn()

  beforeEach(() => {
    jest.spyOn(console, 'warn').mockImplementation(() => {})
    jest.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      if (
        typeof args[0] === 'string' &&
        args[0].toLowerCase().includes('react-test-renderer is deprecated')
      ) {
        return
      }
    })

    fetchMock.mockReset()
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({}),
    })
    global.fetch = fetchMock as unknown as typeof fetch

    Object.defineProperty(globalThis, 'window', {
      value: {
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
        location: { origin: 'http://localhost' },
        history: { replaceState: jest.fn() },
      },
      writable: true,
    })

    Object.defineProperty(globalThis, 'document', {
      value: {
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
        visibilityState: 'visible',
      },
      writable: true,
    })

    Object.defineProperty(globalThis, 'navigator', {
      value: {
        sendBeacon: jest.fn(),
      },
      writable: true,
    })
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('dedupes duplicate open_workspace writes from initializer + auto-sync path', async () => {
    let ctxRef: ReturnType<typeof useChatNavigationContext> | null = null
    let renderer: TestRenderer.ReactTestRenderer

    await act(async () => {
      renderer = TestRenderer.create(
        <ChatNavigationProvider>
          <ContextProbe onReady={(ctx) => { ctxRef = ctx }} />
        </ChatNavigationProvider>
      )
    })

    expect(ctxRef).not.toBeNull()

    await act(async () => {
      // Simulate DashboardInitializer regular-workspace commit (meaningful=true)
      ctxRef!.recordExecutedAction({
        actionType: 'open_workspace',
        target: { kind: 'workspace', id: 'ws-123', name: 'Research' },
        source: 'chat',
        resolverPath: 'executeAction',
        reasonCode: 'unknown',
        scopeKind: 'workspace',
        scopeInstanceId: 'ws-123',
        isUserMeaningful: true,
        outcome: 'success',
        tsMs: 1000,
      })

      // Simulate DashboardView workspace-context auto-sync path (meaningful=false)
      ctxRef!.recordExecutedAction({
        actionType: 'open_workspace',
        target: { kind: 'workspace', id: 'ws-123', name: 'Research' },
        source: 'direct_ui',
        resolverPath: 'directUI',
        reasonCode: 'direct_ui',
        scopeKind: 'workspace',
        scopeInstanceId: 'ws-123',
        isUserMeaningful: false,
        outcome: 'success',
        tsMs: 1100, // within 500ms dedupe window
      })
    })

    const trace = ctxRef!.sessionState.actionTrace || []
    expect(trace).toHaveLength(1)
    expect(trace[0].actionType).toBe('open_workspace')
    expect(trace[0].target.id).toBe('ws-123')
    expect(trace[0].isUserMeaningful).toBe(true)

    renderer!.unmount()
  })

  it('freshness guard blocks setLastAction with slightly newer Date.now() for same action', async () => {
    // Reproduces the real-world duplicate: recordExecutedAction fires first with
    // Date.now()=T, then setLastAction fires with Date.now()=T+1..50ms.
    // The guard must block the redundant write despite the timestamp mismatch.
    let ctxRef: ReturnType<typeof useChatNavigationContext> | null = null
    let renderer: TestRenderer.ReactTestRenderer

    await act(async () => {
      renderer = TestRenderer.create(
        <ChatNavigationProvider>
          <ContextProbe onReady={(ctx) => { ctxRef = ctx }} />
        </ChatNavigationProvider>
      )
    })

    expect(ctxRef).not.toBeNull()

    // recordExecutedAction fires first (like DashboardView handleWidgetDoubleClick)
    await act(async () => {
      ctxRef!.recordExecutedAction({
        actionType: 'open_panel',
        target: { kind: 'panel', id: 'panel-recent', name: 'Recent' },
        source: 'direct_ui',
        resolverPath: 'directUI',
        reasonCode: 'direct_ui',
        scopeKind: 'dashboard',
        scopeInstanceId: 'entry-1',
        isUserMeaningful: true,
        outcome: 'success',
        tsMs: 5000,
      })
    })

    // setLastAction fires with a slightly newer timestamp (simulates separate Date.now())
    await act(async () => {
      ctxRef!.setLastAction({
        type: 'open_panel',
        panelId: 'panel-recent',
        panelTitle: 'Recent',
        timestamp: 5042, // 42ms later — within 200ms identity window
      })
    })

    // actionHistory should have exactly ONE entry, not two
    const history = ctxRef!.sessionState.actionHistory || []
    const recentEntries = history.filter(
      (h) => h.type === 'open_panel' && h.targetId === 'panel-recent'
    )
    expect(recentEntries).toHaveLength(1)
    expect(recentEntries[0].timestamp).toBe(5000) // from the trace mirror, not setLastAction

    renderer!.unmount()
  })

  it('freshness guard allows setLastAction for DIFFERENT action within same time window', async () => {
    // If the user performs two different actions quickly, the second setLastAction
    // should NOT be blocked even if it's within the 200ms window.
    let ctxRef: ReturnType<typeof useChatNavigationContext> | null = null
    let renderer: TestRenderer.ReactTestRenderer

    await act(async () => {
      renderer = TestRenderer.create(
        <ChatNavigationProvider>
          <ContextProbe onReady={(ctx) => { ctxRef = ctx }} />
        </ChatNavigationProvider>
      )
    })

    expect(ctxRef).not.toBeNull()

    // recordExecutedAction for open_panel
    await act(async () => {
      ctxRef!.recordExecutedAction({
        actionType: 'open_panel',
        target: { kind: 'panel', id: 'panel-recent', name: 'Recent' },
        source: 'direct_ui',
        resolverPath: 'directUI',
        reasonCode: 'direct_ui',
        scopeKind: 'dashboard',
        scopeInstanceId: 'entry-1',
        isUserMeaningful: true,
        outcome: 'success',
        tsMs: 5000,
      })
    })

    // setLastAction for a DIFFERENT action type within the 200ms window
    await act(async () => {
      ctxRef!.setLastAction({
        type: 'open_workspace',
        workspaceId: 'ws-new',
        workspaceName: 'New Workspace',
        timestamp: 5050, // within 200ms but different action identity
      })
    })

    // Both should exist — the guard should NOT block the different action
    expect(ctxRef!.sessionState.lastAction?.type).toBe('open_workspace')
    const history = ctxRef!.sessionState.actionHistory || []
    expect(history.length).toBeGreaterThanOrEqual(2)

    renderer!.unmount()
  })

  it('a genuinely newer, different legacy setLastAction goes through after trace writes settle', async () => {
    let ctxRef: ReturnType<typeof useChatNavigationContext> | null = null
    let renderer: TestRenderer.ReactTestRenderer

    await act(async () => {
      renderer = TestRenderer.create(
        <ChatNavigationProvider>
          <ContextProbe onReady={(ctx) => { ctxRef = ctx }} />
        </ChatNavigationProvider>
      )
    })

    expect(ctxRef).not.toBeNull()

    // Phase 1: Primary + deduped trace writes
    await act(async () => {
      ctxRef!.recordExecutedAction({
        actionType: 'open_workspace',
        target: { kind: 'workspace', id: 'ws-123', name: 'Research' },
        source: 'chat',
        resolverPath: 'executeAction',
        reasonCode: 'unknown',
        scopeKind: 'workspace',
        scopeInstanceId: 'ws-123',
        isUserMeaningful: true,
        outcome: 'success',
        tsMs: 1000,
      })

      // Deduped duplicate within 500ms window
      ctxRef!.recordExecutedAction({
        actionType: 'open_workspace',
        target: { kind: 'workspace', id: 'ws-123', name: 'Research' },
        source: 'direct_ui',
        resolverPath: 'directUI',
        reasonCode: 'direct_ui',
        scopeKind: 'workspace',
        scopeInstanceId: 'ws-123',
        isUserMeaningful: false,
        outcome: 'success',
        tsMs: 1200,
      })
    })

    // Phase 2: A genuinely newer, different action in a SEPARATE act() block
    // (mirrors real-world: auto-sync fires in a different render cycle, then
    // user performs a new action later)
    await act(async () => {
      ctxRef!.setLastAction({
        type: 'open_panel',
        panelId: 'panel-9',
        panelTitle: 'Links',
        timestamp: 2000, // strictly newer than any trace write
      })
    })

    expect(ctxRef!.sessionState.lastAction?.type).toBe('open_panel')
    expect(ctxRef!.sessionState.lastAction?.panelId).toBe('panel-9')

    renderer!.unmount()
  })

  // ===========================================================================
  // Phase C Batch 1: open_panel path-level parity tests
  // ===========================================================================

  describe('Phase C Batch 1: open_panel commit-point parity', () => {
    it('recordExecutedAction for open_panel mirrors to lastAction + actionHistory (drawer path)', async () => {
      // After Batch 1 removal, only recordExecutedAction fires for drawer open_panel.
      // This test proves the trace-to-legacy mirror is sufficient as a standalone write.
      // Event path: open-panel-drawer CustomEvent → DashboardView handleOpenDrawer → recordExecutedAction (sync)
      let ctxRef: ReturnType<typeof useChatNavigationContext> | null = null
      let renderer: TestRenderer.ReactTestRenderer

      await act(async () => {
        renderer = TestRenderer.create(
          <ChatNavigationProvider>
            <ContextProbe onReady={(ctx) => { ctxRef = ctx }} />
          </ChatNavigationProvider>
        )
      })

      expect(ctxRef).not.toBeNull()

      // Simulate DashboardView handleOpenDrawer commit point (chat-triggered)
      await act(async () => {
        ctxRef!.recordExecutedAction({
          actionType: 'open_panel',
          target: { kind: 'panel', id: 'quick-links-e', name: 'Links Panel E' },
          source: 'chat',
          resolverPath: 'executeAction',
          reasonCode: 'unknown',
          scopeKind: 'dashboard',
          scopeInstanceId: 'entry-1',
          isUserMeaningful: true,
          outcome: 'success',
        })
      })

      // All three stores must be consistent — NO setLastAction call needed
      const { actionTrace, lastAction, actionHistory } = ctxRef!.sessionState

      // actionTrace
      expect(actionTrace).toHaveLength(1)
      expect(actionTrace![0].actionType).toBe('open_panel')
      expect(actionTrace![0].target.id).toBe('quick-links-e')
      expect(actionTrace![0].target.name).toBe('Links Panel E')

      // lastAction (mirrored from trace)
      expect(lastAction).toBeDefined()
      expect(lastAction!.type).toBe('open_panel')
      expect(lastAction!.panelId).toBe('quick-links-e')
      expect(lastAction!.panelTitle).toBe('Links Panel E')

      // actionHistory (mirrored from trace)
      expect(actionHistory).toBeDefined()
      expect(actionHistory!.length).toBeGreaterThanOrEqual(1)
      expect(actionHistory![0].type).toBe('open_panel')
      expect(actionHistory![0].targetId).toBe('quick-links-e')
      expect(actionHistory![0].targetName).toBe('Links Panel E')

      renderer!.unmount()
    })

    it('recordExecutedAction for open_panel via direct UI (handleWidgetDoubleClick) also mirrors correctly', async () => {
      // Second commit point: DashboardView handleWidgetDoubleClick (direct_ui source)
      let ctxRef: ReturnType<typeof useChatNavigationContext> | null = null
      let renderer: TestRenderer.ReactTestRenderer

      await act(async () => {
        renderer = TestRenderer.create(
          <ChatNavigationProvider>
            <ContextProbe onReady={(ctx) => { ctxRef = ctx }} />
          </ChatNavigationProvider>
        )
      })

      expect(ctxRef).not.toBeNull()

      // Simulate DashboardView handleWidgetDoubleClick commit point (direct_ui)
      await act(async () => {
        ctxRef!.recordExecutedAction({
          actionType: 'open_panel',
          target: { kind: 'panel', id: 'panel-recent', name: 'Recent' },
          source: 'direct_ui',
          resolverPath: 'directUI',
          reasonCode: 'direct_ui',
          scopeKind: 'dashboard',
          scopeInstanceId: 'entry-1',
          isUserMeaningful: true,
          outcome: 'success',
        })
      })

      expect(ctxRef!.sessionState.lastAction?.type).toBe('open_panel')
      expect(ctxRef!.sessionState.lastAction?.panelId).toBe('panel-recent')
      expect(ctxRef!.sessionState.actionHistory![0].type).toBe('open_panel')
      expect(ctxRef!.sessionState.actionHistory![0].targetId).toBe('panel-recent')

      renderer!.unmount()
    })

    it('setLastAction for open_panel still works standalone (view panel path — no commit point)', async () => {
      // openPanelWithTracking calls openPanel() (view overlay), NOT open-panel-drawer event.
      // No recordExecutedAction fires for this path — setLastAction is the only writer.
      // After Batch 1 removals, this path (line 564) MUST be preserved.
      let ctxRef: ReturnType<typeof useChatNavigationContext> | null = null
      let renderer: TestRenderer.ReactTestRenderer

      await act(async () => {
        renderer = TestRenderer.create(
          <ChatNavigationProvider>
            <ContextProbe onReady={(ctx) => { ctxRef = ctx }} />
          </ChatNavigationProvider>
        )
      })

      expect(ctxRef).not.toBeNull()

      // Simulate openPanelWithTracking calling setLastAction directly (view panel)
      await act(async () => {
        ctxRef!.setLastAction({
          type: 'open_panel',
          panelId: 'corpus-panel-1',
          panelTitle: 'Corpus View',
          timestamp: Date.now(),
        })
      })

      expect(ctxRef!.sessionState.lastAction?.type).toBe('open_panel')
      expect(ctxRef!.sessionState.lastAction?.panelId).toBe('corpus-panel-1')
      expect(ctxRef!.sessionState.lastAction?.panelTitle).toBe('Corpus View')

      // actionHistory should also have the entry
      expect(ctxRef!.sessionState.actionHistory!.length).toBeGreaterThanOrEqual(1)
      expect(ctxRef!.sessionState.actionHistory![0].type).toBe('open_panel')
      expect(ctxRef!.sessionState.actionHistory![0].targetId).toBe('corpus-panel-1')

      renderer!.unmount()
    })
  })

  // ===========================================================================
  // Phase C Batch 2: open_workspace path-level parity tests
  // ===========================================================================

  describe('Phase C Batch 2: open_workspace commit-point parity', () => {
    it('recordExecutedAction for open_workspace mirrors to lastAction + actionHistory (chat path)', async () => {
      // Event path: chat-navigate-workspace CustomEvent → DashboardView handleWorkspaceSelectById → recordExecutedAction (sync)
      let ctxRef: ReturnType<typeof useChatNavigationContext> | null = null
      let renderer: TestRenderer.ReactTestRenderer

      await act(async () => {
        renderer = TestRenderer.create(
          <ChatNavigationProvider>
            <ContextProbe onReady={(ctx) => { ctxRef = ctx }} />
          </ChatNavigationProvider>
        )
      })

      expect(ctxRef).not.toBeNull()

      await act(async () => {
        ctxRef!.recordExecutedAction({
          actionType: 'open_workspace',
          target: { kind: 'workspace', id: 'ws-research', name: 'Research' },
          source: 'chat',
          resolverPath: 'executeAction',
          reasonCode: 'unknown',
          scopeKind: 'workspace',
          scopeInstanceId: 'ws-research',
          isUserMeaningful: true,
          outcome: 'success',
        })
      })

      // All three stores consistent — no setLastAction needed
      const { actionTrace, lastAction, actionHistory } = ctxRef!.sessionState

      expect(actionTrace).toHaveLength(1)
      expect(actionTrace![0].actionType).toBe('open_workspace')
      expect(actionTrace![0].target.id).toBe('ws-research')

      expect(lastAction?.type).toBe('open_workspace')
      expect(lastAction?.workspaceId).toBe('ws-research')
      expect(lastAction?.workspaceName).toBe('Research')

      expect(actionHistory!.length).toBeGreaterThanOrEqual(1)
      expect(actionHistory![0].type).toBe('open_workspace')
      expect(actionHistory![0].targetId).toBe('ws-research')
      expect(actionHistory![0].targetName).toBe('Research')

      renderer!.unmount()
    })

    it('dedup still collapses subscription-path duplicate after chat-triggered open_workspace', async () => {
      // After removing the legacy setLastAction for open_workspace, the subscription-path
      // auto-sync (isUserMeaningful=false) must still be deduped correctly.
      // Already covered by existing test at line 72, but this explicitly verifies
      // post-removal behavior: only recordExecutedAction writes, no setLastAction at all.
      let ctxRef: ReturnType<typeof useChatNavigationContext> | null = null
      let renderer: TestRenderer.ReactTestRenderer

      await act(async () => {
        renderer = TestRenderer.create(
          <ChatNavigationProvider>
            <ContextProbe onReady={(ctx) => { ctxRef = ctx }} />
          </ChatNavigationProvider>
        )
      })

      expect(ctxRef).not.toBeNull()

      await act(async () => {
        // Primary write (chat-triggered)
        ctxRef!.recordExecutedAction({
          actionType: 'open_workspace',
          target: { kind: 'workspace', id: 'ws-abc', name: 'ABC' },
          source: 'chat',
          resolverPath: 'executeAction',
          reasonCode: 'unknown',
          scopeKind: 'workspace',
          scopeInstanceId: 'ws-abc',
          isUserMeaningful: true,
          outcome: 'success',
          tsMs: 3000,
        })

        // Auto-sync duplicate (isUserMeaningful=false) — should be deduped
        ctxRef!.recordExecutedAction({
          actionType: 'open_workspace',
          target: { kind: 'workspace', id: 'ws-abc', name: 'ABC' },
          source: 'direct_ui',
          resolverPath: 'directUI',
          reasonCode: 'direct_ui',
          scopeKind: 'workspace',
          scopeInstanceId: 'ws-abc',
          isUserMeaningful: false,
          outcome: 'success',
          tsMs: 3100,
        })
      })

      // Only one trace entry (deduped)
      expect(ctxRef!.sessionState.actionTrace).toHaveLength(1)
      expect(ctxRef!.sessionState.actionTrace![0].isUserMeaningful).toBe(true)

      // lastAction mirrors the meaningful entry
      expect(ctxRef!.sessionState.lastAction?.type).toBe('open_workspace')
      expect(ctxRef!.sessionState.lastAction?.workspaceId).toBe('ws-abc')

      // No redundant actionHistory entries from setLastAction
      const wsHistoryEntries = (ctxRef!.sessionState.actionHistory || []).filter(
        h => h.type === 'open_workspace' && h.targetId === 'ws-abc'
      )
      expect(wsHistoryEntries).toHaveLength(1)

      renderer!.unmount()
    })
  })

  // ===========================================================================
  // Phase C Batch 3: open_entry path-level parity tests + timing/race
  // ===========================================================================

  describe('Phase C Batch 3: open_entry commit-point parity', () => {
    it('recordExecutedAction for open_entry mirrors to lastAction + actionHistory (async path)', async () => {
      // Event path: chat-navigate-entry CustomEvent → DashboardInitializer handleDashboardNavigate (ASYNC)
      // → await fetch → recordExecutedAction fires after fetch resolves
      // This test verifies eventual consistency: after async resolves, all three stores are correct.
      let ctxRef: ReturnType<typeof useChatNavigationContext> | null = null
      let renderer: TestRenderer.ReactTestRenderer

      await act(async () => {
        renderer = TestRenderer.create(
          <ChatNavigationProvider>
            <ContextProbe onReady={(ctx) => { ctxRef = ctx }} />
          </ChatNavigationProvider>
        )
      })

      expect(ctxRef).not.toBeNull()

      await act(async () => {
        ctxRef!.recordExecutedAction({
          actionType: 'open_entry',
          target: { kind: 'entry', id: 'entry-summary-144', name: 'Summary 144' },
          source: 'chat',
          resolverPath: 'executeAction',
          reasonCode: 'unknown',
          scopeKind: 'dashboard',
          scopeInstanceId: 'entry-summary-144',
          isUserMeaningful: true,
          outcome: 'success',
        })
      })

      // All three stores consistent after async resolves
      const { actionTrace, lastAction, actionHistory } = ctxRef!.sessionState

      expect(actionTrace).toHaveLength(1)
      expect(actionTrace![0].actionType).toBe('open_entry')
      expect(actionTrace![0].target.id).toBe('entry-summary-144')

      expect(lastAction?.type).toBe('open_entry')
      expect(lastAction?.entryId).toBe('entry-summary-144')
      expect(lastAction?.entryName).toBe('Summary 144')

      expect(actionHistory!.length).toBeGreaterThanOrEqual(1)
      expect(actionHistory![0].type).toBe('open_entry')
      expect(actionHistory![0].targetId).toBe('entry-summary-144')

      renderer!.unmount()
    })

    it('timing gap: lastAction is stale between event dispatch and async recordExecutedAction', async () => {
      // Documents the timing gap: after dispatching chat-navigate-entry, the async
      // handleDashboardNavigate hasn't fired recordExecutedAction yet.
      // During this window, lastAction still holds the PREVIOUS action.
      // This test proves the gap exists and that recordExecutedAction eventually updates it.
      let ctxRef: ReturnType<typeof useChatNavigationContext> | null = null
      let renderer: TestRenderer.ReactTestRenderer

      await act(async () => {
        renderer = TestRenderer.create(
          <ChatNavigationProvider>
            <ContextProbe onReady={(ctx) => { ctxRef = ctx }} />
          </ChatNavigationProvider>
        )
      })

      expect(ctxRef).not.toBeNull()

      // Setup: establish a "previous action" in session state
      await act(async () => {
        ctxRef!.recordExecutedAction({
          actionType: 'open_panel',
          target: { kind: 'panel', id: 'links-d', name: 'Links Panel D' },
          source: 'chat',
          resolverPath: 'executeAction',
          reasonCode: 'unknown',
          scopeKind: 'dashboard',
          scopeInstanceId: 'entry-1',
          isUserMeaningful: true,
          outcome: 'success',
          tsMs: 1000,
        })
      })

      // Verify previous action is set
      expect(ctxRef!.sessionState.lastAction?.type).toBe('open_panel')
      expect(ctxRef!.sessionState.lastAction?.panelId).toBe('links-d')

      // Simulate: the stale window — no recordExecutedAction yet for open_entry
      // (In production: chat-navigate-entry dispatched, handleDashboardNavigate is awaiting fetch)
      // lastAction STILL shows the previous action
      expect(ctxRef!.sessionState.lastAction?.type).toBe('open_panel')

      // Simulate: async handler resolves — recordExecutedAction fires
      await act(async () => {
        ctxRef!.recordExecutedAction({
          actionType: 'open_entry',
          target: { kind: 'entry', id: 'entry-2', name: 'Summary 144' },
          source: 'chat',
          resolverPath: 'executeAction',
          reasonCode: 'unknown',
          scopeKind: 'dashboard',
          scopeInstanceId: 'entry-2',
          isUserMeaningful: true,
          outcome: 'success',
          tsMs: 1200,
        })
      })

      // NOW lastAction is updated
      expect(ctxRef!.sessionState.lastAction?.type).toBe('open_entry')
      expect(ctxRef!.sessionState.lastAction?.entryId).toBe('entry-2')
      expect(ctxRef!.sessionState.lastAction?.entryName).toBe('Summary 144')

      // actionHistory has both entries in newest-first order
      const history = ctxRef!.sessionState.actionHistory || []
      expect(history.length).toBeGreaterThanOrEqual(2)
      expect(history[0].type).toBe('open_entry')
      expect(history[1].type).toBe('open_panel')

      renderer!.unmount()
    })
  })

  // ===========================================================================
  // ExecutionMeta threading: commit point records correct reasonCode
  // ===========================================================================

  describe('ExecutionMeta threading', () => {
    it('executionMeta.reasonCode is stored in actionTrace (not hardcoded unknown)', async () => {
      let ctxRef: ReturnType<typeof useChatNavigationContext> | null = null
      let renderer: TestRenderer.ReactTestRenderer

      await act(async () => {
        renderer = TestRenderer.create(
          <ChatNavigationProvider>
            <ContextProbe onReady={(ctx) => { ctxRef = ctx }} />
          </ChatNavigationProvider>
        )
      })

      expect(ctxRef).not.toBeNull()

      // Simulate a commit point that received executionMeta from the resolver
      await act(async () => {
        ctxRef!.recordExecutedAction({
          actionType: 'open_panel',
          target: { kind: 'panel', id: 'panel-recent', name: 'Recent' },
          source: 'chat',
          resolverPath: 'executeAction',
          reasonCode: 'explicit_label_match', // FROM executionMeta, not hardcoded 'unknown'
          scopeKind: 'dashboard',
          scopeInstanceId: 'entry-1',
          isUserMeaningful: true,
          outcome: 'success',
        })
      })

      const trace = ctxRef!.sessionState.actionTrace || []
      expect(trace).toHaveLength(1)
      expect(trace[0].reasonCode).toBe('explicit_label_match')
      expect(trace[0].resolverPath).toBe('executeAction')

      renderer!.unmount()
    })

    it('absent executionMeta falls back to unknown for chat-sourced actions (backward compat)', async () => {
      let ctxRef: ReturnType<typeof useChatNavigationContext> | null = null
      let renderer: TestRenderer.ReactTestRenderer

      await act(async () => {
        renderer = TestRenderer.create(
          <ChatNavigationProvider>
            <ContextProbe onReady={(ctx) => { ctxRef = ctx }} />
          </ChatNavigationProvider>
        )
      })

      expect(ctxRef).not.toBeNull()

      // Simulate a commit point WITHOUT executionMeta (backward compat path)
      await act(async () => {
        ctxRef!.recordExecutedAction({
          actionType: 'open_panel',
          target: { kind: 'panel', id: 'panel-old', name: 'Old' },
          source: 'chat',
          resolverPath: 'executeAction',
          reasonCode: 'unknown', // What the commit point defaults to when executionMeta is absent
          scopeKind: 'dashboard',
          scopeInstanceId: 'entry-1',
          isUserMeaningful: true,
          outcome: 'success',
        })
      })

      const trace = ctxRef!.sessionState.actionTrace || []
      expect(trace).toHaveLength(1)
      expect(trace[0].reasonCode).toBe('unknown')

      renderer!.unmount()
    })

    it('direct UI event without executionMeta → reasonCode direct_ui unchanged', async () => {
      let ctxRef: ReturnType<typeof useChatNavigationContext> | null = null
      let renderer: TestRenderer.ReactTestRenderer

      await act(async () => {
        renderer = TestRenderer.create(
          <ChatNavigationProvider>
            <ContextProbe onReady={(ctx) => { ctxRef = ctx }} />
          </ChatNavigationProvider>
        )
      })

      expect(ctxRef).not.toBeNull()

      // Simulate a direct UI commit point (no executionMeta, source=direct_ui)
      await act(async () => {
        ctxRef!.recordExecutedAction({
          actionType: 'open_panel',
          target: { kind: 'panel', id: 'panel-recent', name: 'Recent' },
          source: 'direct_ui',
          resolverPath: 'directUI',
          reasonCode: 'direct_ui',
          scopeKind: 'dashboard',
          scopeInstanceId: 'entry-1',
          isUserMeaningful: true,
          outcome: 'success',
        })
      })

      const trace = ctxRef!.sessionState.actionTrace || []
      expect(trace).toHaveLength(1)
      expect(trace[0].reasonCode).toBe('direct_ui')
      expect(trace[0].resolverPath).toBe('directUI')
      expect(trace[0].source).toBe('direct_ui')

      renderer!.unmount()
    })
  })
})
