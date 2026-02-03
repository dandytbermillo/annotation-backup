/**
 * Integration Test: Widget Context Segments Reach Intent Prompt
 *
 * Verifies that widgetContextSegments and widgetItemDescriptions
 * from the client-side registry are rendered in the LLM prompt
 * under the WidgetContext: heading, separate from widgetStates:.
 *
 * Also verifies the version gate: unknown version → no WidgetContext block.
 */

// Mock server-only (intent-prompt.ts uses it)
jest.mock('server-only', () => ({}))
// Mock DB-dependent modules that intent-prompt imports
jest.mock('@/lib/widgets/widget-store', () => ({
  getEnabledManifests: jest.fn().mockResolvedValue([]),
}))

import { buildIntentMessages, type ConversationContext } from '@/lib/chat/intent-prompt'

// ============================================================================
// Helpers
// ============================================================================

function makeContext(overrides?: Partial<ConversationContext>): ConversationContext {
  return {
    uiContext: {
      mode: 'dashboard',
      dashboard: {
        entryName: 'Test Entry',
        visibleWidgets: [{ id: 'w_recent', title: 'Recent', type: 'recent' }],
        widgetStates: {
          w_recent: {
            widgetId: 'w_recent',
            instanceId: 'inst_1',
            title: 'Recent',
            view: 'list',
            selection: null,
            summary: 'Shows recent workspaces',
            updatedAt: Date.now(),
          },
        },
      },
    },
    ...overrides,
  }
}

// ============================================================================
// Tests
// ============================================================================

describe('widget context in intent-prompt', () => {
  it('should render WidgetContext: block when widgetContextVersion is 1 and segments exist', async () => {
    const context = makeContext({
      widgetContextVersion: 1,
      widgetContextSegments: [
        {
          widgetId: 'w_recent',
          widgetTitle: 'Recent',
          segmentId: 'w_recent:context',
          summary: 'Shows recently accessed workspaces',
          currentView: 'list',
          focusText: 'Sprint 14',
        },
      ],
    })

    const messages = await buildIntentMessages('what does this widget mean?', context)
    const contextMessage = messages.find(m => m.role === 'user' && m.content.includes('WidgetContext:'))

    expect(contextMessage).toBeDefined()
    expect(contextMessage!.content).toContain('WidgetContext:')
    expect(contextMessage!.content).toContain('Recent')
    expect(contextMessage!.content).toContain('Shows recently accessed workspaces')
    expect(contextMessage!.content).toContain('Sprint 14')
  })

  it('should render item descriptions under WidgetContext when present', async () => {
    const context = makeContext({
      widgetContextVersion: 1,
      widgetContextSegments: [
        {
          widgetId: 'w_recent',
          widgetTitle: 'Recent',
          segmentId: 'w_recent:context',
          summary: 'Shows workspaces',
          currentView: 'list',
        },
      ],
      widgetItemDescriptions: [
        {
          widgetId: 'w_recent',
          itemId: 'ws_1',
          label: 'Sprint 14',
          description: 'Latest sprint workspace',
        },
        {
          widgetId: 'w_recent',
          itemId: 'ws_2',
          label: 'Design System',
          description: 'UI component library workspace',
        },
      ],
    })

    const messages = await buildIntentMessages('what is Sprint 14?', context)
    const contextMessage = messages.find(m => m.role === 'user' && m.content.includes('WidgetContext:'))

    expect(contextMessage).toBeDefined()
    expect(contextMessage!.content).toContain('Sprint 14')
    expect(contextMessage!.content).toContain('Latest sprint workspace')
    expect(contextMessage!.content).toContain('Design System')
  })

  it('should NOT render WidgetContext: block when widgetContextVersion is missing', async () => {
    const context = makeContext({
      // No widgetContextVersion set
      widgetContextSegments: [
        {
          widgetId: 'w_recent',
          widgetTitle: 'Recent',
          segmentId: 'w_recent:context',
          summary: 'Should not appear',
          currentView: 'list',
        },
      ],
    })

    const messages = await buildIntentMessages('test', context)
    const hasWidgetContext = messages.some(m => m.content.includes('WidgetContext:'))
    expect(hasWidgetContext).toBe(false)
  })

  it('should NOT render WidgetContext: block when widgetContextVersion is unrecognized', async () => {
    const context = makeContext({
      widgetContextVersion: 99 as any, // unrecognized version
      widgetContextSegments: [
        {
          widgetId: 'w_recent',
          widgetTitle: 'Recent',
          segmentId: 'w_recent:context',
          summary: 'Should not appear',
          currentView: 'list',
        },
      ],
    })

    const messages = await buildIntentMessages('test', context)
    const hasWidgetContext = messages.some(m => m.content.includes('WidgetContext:'))
    expect(hasWidgetContext).toBe(false)
  })

  it('should keep WidgetContext: separate from widgetStates:', async () => {
    const context = makeContext({
      widgetContextVersion: 1,
      widgetContextSegments: [
        {
          widgetId: 'w_recent',
          widgetTitle: 'Recent',
          segmentId: 'w_recent:context',
          summary: 'Widget context data',
          currentView: 'list',
        },
      ],
    })

    const messages = await buildIntentMessages('test', context)
    const contextMessage = messages.find(m =>
      m.role === 'user' && m.content.includes('widgetStates:')
    )

    expect(contextMessage).toBeDefined()
    // Both blocks should exist in the message
    expect(contextMessage!.content).toContain('widgetStates:')
    expect(contextMessage!.content).toContain('WidgetContext:')

    // WidgetContext should NOT be nested inside widgetStates
    const widgetStatesIdx = contextMessage!.content.indexOf('widgetStates:')
    const widgetContextIdx = contextMessage!.content.indexOf('WidgetContext:')
    // WidgetContext should come after widgetStates (it's a separate block)
    expect(widgetContextIdx).toBeGreaterThan(widgetStatesIdx)
  })

  it('should render widgetStates without WidgetContext when no segments provided', async () => {
    const context = makeContext({
      widgetContextVersion: 1,
      // No widgetContextSegments
    })

    const messages = await buildIntentMessages('test', context)
    const contextMessage = messages.find(m =>
      m.role === 'user' && m.content.includes('widgetStates:')
    )

    expect(contextMessage).toBeDefined()
    expect(contextMessage!.content).toContain('widgetStates:')
    expect(contextMessage!.content).not.toContain('WidgetContext:')
  })
})
