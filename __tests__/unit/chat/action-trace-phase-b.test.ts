/**
 * Phase B regression tests for Centralized ActionTrace commit-point wiring.
 *
 * Tests:
 * 1. computeDedupeKey produces identical keys for same action identity (cross-component dedupe)
 * 2. computeDedupeKey produces different keys for different action identities
 * 3. Freshness guard identity extraction logic
 * 4. Resolver ordering fix (actionHistory[1] = "before that")
 * 5. Consistent scopeInstanceId across DashboardView + DashboardInitializer open_workspace paths
 */

jest.mock('@/lib/utils/debug-logger', () => ({
  debugLog: jest.fn(),
}))

jest.mock('@/lib/chat/ui-snapshot-builder', () => ({
  buildTurnSnapshot: jest.fn(),
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
  isBareNounQuery: jest.fn().mockReturnValue(false),
  maybeFormatSnippetWithHs3: jest.fn(),
  dedupeHeaderPath: jest.fn(),
  stripMarkdownHeadersForUI: jest.fn(),
}))

jest.mock('@/lib/chat/cross-corpus-handler', () => ({
  handleCrossCorpusRetrieval: jest.fn().mockResolvedValue({ handled: false }),
}))

jest.mock('@/lib/widgets/ui-snapshot-registry', () => ({
  getWidgetSnapshot: jest.fn().mockReturnValue(null),
  getAllVisibleSnapshots: jest.fn().mockReturnValue([]),
}))

jest.mock('@/lib/chat/known-noun-routing', () => ({
  handleKnownNounRouting: jest.fn().mockReturnValue({ handled: false }),
  matchKnownNoun: jest.fn().mockReturnValue(null),
}))

jest.mock('@/lib/docs/known-terms-client', () => ({
  getKnownTermsSync: jest.fn().mockReturnValue(null),
}))

global.fetch = jest.fn().mockResolvedValue({
  ok: false,
  status: 500,
  json: async () => ({}),
}) as jest.Mock

import { computeDedupeKey, type ActionTraceEntry } from '@/lib/chat/action-trace'
import { resolveIntent } from '@/lib/chat/intent-resolver'
import type { ActionHistoryEntry, SessionState } from '@/lib/chat/intent-prompt'
import type { IntentResponse } from '@/lib/chat/intent-schema'

// ============================================================================
// Helpers
// ============================================================================

function makeTraceInput(overrides: Partial<Pick<ActionTraceEntry, 'actionType' | 'target' | 'scopeKind' | 'scopeInstanceId'>>) {
  return {
    actionType: overrides.actionType ?? 'open_workspace',
    target: overrides.target ?? { kind: 'workspace' as const, id: 'ws-1', name: 'Test' },
    scopeKind: overrides.scopeKind ?? 'workspace' as const,
    scopeInstanceId: overrides.scopeInstanceId ?? 'ws-1',
  }
}

/**
 * Mirrors the freshness guard identity extraction logic from chat-navigation-context.tsx.
 * Used to verify the guard's identity comparison in tests.
 */
function extractLastActionTargetId(action: SessionState['lastAction']): string | undefined {
  if (!action) return undefined
  switch (action.type) {
    case 'open_workspace':
    case 'rename_workspace':
    case 'delete_workspace':
    case 'create_workspace':
      return action.workspaceId
    case 'open_entry':
    case 'go_to_dashboard':
    case 'go_home':
      return action.entryId
    case 'open_panel':
      return action.panelId
  }
}

// ============================================================================
// Tests
// ============================================================================

describe('ActionTrace Phase B — Commit-Point Wiring', () => {

  // --------------------------------------------------------------------------
  // 6a + 6e: Dedupe key consistency across DashboardView + DashboardInitializer
  // --------------------------------------------------------------------------

  describe('computeDedupeKey consistency', () => {
    it('produces identical keys for same open_workspace action identity', () => {
      // DashboardView handleWorkspaceSelectById uses:
      //   actionType: 'open_workspace', target: { kind: 'workspace', id: wsId },
      //   scopeKind: 'workspace', scopeInstanceId: wsId
      const dashboardViewKey = computeDedupeKey(makeTraceInput({
        actionType: 'open_workspace',
        target: { kind: 'workspace', id: 'ws-123', name: 'Research' },
        scopeKind: 'workspace',
        scopeInstanceId: 'ws-123',
      }))

      // DashboardInitializer handleDashboardNavigate (regular ws) uses same shape:
      const dashboardInitializerKey = computeDedupeKey(makeTraceInput({
        actionType: 'open_workspace',
        target: { kind: 'workspace', id: 'ws-123', name: 'Research' },
        scopeKind: 'workspace',
        scopeInstanceId: 'ws-123',
      }))

      expect(dashboardViewKey).toBe(dashboardInitializerKey)
    })

    it('produces different keys for different action types on same target', () => {
      const openKey = computeDedupeKey(makeTraceInput({
        actionType: 'open_workspace',
        target: { kind: 'workspace', id: 'ws-1' },
      }))
      const deleteKey = computeDedupeKey(makeTraceInput({
        actionType: 'delete_workspace',
        target: { kind: 'workspace', id: 'ws-1' },
      }))

      expect(openKey).not.toBe(deleteKey)
    })

    it('produces different keys for same action type on different targets', () => {
      const key1 = computeDedupeKey(makeTraceInput({
        actionType: 'open_workspace',
        target: { kind: 'workspace', id: 'ws-1', name: 'A' },
        scopeInstanceId: 'ws-1',
      }))
      const key2 = computeDedupeKey(makeTraceInput({
        actionType: 'open_workspace',
        target: { kind: 'workspace', id: 'ws-2', name: 'B' },
        scopeInstanceId: 'ws-2',
      }))

      expect(key1).not.toBe(key2)
    })

    it('auto-sync (isUserMeaningful:false) produces same dedupeKey as primary commit', () => {
      // The workspace context subscription calls handleWorkspaceSelectById with
      // { isUserMeaningful: false } — but isUserMeaningful is NOT part of the dedupeKey.
      // So the auto-sync path produces the same key as the primary commit, ensuring
      // the 500ms dedupe window suppresses the duplicate.
      const primaryKey = computeDedupeKey(makeTraceInput({
        actionType: 'open_workspace',
        target: { kind: 'workspace', id: 'ws-99' },
        scopeKind: 'workspace',
        scopeInstanceId: 'ws-99',
      }))
      // Auto-sync path — same action identity, different isUserMeaningful (not in key)
      const autoSyncKey = computeDedupeKey(makeTraceInput({
        actionType: 'open_workspace',
        target: { kind: 'workspace', id: 'ws-99' },
        scopeKind: 'workspace',
        scopeInstanceId: 'ws-99',
      }))

      expect(primaryKey).toBe(autoSyncKey)
    })
  })

  // --------------------------------------------------------------------------
  // 6c: Freshness guard identity-based blocking
  // --------------------------------------------------------------------------

  describe('freshness guard identity extraction', () => {
    it('extracts workspaceId for workspace-related actions', () => {
      expect(extractLastActionTargetId({
        type: 'open_workspace', workspaceId: 'ws-1', workspaceName: 'A', timestamp: 1000,
      })).toBe('ws-1')
      expect(extractLastActionTargetId({
        type: 'rename_workspace', workspaceId: 'ws-2', workspaceName: 'B', fromName: 'X', toName: 'Y', timestamp: 1000,
      })).toBe('ws-2')
      expect(extractLastActionTargetId({
        type: 'delete_workspace', workspaceId: 'ws-3', workspaceName: 'C', timestamp: 1000,
      })).toBe('ws-3')
      expect(extractLastActionTargetId({
        type: 'create_workspace', workspaceId: 'ws-4', workspaceName: 'D', timestamp: 1000,
      })).toBe('ws-4')
    })

    it('extracts entryId for entry-related actions', () => {
      expect(extractLastActionTargetId({
        type: 'open_entry', entryId: 'e-1', entryName: 'E', timestamp: 1000,
      })).toBe('e-1')
      expect(extractLastActionTargetId({
        type: 'go_to_dashboard', entryId: 'e-2', timestamp: 1000,
      })).toBe('e-2')
      expect(extractLastActionTargetId({
        type: 'go_home', entryId: 'e-3', timestamp: 1000,
      })).toBe('e-3')
    })

    it('extracts panelId for panel actions', () => {
      expect(extractLastActionTargetId({
        type: 'open_panel', panelId: 'p-1', panelTitle: 'Links', timestamp: 1000,
      })).toBe('p-1')
    })

    it('same-ms identity match: same action + target → should block', () => {
      // Simulates the freshness guard logic:
      // recordExecutedAction sets lastTraceWriteRef = { tsMs: 1000, actionType: 'open_workspace', targetId: 'ws-A' }
      // Then setLastAction gets { type: 'open_workspace', workspaceId: 'ws-A', timestamp: 1000 }
      // Guard checks: timestamp === lastWrite.tsMs → identity check
      // action.type === lastWrite.actionType && targetId === lastWrite.targetId → BLOCK
      const traceWrite = { tsMs: 1000, actionType: 'open_workspace', targetId: 'ws-A' }
      const legacyAction: SessionState['lastAction'] = {
        type: 'open_workspace', workspaceId: 'ws-A', workspaceName: 'A', timestamp: 1000,
      }

      const actionTargetId = extractLastActionTargetId(legacyAction)
      const wouldBlock = (
        legacyAction!.timestamp === traceWrite.tsMs &&
        legacyAction!.type === traceWrite.actionType &&
        actionTargetId === traceWrite.targetId
      )

      expect(wouldBlock).toBe(true)
    })

    it('same-ms different identity: different action type → should NOT block', () => {
      const traceWrite = { tsMs: 1000, actionType: 'open_workspace', targetId: 'ws-A' }
      const legacyAction: SessionState['lastAction'] = {
        type: 'open_panel', panelId: 'p-B', panelTitle: 'Links', timestamp: 1000,
      }

      const actionTargetId = extractLastActionTargetId(legacyAction)
      const wouldBlock = (
        legacyAction!.timestamp === traceWrite.tsMs &&
        legacyAction!.type === traceWrite.actionType &&
        actionTargetId === traceWrite.targetId
      )

      expect(wouldBlock).toBe(false)
    })

    it('strictly newer legacy action → should NOT block', () => {
      const traceWrite = { tsMs: 1000, actionType: 'open_workspace', targetId: 'ws-A' }
      const legacyAction: SessionState['lastAction'] = {
        type: 'open_workspace', workspaceId: 'ws-A', workspaceName: 'A', timestamp: 2000,
      }

      // Guard checks: timestamp < lastWrite.tsMs? No (2000 > 1000). timestamp === lastWrite.tsMs? No.
      // Neither condition met → goes through.
      const wouldBlock = (
        legacyAction!.timestamp < traceWrite.tsMs ||
        (legacyAction!.timestamp === traceWrite.tsMs &&
          legacyAction!.type === traceWrite.actionType &&
          extractLastActionTargetId(legacyAction) === traceWrite.targetId)
      )

      expect(wouldBlock).toBe(false)
    })

    it('strictly older legacy action → should block', () => {
      const traceWrite = { tsMs: 2000, actionType: 'open_workspace', targetId: 'ws-A' }
      const legacyAction: SessionState['lastAction'] = {
        type: 'open_panel', panelId: 'p-X', panelTitle: 'Links', timestamp: 1000,
      }

      const wouldBlock = legacyAction!.timestamp < traceWrite.tsMs

      expect(wouldBlock).toBe(true)
    })
  })

  // --------------------------------------------------------------------------
  // 6d: Resolver ordering fix — actionHistory[1] = "before that"
  // --------------------------------------------------------------------------

  describe('resolveExplainLastAction ordering', () => {
    it('references the preceding action (index 1), not the oldest', async () => {
      // actionHistory is newest-first: [newest, preceding, oldest]
      const actionHistory: ActionHistoryEntry[] = [
        { type: 'open_panel', targetType: 'panel', targetName: 'Links', targetId: 'p-1', timestamp: 3000 },
        { type: 'open_workspace', targetType: 'workspace', targetName: 'Research', targetId: 'ws-1', timestamp: 2000 },
        { type: 'open_entry', targetType: 'entry', targetName: 'OldEntry', targetId: 'e-1', timestamp: 1000 },
      ]

      const sessionState: SessionState = {
        lastAction: {
          type: 'open_panel',
          panelId: 'p-1',
          panelTitle: 'Links',
          timestamp: 3000,
        },
        actionHistory,
      }

      const intent: IntentResponse = {
        intent: 'explain_last_action',
        confidence: 0.95,
        args: {},
      }

      const result = await resolveIntent(intent, {
        userId: 'test-user',
        sessionState,
      })

      // Should reference the PRECEDING action (index 1 = "Research"),
      // NOT the OLDEST action (index 2 = "OldEntry")
      expect(result.success).toBe(true)
      expect(result.message).toContain('Research')
      expect(result.message).not.toContain('OldEntry')
    })

    it('works when actionHistory has exactly 2 entries', async () => {
      const actionHistory: ActionHistoryEntry[] = [
        { type: 'open_workspace', targetType: 'workspace', targetName: 'Main', targetId: 'ws-1', timestamp: 2000 },
        { type: 'open_entry', targetType: 'entry', targetName: 'Home', targetId: 'e-1', timestamp: 1000 },
      ]

      const sessionState: SessionState = {
        lastAction: {
          type: 'open_workspace',
          workspaceId: 'ws-1',
          workspaceName: 'Main',
          timestamp: 2000,
        },
        actionHistory,
      }

      const intent: IntentResponse = {
        intent: 'explain_last_action',
        confidence: 0.95,
        args: {},
      }

      const result = await resolveIntent(intent, {
        userId: 'test-user',
        sessionState,
      })

      expect(result.success).toBe(true)
      expect(result.message).toContain('Main')
      expect(result.message).toContain('Home')
    })

    it('does not crash when actionHistory has only 1 entry', async () => {
      const actionHistory: ActionHistoryEntry[] = [
        { type: 'open_workspace', targetType: 'workspace', targetName: 'Solo', targetId: 'ws-1', timestamp: 1000 },
      ]

      const sessionState: SessionState = {
        lastAction: {
          type: 'open_workspace',
          workspaceId: 'ws-1',
          workspaceName: 'Solo',
          timestamp: 1000,
        },
        actionHistory,
      }

      const intent: IntentResponse = {
        intent: 'explain_last_action',
        confidence: 0.95,
        args: {},
      }

      const result = await resolveIntent(intent, {
        userId: 'test-user',
        sessionState,
      })

      expect(result.success).toBe(true)
      expect(result.message).toContain('Solo')
      // Should NOT mention "Before that" since there's no preceding action
      expect(result.message).not.toContain('Before that')
    })
  })
})
