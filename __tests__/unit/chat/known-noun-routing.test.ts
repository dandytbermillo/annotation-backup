/**
 * Unit tests for known-noun-routing.ts
 * Covers Tier 4 fallthrough guard for panel disambiguation.
 */

import { handleKnownNounRouting, type KnownNounRoutingContext } from '@/lib/chat/known-noun-routing'

function makeContext(overrides: Partial<KnownNounRoutingContext> = {}): KnownNounRoutingContext {
  return {
    trimmedInput: '',
    visibleWidgets: [],
    addMessage: jest.fn(),
    setIsLoading: jest.fn(),
    openPanelDrawer: jest.fn(),
    setPendingOptions: jest.fn(),
    setPendingOptionsMessageId: jest.fn(),
    setPendingOptionsGraceCount: jest.fn(),
    setActiveOptionSetId: jest.fn(),
    setLastClarification: jest.fn(),
    handleSelectOption: jest.fn(),
    clearWidgetSelectionContext: jest.fn(),
    clearLastOptionsShown: jest.fn(),
    clearClarificationSnapshot: jest.fn(),
    clearFocusLatch: jest.fn(),
    saveLastOptionsShown: jest.fn(),
    ...overrides,
  }
}

const threeLinksWidgets = [
  { id: 'links-panels', title: 'Links Panels', type: 'links_note_tiptap' },
  { id: 'links-panel-d', title: 'Links Panel D', type: 'links_note_tiptap' },
  { id: 'links-panel-e', title: 'Links Panel E', type: 'links_note_tiptap' },
]

describe('handleKnownNounRouting — Tier 4 fallthrough guard', () => {
  test('Test A: "open links panel" + 3 Links Panel variants → falls through (handled: false)', () => {
    const ctx = makeContext({
      trimmedInput: 'open links panel',
      visibleWidgets: threeLinksWidgets,
    })
    const result = handleKnownNounRouting(ctx)
    // Tier 4 matches "links panel" → Quick Links → not visible → but ambiguous evidence exists → falls through
    expect(result.handled).toBe(false)
    // "not available" message should NOT have been shown
    expect(ctx.addMessage).not.toHaveBeenCalled()
  })

  test('Test B: "open quick links" + no Quick Links variants → "not available" (handled: true)', () => {
    const ctx = makeContext({
      trimmedInput: 'open quick links',
      visibleWidgets: [
        { id: 'recent', title: 'Recent', type: 'recent' },
      ],
    })
    const result = handleKnownNounRouting(ctx)
    expect(result.handled).toBe(true)
    expect(ctx.addMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining("isn't available"),
      })
    )
  })

  test('Test C: "links panel d" + Links Panel D visible → opens directly (handled: true)', () => {
    const ctx = makeContext({
      trimmedInput: 'links panel d',
      visibleWidgets: [
        { id: 'links-panel-d', title: 'Links Panel D', type: 'links_note_tiptap' },
        { id: 'links-panel-e', title: 'Links Panel E', type: 'links_note_tiptap' },
      ],
    })
    const result = handleKnownNounRouting(ctx)
    expect(result.handled).toBe(true)
    expect(ctx.openPanelDrawer).toHaveBeenCalledWith('links-panel-d', 'Links Panel D', expect.objectContaining({
      reasonCode: 'explicit_label_match',
      resolverPath: 'knownNounRouting',
    }))
  })

  test('Test D: "open links panel" + only Links Panel D → no ambiguous evidence, "not available"', () => {
    // With verb stripping in Tier 2c, this case is handled by Tier 2c (single-match open).
    // At Tier 4 level, the tightened guard sees only 1 partial match → no ambiguous evidence → "not available".
    const ctx = makeContext({
      trimmedInput: 'open links panel',
      visibleWidgets: [
        { id: 'links-panel-d', title: 'Links Panel D', type: 'links_note_tiptap' },
      ],
    })
    const result = handleKnownNounRouting(ctx)
    // Tier 4 should NOT fall through (only 1 partial match, not ambiguous)
    expect(result.handled).toBe(true)
    expect(ctx.addMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining("isn't available"),
      })
    )
  })
})
