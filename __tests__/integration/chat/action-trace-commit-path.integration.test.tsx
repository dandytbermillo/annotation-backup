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
})
