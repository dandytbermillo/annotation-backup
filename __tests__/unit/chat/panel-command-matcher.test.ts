/**
 * Unit tests for panel-command-matcher.ts
 * Covers typo normalization and fuzzy matching for panel commands.
 */

import { matchVisiblePanelCommand, stripVerbPrefix, type VisibleWidget } from '@/lib/chat/panel-command-matcher'
import { canonicalizeCommandInput } from '@/lib/chat/input-classifiers'

const visibleWidgets: VisibleWidget[] = [
  { id: 'links-panel-d', title: 'Links Panel D', type: 'links_note_tiptap' },
  { id: 'links-panel-e', title: 'Links Panel E', type: 'links_note_tiptap' },
  { id: 'recent', title: 'Recent', type: 'recent' },
]

describe('matchVisiblePanelCommand', () => {
  test('handles repeated letter typos (llink panel → partial match)', () => {
    const result = matchVisiblePanelCommand('llink panel', visibleWidgets)
    expect(result.type).toBe('partial')
    expect(result.matches.map(m => m.id).sort()).toEqual(['links-panel-d', 'links-panel-e'])
  })

  test('handles fuzzy typos (limk panels → partial match)', () => {
    const result = matchVisiblePanelCommand('limk panels', visibleWidgets)
    expect(result.type).toBe('partial')
    expect(result.matches.map(m => m.id).sort()).toEqual(['links-panel-d', 'links-panel-e'])
  })

  test('handles command typos with badge (opwn linkk panel d → exact match)', () => {
    const result = matchVisiblePanelCommand('opwn linkk panel d', visibleWidgets)
    expect(result.type).toBe('exact')
    expect(result.matches.map(m => m.id)).toEqual(['links-panel-d'])
  })

  test('handles command typo for recent (opne recent → exact match)', () => {
    const result = matchVisiblePanelCommand('opne recent', visibleWidgets)
    expect(result.type).toBe('exact')
    expect(result.matches.map(m => m.id)).toEqual(['recent'])
  })
})

// =============================================================================
// Verb prefix stripping tests (Step 1 — Tier 2c disambiguation fix)
// =============================================================================

describe('stripVerbPrefix', () => {
  test('strips "open " prefix', () => {
    expect(stripVerbPrefix('open links panel')).toBe('links panel')
  })

  test('strips "please open " prefix', () => {
    expect(stripVerbPrefix('please open links panel')).toBe('links panel')
  })

  test('strips "can you open " prefix', () => {
    expect(stripVerbPrefix('can you open links panel')).toBe('links panel')
  })

  test('strips "show " prefix', () => {
    expect(stripVerbPrefix('show recent')).toBe('recent')
  })

  test('no-op when no verb prefix', () => {
    expect(stripVerbPrefix('links panel')).toBe('links panel')
  })
})

describe('matchVisiblePanelCommand — verb prefix stripping', () => {
  const threeLinksWidgets: VisibleWidget[] = [
    { id: 'links-panels', title: 'Links Panels', type: 'links_note_tiptap' },
    { id: 'links-panel-d', title: 'Links Panel D', type: 'links_note_tiptap' },
    { id: 'links-panel-e', title: 'Links Panel E', type: 'links_note_tiptap' },
  ]

  test('verb-prefixed input produces partial disambiguation (3 panels)', () => {
    const result = matchVisiblePanelCommand('open links panel', threeLinksWidgets)
    expect(result.type).toBe('partial')
    expect(result.matches.length).toBe(3)
    expect(result.matches.map(m => m.id).sort()).toEqual([
      'links-panel-d', 'links-panel-e', 'links-panels',
    ])
  })

  test('verb-prefixed input with badge resolves exact (single panel)', () => {
    const result = matchVisiblePanelCommand('open links panel d', [
      { id: 'links-panel-d', title: 'Links Panel D', type: 'links_note_tiptap' },
      { id: 'links-panel-e', title: 'Links Panel E', type: 'links_note_tiptap' },
    ])
    expect(result.type).toBe('exact')
    expect(result.matches.map(m => m.id)).toEqual(['links-panel-d'])
  })

  test('no visible match evidence when panel family absent', () => {
    const widgets: VisibleWidget[] = [
      { id: 'recent', title: 'Recent', type: 'recent' },
    ]
    const result = matchVisiblePanelCommand('open links panel', widgets)
    expect(result.type).toBe('none')
  })

  test('single panel — partial match, length 1', () => {
    const widgets: VisibleWidget[] = [
      { id: 'links-panel-d', title: 'Links Panel D', type: 'links_note_tiptap' },
    ]
    const result = matchVisiblePanelCommand('open links panel', widgets)
    expect(result.type).toBe('partial')
    expect(result.matches.length).toBe(1)
    expect(result.matches[0].id).toBe('links-panel-d')
  })
})

// =============================================================================
// handlePanelDisambiguation — single-match direct open (Step 1b)
// =============================================================================

import { handlePanelDisambiguation } from '@/lib/chat/chat-routing'

describe('handlePanelDisambiguation — single-match direct open', () => {
  test('Test E: single partial match → falls through (unresolved gate — Rule B)', () => {
    // "open links panel" → verb-stripped "links panel" → partial match against "Links Panel D"
    // Per unresolved gate: partial match returns handled: false (falls through to LLM tier)
    const openPanelDrawer = jest.fn()
    const addMessage = jest.fn()
    const setPendingOptions = jest.fn()
    const setPendingOptionsMessageId = jest.fn()
    const setLastClarification = jest.fn()
    const setIsLoading = jest.fn()
    const clearWidgetSelectionContext = jest.fn()

    const result = handlePanelDisambiguation({
      trimmedInput: 'open links panel',
      visibleWidgets: [
        { id: 'links-panel-d', title: 'Links Panel D', type: 'links_note_tiptap' },
      ],
      addMessage,
      setIsLoading,
      setPendingOptions,
      setPendingOptionsMessageId,
      setLastClarification,
      clearWidgetSelectionContext,
      openPanelDrawer,
    })

    // Partial match → unresolved gate → handled: false (falls through to LLM tier)
    expect(result.handled).toBe(false)
    expect(openPanelDrawer).not.toHaveBeenCalled()
    // Context NOT cleared (preserved for LLM tier)
    expect(setPendingOptions).not.toHaveBeenCalled()
    expect(setPendingOptionsMessageId).not.toHaveBeenCalled()
    expect(setLastClarification).not.toHaveBeenCalled()
  })

  test('single match without openPanelDrawer → falls through safely', () => {
    const addMessage = jest.fn()
    const result = handlePanelDisambiguation({
      trimmedInput: 'open links panel',
      visibleWidgets: [
        { id: 'links-panel-d', title: 'Links Panel D', type: 'links_note_tiptap' },
      ],
      addMessage,
      setIsLoading: jest.fn(),
      setPendingOptions: jest.fn(),
      setPendingOptionsMessageId: jest.fn(),
      setLastClarification: jest.fn(),
      // openPanelDrawer NOT provided
    })

    // Should fall through safely (not crash, not open)
    expect(result.handled).toBe(false)
    expect(addMessage).not.toHaveBeenCalled()
  })

  test('multi-panel match → disambiguation (existing behavior preserved)', () => {
    const openPanelDrawer = jest.fn()
    const addMessage = jest.fn()
    const setPendingOptions = jest.fn()

    const result = handlePanelDisambiguation({
      trimmedInput: 'open links panel',
      visibleWidgets: [
        { id: 'links-panels', title: 'Links Panels', type: 'links_note_tiptap' },
        { id: 'links-panel-d', title: 'Links Panel D', type: 'links_note_tiptap' },
        { id: 'links-panel-e', title: 'Links Panel E', type: 'links_note_tiptap' },
      ],
      addMessage,
      setIsLoading: jest.fn(),
      setPendingOptions,
      setPendingOptionsMessageId: jest.fn(),
      setLastClarification: jest.fn(),
      saveLastOptionsShown: jest.fn(),
      clearWidgetSelectionContext: jest.fn(),
      openPanelDrawer,
    })

    expect(result.handled).toBe(true)
    // Should disambiguate, not open directly
    expect(openPanelDrawer).not.toHaveBeenCalled()
    expect(addMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('Multiple'),
      })
    )
    expect(setPendingOptions).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ label: 'Links Panels' }),
        expect.objectContaining({ label: 'Links Panel D' }),
        expect.objectContaining({ label: 'Links Panel E' }),
      ])
    )
  })
})

// =============================================================================
// canonicalizeCommandInput — shared canonicalizer (Part 1)
// =============================================================================

describe('canonicalizeCommandInput', () => {
  test('"can you open links panel pls" → "links panel"', () => {
    expect(canonicalizeCommandInput('can you open links panel pls')).toBe('links panel')
  })

  test('"hey can you open the links panel" → "links panel"', () => {
    expect(canonicalizeCommandInput('hey can you open the links panel')).toBe('links panel')
  })

  test('"please open recent panel" → "recent panel"', () => {
    expect(canonicalizeCommandInput('please open recent panel')).toBe('recent panel')
  })

  test('"could you show the links panel please" → "links panel"', () => {
    expect(canonicalizeCommandInput('could you show the links panel please')).toBe('links panel')
  })

  test('"open links panel" → "links panel"', () => {
    expect(canonicalizeCommandInput('open links panel')).toBe('links panel')
  })

  test('"links panel" → "links panel" (no-op)', () => {
    expect(canonicalizeCommandInput('links panel')).toBe('links panel')
  })

  test('"open recent" → "recent"', () => {
    expect(canonicalizeCommandInput('open recent')).toBe('recent')
  })

  test('strips trailing punctuation', () => {
    expect(canonicalizeCommandInput('open links panel?')).toBe('links panel')
    expect(canonicalizeCommandInput('links panel!')).toBe('links panel')
  })

  test('stripVerbPrefix delegates to canonicalizeCommandInput', () => {
    // stripVerbPrefix is now a wrapper — verify it produces the same output
    expect(stripVerbPrefix('can you open links panel pls')).toBe('links panel')
    expect(stripVerbPrefix('hey open the links panel')).toBe('links panel')
  })
})

// =============================================================================
// matchVisiblePanelCommand — natural polite variants (Part 1 validation)
// =============================================================================

describe('matchVisiblePanelCommand — polite/natural variants', () => {
  const threeLinksWidgets: VisibleWidget[] = [
    { id: 'links-panels', title: 'Links Panels', type: 'links_note_tiptap' },
    { id: 'links-panel-d', title: 'Links Panel D', type: 'links_note_tiptap' },
    { id: 'links-panel-e', title: 'Links Panel E', type: 'links_note_tiptap' },
  ]

  test('"can you open links panel pls" → partial disambiguation (3 panels)', () => {
    const result = matchVisiblePanelCommand('can you open links panel pls', threeLinksWidgets)
    expect(result.type).toBe('partial')
    expect(result.matches.length).toBe(3)
  })

  test('"hey open the links panel" → partial disambiguation', () => {
    const result = matchVisiblePanelCommand('hey open the links panel', threeLinksWidgets)
    expect(result.type).toBe('partial')
    expect(result.matches.length).toBe(3)
  })

  test('"could you show the links panel please" → partial disambiguation', () => {
    const result = matchVisiblePanelCommand('could you show the links panel please', threeLinksWidgets)
    expect(result.type).toBe('partial')
    expect(result.matches.length).toBe(3)
  })

  test('"can you open the links panel" → partial disambiguation', () => {
    const result = matchVisiblePanelCommand('can you open the links panel', threeLinksWidgets)
    expect(result.type).toBe('partial')
    expect(result.matches.length).toBe(3)
  })

  test('"please show links panel d" + single panel → exact match', () => {
    const result = matchVisiblePanelCommand('please show links panel d', [
      { id: 'links-panel-d', title: 'Links Panel D', type: 'links_note_tiptap' },
    ])
    expect(result.type).toBe('exact')
    expect(result.matches[0].id).toBe('links-panel-d')
  })
})
