/**
 * End-to-end integration test: executionMeta threading through
 * resolver → JSON serialization → event dispatch simulation.
 *
 * Verifies the resolver populates executionMeta and it survives
 * JSON serialization in the API response.
 */

import { resolveIntent } from '@/lib/chat/intent-resolver'
import type { IntentResponse } from '@/lib/chat/intent-schema'
import type { ResolutionContext } from '@/lib/chat/resolution-types'

// Mock DB-dependent resolvers
jest.mock('@/lib/chat/workspace-resolver', () => ({
  resolveWorkspace: jest.fn().mockResolvedValue({
    status: 'found',
    workspace: { id: 'ws-1', name: 'Sprint 5', entryId: 'entry-1', entryName: 'Test Entry' },
  }),
  resolveRecentWorkspace: jest.fn().mockResolvedValue({
    status: 'found',
    workspace: { id: 'ws-recent', name: 'Recent WS', entryId: 'entry-1', entryName: 'Test Entry' },
  }),
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

jest.mock('@/lib/db/pool', () => ({
  serverPool: { query: jest.fn() },
}))

jest.mock('@/lib/utils/debug-logger', () => ({
  debugLog: jest.fn(),
}))

const baseContext: ResolutionContext = {
  currentEntryId: 'entry-1',
  currentEntryName: 'Test Entry',
  entries: [],
  workspaces: [
    { id: 'ws-recent', name: 'Sprint 5', entryId: 'entry-1', entryName: 'Test Entry', isDefault: false },
  ],
  currentWorkspaceId: 'ws-recent',
  currentWorkspaceName: 'Sprint 5',
  panels: [],
  visibleWidgets: [
    { id: 'panel-recent', title: 'Recent', type: 'recent' },
    { id: 'panel-links-d', title: 'Links Panel D', type: 'quick_links' },
  ],
}

describe('executionMeta e2e: resolver → API response → event dispatch', () => {
  test('resolveIntent for "open recent" → resolution.executionMeta.reasonCode === explicit_label_match in JSON', async () => {
    // Simulate what route.ts does:
    // 1. Parse intent from LLM
    const intent: IntentResponse = { intent: 'open_recent_workspace', args: {} }

    // 2. Resolve intent (this is what route.ts calls)
    const resolution = await resolveIntent(intent, baseContext)

    // 3. Simulate JSON serialization (what NextResponse.json does)
    const serialized = JSON.parse(JSON.stringify({ intent, resolution }))

    // 4. Verify executionMeta survives serialization
    // Recent workspace is a name-based lookup (not preview expansion), so matchKind: 'exact'
    expect(serialized.resolution.executionMeta).toBeDefined()
    expect(serialized.resolution.executionMeta.reasonCode).toBe('explicit_label_match')
    expect(serialized.resolution.executionMeta.resolverPath).toBe('executeAction')
  })

  test('resolveIntent for "open workspace Sprint 5" → explicit_label_match in JSON', async () => {
    const intent: IntentResponse = { intent: 'open_workspace', args: { workspaceName: 'Sprint 5' } }
    const resolution = await resolveIntent(intent, baseContext)
    const serialized = JSON.parse(JSON.stringify({ intent, resolution }))

    expect(serialized.resolution.executionMeta).toBeDefined()
    expect(serialized.resolution.executionMeta.reasonCode).toBe('explicit_label_match')
  })

  test('resolveIntent for "go to dashboard" → explicit_label_match in JSON', async () => {
    const intent: IntentResponse = { intent: 'go_to_dashboard', args: {} }
    const resolution = await resolveIntent(intent, baseContext)
    const serialized = JSON.parse(JSON.stringify({ intent, resolution }))

    expect(serialized.resolution.action).toBe('navigate_dashboard')
    expect(serialized.resolution.executionMeta).toBeDefined()
    expect(serialized.resolution.executionMeta.reasonCode).toBe('explicit_label_match')
  })

  test('resolution missing executionMeta (backward compat) → defaults to undefined', async () => {
    // Unsupported intent → error action → no executionMeta
    const intent: IntentResponse = { intent: 'unsupported', args: { reason: 'Not supported' } }
    const resolution = await resolveIntent(intent, baseContext)
    const serialized = JSON.parse(JSON.stringify({ intent, resolution }))

    expect(serialized.resolution.executionMeta).toBeUndefined()
  })

  test('simulated event dispatch with executionMeta → commit point receives correct reasonCode', () => {
    // Simulate what DashboardView handleOpenDrawer does when receiving an event
    const executionMeta = { reasonCode: 'explicit_label_match' as const, resolverPath: 'executeAction' as const }
    const eventDetail = { panelId: 'panel-recent', source: 'chat' as const, executionMeta }

    // Simulate the commit-point logic from DashboardView
    const meta = eventDetail.executionMeta
    const eventSource = eventDetail.source === 'chat' ? 'chat' as const : 'direct_ui' as const
    const recordedReasonCode = meta?.reasonCode ?? (eventSource === 'chat' ? 'unknown' : 'direct_ui')
    const recordedResolverPath = meta?.resolverPath ?? (eventSource === 'chat' ? 'executeAction' : 'directUI')

    expect(recordedReasonCode).toBe('explicit_label_match')
    expect(recordedResolverPath).toBe('executeAction')
  })

  test('simulated event dispatch WITHOUT executionMeta → commit point defaults to unknown', () => {
    // Backward compat: old code path that doesn't include executionMeta
    const eventDetail = { panelId: 'panel-recent', source: 'chat' as const }

    const meta = (eventDetail as { executionMeta?: { reasonCode?: string; resolverPath?: string } }).executionMeta
    const eventSource = eventDetail.source === 'chat' ? 'chat' as const : 'direct_ui' as const
    const recordedReasonCode = meta?.reasonCode ?? (eventSource === 'chat' ? 'unknown' : 'direct_ui')
    const recordedResolverPath = meta?.resolverPath ?? (eventSource === 'chat' ? 'executeAction' : 'directUI')

    expect(recordedReasonCode).toBe('unknown')
    expect(recordedResolverPath).toBe('executeAction')
  })
})
