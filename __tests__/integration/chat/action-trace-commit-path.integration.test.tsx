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

  it('deduped second write does not block a newer, different legacy setLastAction', async () => {
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

      // Deduped duplicate; freshness ref must NOT advance to 1200.
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

      // If deduped write incorrectly advanced freshness ref to 1200, this would be blocked.
      ctxRef!.setLastAction({
        type: 'open_panel',
        panelId: 'panel-9',
        panelTitle: 'Links',
        timestamp: 1100,
      })
    })

    expect(ctxRef!.sessionState.lastAction?.type).toBe('open_panel')
    expect(ctxRef!.sessionState.lastAction?.panelId).toBe('panel-9')

    renderer!.unmount()
  })
})
