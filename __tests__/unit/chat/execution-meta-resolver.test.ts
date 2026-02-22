/**
 * Unit tests for executionMeta on IntentResolutionResult.
 *
 * Verifies that resolver return sites include the correct executionMeta
 * (reasonCode + resolverPath) for day-one scope actions.
 *
 * DB-dependent resolvers (open_workspace, open, open_recent_workspace) are mocked.
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
    { id: 'ws-1', name: 'Sprint 5', entryId: 'entry-1', entryName: 'Test Entry', isDefault: false },
  ],
  currentWorkspaceId: 'ws-1',
  currentWorkspaceName: 'Sprint 5',
  panels: [],
  visibleWidgets: [
    { id: 'panel-recent', title: 'Recent', type: 'recent' },
  ],
}

describe('executionMeta on resolver results', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    // Reset default mocks
    const { resolveWorkspace, resolveRecentWorkspace } = require('@/lib/chat/workspace-resolver')
    resolveWorkspace.mockResolvedValue({
      status: 'found',
      workspace: { id: 'ws-1', name: 'Sprint 5', entryId: 'entry-1', entryName: 'Test Entry' },
    })
    resolveRecentWorkspace.mockResolvedValue({
      status: 'found',
      workspace: { id: 'ws-recent', name: 'Recent WS', entryId: 'entry-1', entryName: 'Test Entry' },
    })
    const { resolveEntry } = require('@/lib/chat/entry-resolver')
    resolveEntry.mockResolvedValue({ status: 'not_found' })
  })

  test('resolveGoToDashboard → executionMeta with explicit_label_match', async () => {
    const intent: IntentResponse = { intent: 'go_to_dashboard', args: {} }
    const result = await resolveIntent(intent, baseContext)
    expect(result.success).toBe(true)
    expect(result.action).toBe('navigate_dashboard')
    expect(result.executionMeta).toEqual({
      reasonCode: 'explicit_label_match',
      resolverPath: 'executeAction',
    })
  })

  test('resolveGoHome → executionMeta with explicit_label_match', async () => {
    const homeContext: ResolutionContext = {
      ...baseContext,
      homeEntryId: 'entry-home',
      currentEntryId: 'entry-other',
    }
    const intent: IntentResponse = { intent: 'go_home', args: {} }
    const result = await resolveIntent(intent, homeContext)
    expect(result.success).toBe(true)
    expect(result.action).toBe('navigate_home')
    expect(result.executionMeta).toEqual({
      reasonCode: 'explicit_label_match',
      resolverPath: 'executeAction',
    })
  })

  test('resolveOpenWorkspace (found) → executionMeta with explicit_label_match', async () => {
    const intent: IntentResponse = { intent: 'open_workspace', args: { workspaceName: 'Sprint 5' } }
    const result = await resolveIntent(intent, baseContext)
    expect(result.success).toBe(true)
    expect(result.action).toBe('navigate_workspace')
    expect(result.executionMeta).toEqual({
      reasonCode: 'explicit_label_match',
      resolverPath: 'executeAction',
    })
  })

  test('resolveOpenWorkspace (panel fallback) → executionMeta with explicit_label_match', async () => {
    const { resolveWorkspace } = require('@/lib/chat/workspace-resolver')
    resolveWorkspace.mockResolvedValueOnce({ status: 'not_found', message: 'Not found' })

    const intent: IntentResponse = { intent: 'open_workspace', args: { workspaceName: 'Recent' } }
    const result = await resolveIntent(intent, baseContext)
    expect(result.success).toBe(true)
    expect(result.action).toBe('open_panel_drawer')
    expect(result.executionMeta).toEqual({
      reasonCode: 'explicit_label_match',
      resolverPath: 'executeAction',
    })
  })

  test('resolveOpenRecentWorkspace (found) → executionMeta with explicit_label_match (name-based lookup)', async () => {
    const intent: IntentResponse = { intent: 'open_recent_workspace', args: {} }
    const result = await resolveIntent(intent, baseContext)
    expect(result.success).toBe(true)
    expect(result.action).toBe('navigate_workspace')
    // Recent workspace is a name-based lookup (not preview expansion), so matchKind: 'exact'
    expect(result.executionMeta).toEqual({
      reasonCode: 'explicit_label_match',
      resolverPath: 'executeAction',
    })
  })

  test('resolveBareName (single panel) → executionMeta with explicit_label_match', async () => {
    const { resolveWorkspace } = require('@/lib/chat/workspace-resolver')
    resolveWorkspace.mockResolvedValueOnce({ status: 'not_found', message: 'Not found' })

    const intent: IntentResponse = { intent: 'resolve_name', args: { name: 'Recent' } }
    const result = await resolveIntent(intent, baseContext)
    expect(result.success).toBe(true)
    expect(result.action).toBe('open_panel_drawer')
    expect(result.executionMeta).toEqual({
      reasonCode: 'explicit_label_match',
      resolverPath: 'executeAction',
    })
  })

  test('select action → no executionMeta (disambiguation, not a commit point)', async () => {
    const wsResolver = require('@/lib/chat/workspace-resolver')
    wsResolver.resolveWorkspace.mockResolvedValueOnce({
      status: 'multiple',
      matches: [
        { id: 'ws-1', name: 'Sprint 5', entryId: 'entry-1', entryName: 'Test Entry' },
        { id: 'ws-2', name: 'Sprint 6', entryId: 'entry-1', entryName: 'Test Entry' },
      ],
      message: 'Multiple found',
    })

    const intent: IntentResponse = { intent: 'open_workspace', args: { workspaceName: 'Sprint' } }
    const result = await resolveIntent(intent, baseContext)
    expect(result.success).toBe(true)
    expect(result.action).toBe('select')
    expect(result.executionMeta).toBeUndefined()
  })

  test('error action → no executionMeta', async () => {
    const intent: IntentResponse = { intent: 'go_to_dashboard', args: {} }
    const dashboardContext: ResolutionContext = {
      ...baseContext,
      currentWorkspaceId: null, // Already on dashboard
    }
    const result = await resolveIntent(intent, dashboardContext)
    expect(result.success).toBe(false)
    expect(result.action).toBe('error')
    expect(result.executionMeta).toBeUndefined()
  })
})
