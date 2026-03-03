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

describe('matchVisiblePanelCommand — raw input (no verb stripping)', () => {
  // Per raw-strict-exact plan: matchVisiblePanelCommand no longer strips verbs.
  // "open" becomes an extra token that affects matching.
  const threeLinksWidgets: VisibleWidget[] = [
    { id: 'links-panels', title: 'Links Panels', type: 'links_note_tiptap' },
    { id: 'links-panel-d', title: 'Links Panel D', type: 'links_note_tiptap' },
    { id: 'links-panel-e', title: 'Links Panel E', type: 'links_note_tiptap' },
  ]

  test('verb-prefixed input: "open links panel" → exact match for Links Panels only (open is extra token)', () => {
    // tokens: {open, links, panel} — "open" fuzzy-matches KNOWN_PANEL_TERMS "open"
    // "Links Panels" title tokens {links, panel} ⊂ input → exact
    // "Links Panel D" title tokens {links, panel, d} → "d" not in input → no match
    // Without verb stripping, only Links Panels matches (its title tokens are subset of input)
    const result = matchVisiblePanelCommand('open links panel', threeLinksWidgets)
    expect(result.type).toBe('exact')
    expect(result.matches.length).toBe(1)
    expect(result.matches[0].id).toBe('links-panels')
  })

  test('verb-prefixed input with badge: "open links panel d" → exact match (single panel)', () => {
    // tokens: {open, links, panel, d}
    // "Links Panel D" title tokens {links, panel, d} ⊂ input → exact match
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

  test('single panel — "open links panel" with only Links Panel D → none (d not in input)', () => {
    // tokens: {open, links, panel} — "d" not present
    // "Links Panel D" tokens {links, panel, d} → "d" not in input → NO exact
    // input ⊂ title? {open, links, panel} → "open" not in title → NO partial
    const widgets: VisibleWidget[] = [
      { id: 'links-panel-d', title: 'Links Panel D', type: 'links_note_tiptap' },
    ]
    const result = matchVisiblePanelCommand('open links panel', widgets)
    expect(result.type).toBe('none')
  })

  test('raw input without verb: "links panel" → partial match (all 3 panels)', () => {
    // tokens: {links, panel}
    // "Links Panels" title tokens {links, panel} = input → exact
    // "Links Panel D" title tokens {links, panel, d} → input ⊂ title → partial
    // "Links Panel E" title tokens {links, panel, e} → input ⊂ title → partial
    const result = matchVisiblePanelCommand('links panel', threeLinksWidgets)
    expect(result.type).toBe('partial')
    expect(result.matches.length).toBe(3)
  })

  test('raw input: "Links Panel D" → exact match for D only (tiebreaker: D has 3 tokens, Links Panels has 2)', () => {
    // "Links Panel D" tokens = {links, panel, d} (3 tokens)
    // "Links Panels" tokens = {links, panel} (2 tokens)
    // Both are subsets of input, but D is more specific → tiebreaker picks D only
    const result = matchVisiblePanelCommand('Links Panel D', threeLinksWidgets)
    expect(result.type).toBe('exact')
    expect(result.matches.map(m => m.id)).toEqual(['links-panel-d'])
  })
})

// =============================================================================
// handlePanelDisambiguation — single-match direct open (Step 1b)
// =============================================================================

import { handlePanelDisambiguation } from '@/lib/chat/chat-routing'

describe('handlePanelDisambiguation — single-match direct open', () => {
  test('Test E: "open links panel" with single panel → none match (verb token blocks)', () => {
    // Per raw-strict-exact plan: no verb stripping. "open links panel" → tokens {open, links, panel}
    // "Links Panel D" title tokens {links, panel, d} → "d" not in input → NO exact
    // input ⊂ title? {open, links, panel} → "open" not in title → NO partial
    // Result: type: 'none' → handled: false
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

    expect(result.handled).toBe(false)
    expect(openPanelDrawer).not.toHaveBeenCalled()
    expect(setPendingOptions).not.toHaveBeenCalled()
  })

  test('single match without openPanelDrawer → falls through safely', () => {
    const addMessage = jest.fn()
    const result = handlePanelDisambiguation({
      // Use raw exact input — this one should match
      trimmedInput: 'Links Panel D',
      visibleWidgets: [
        { id: 'links-panel-d', title: 'Links Panel D', type: 'links_note_tiptap' },
      ],
      addMessage,
      setIsLoading: jest.fn(),
      setPendingOptions: jest.fn(),
      setPendingOptionsMessageId: jest.fn(),
      setLastClarification: jest.fn(),
      // openPanelDrawer NOT provided → isSingleMatch path can't execute
    })

    // Single match but no openPanelDrawer → falls through safely
    expect(result.handled).toBe(false)
    expect(addMessage).not.toHaveBeenCalled()
  })

  test('"open links panel" with 3 panels → single exact match for Links Panels only', () => {
    // Per raw-strict-exact plan: "open" is an extra token, not stripped
    // tokens: {open, links, panel}
    // Only "Links Panels" {links, panel} ⊂ input → exact match
    // "Links Panel D/E" need d/e in input → no match
    const openPanelDrawer = jest.fn()
    const addMessage = jest.fn()

    const result = handlePanelDisambiguation({
      trimmedInput: 'open links panel',
      visibleWidgets: [
        { id: 'links-panels', title: 'Links Panels', type: 'links_note_tiptap' },
        { id: 'links-panel-d', title: 'Links Panel D', type: 'links_note_tiptap' },
        { id: 'links-panel-e', title: 'Links Panel E', type: 'links_note_tiptap' },
      ],
      addMessage,
      setIsLoading: jest.fn(),
      setPendingOptions: jest.fn(),
      setPendingOptionsMessageId: jest.fn(),
      setLastClarification: jest.fn(),
      saveLastOptionsShown: jest.fn(),
      clearWidgetSelectionContext: jest.fn(),
      openPanelDrawer,
    })

    // Single match → goes through strict exact gate
    // "open links panel" ≠ "Links Panels" → strict exact fails → handled: false
    expect(result.handled).toBe(false)
    expect(openPanelDrawer).not.toHaveBeenCalled()
  })

  test('"links panel" (raw, no verb) with 3 panels → disambiguation', () => {
    // tokens: {links, panel}
    // "Links Panels" {links, panel} ⊂ input → exact
    // "Links Panel D" {links, panel, d} → input ⊂ title → partial
    // "Links Panel E" {links, panel, e} → input ⊂ title → partial
    // Has partial matches → disambiguation
    const openPanelDrawer = jest.fn()
    const addMessage = jest.fn()
    const setPendingOptions = jest.fn()

    const result = handlePanelDisambiguation({
      trimmedInput: 'links panel',
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

describe('matchVisiblePanelCommand — polite/natural variants (raw input, no stripping)', () => {
  // Per raw-strict-exact plan: polite prefixes are NOT stripped from matchVisiblePanelCommand.
  // These tokens (can, you, open, show, etc.) become part of the token set.
  // Since panel titles don't contain these words, matching behavior changes:
  // "can you open links panel pls" → tokens include {can, you, open, links, panel}
  // Only "Links Panels" has its title tokens {links, panel} ⊂ input → exact match.
  const threeLinksWidgets: VisibleWidget[] = [
    { id: 'links-panels', title: 'Links Panels', type: 'links_note_tiptap' },
    { id: 'links-panel-d', title: 'Links Panel D', type: 'links_note_tiptap' },
    { id: 'links-panel-e', title: 'Links Panel E', type: 'links_note_tiptap' },
  ]

  test('"can you open links panel pls" → exact match for Links Panels only', () => {
    // "can", "you" are NOT stopwords. "open" is a known panel term. "pls" is stopword (filtered).
    // tokens: {can, you, open, links, panel}
    // Only "Links Panels" {links, panel} ⊂ input → exact
    const result = matchVisiblePanelCommand('can you open links panel pls', threeLinksWidgets)
    expect(result.type).toBe('exact')
    expect(result.matches.length).toBe(1)
    expect(result.matches[0].id).toBe('links-panels')
  })

  test('"hey open the links panel" → exact match for Links Panels only', () => {
    // "hey" not stopword, "the" is stopword (filtered), "open" known term
    // tokens: {hey, open, links, panel}
    const result = matchVisiblePanelCommand('hey open the links panel', threeLinksWidgets)
    expect(result.type).toBe('exact')
    expect(result.matches.length).toBe(1)
  })

  test('"could you show the links panel please" → exact match for Links Panels only', () => {
    // tokens: {could, you, show, links, panel} (the/please are stopwords, filtered)
    const result = matchVisiblePanelCommand('could you show the links panel please', threeLinksWidgets)
    expect(result.type).toBe('exact')
    expect(result.matches.length).toBe(1)
  })

  test('"can you open the links panel" → exact match for Links Panels only', () => {
    const result = matchVisiblePanelCommand('can you open the links panel', threeLinksWidgets)
    expect(result.type).toBe('exact')
    expect(result.matches.length).toBe(1)
  })

  test('"please show links panel d" + single panel → exact match (d in input)', () => {
    // tokens: {show, links, panel, d} ("please" is stopword)
    // "Links Panel D" tokens {links, panel, d} ⊂ input → exact
    const result = matchVisiblePanelCommand('please show links panel d', [
      { id: 'links-panel-d', title: 'Links Panel D', type: 'links_note_tiptap' },
    ])
    expect(result.type).toBe('exact')
    expect(result.matches[0].id).toBe('links-panel-d')
  })
})

// =============================================================================
// Normalization order fix — "plsss" token pollution regression tests
// Per plan: normalizeToTokenSet must normalize FIRST, filter stopwords AFTER.
// =============================================================================

describe('matchVisiblePanelCommand — normalization order (stopword after normalize, raw input)', () => {
  const threeLinksWidgets: VisibleWidget[] = [
    { id: 'links-panels', title: 'Links Panels', type: 'links_note_tiptap' },
    { id: 'links-panel-d', title: 'Links Panel D', type: 'links_note_tiptap' },
    { id: 'links-panel-e', title: 'Links Panel E', type: 'links_note_tiptap' },
  ]

  test('"open the links panel plsss" → exact match for Links Panels only (no verb stripping)', () => {
    // Per raw-strict-exact plan: raw input → tokens include "open"
    // "plsss" → "pls" (dedup) → stopword → filtered
    // "the" → stopword → filtered
    // tokens = {open, links, panel}
    // "Links Panels" {links, panel} ⊂ input → exact
    // "Links Panel D" {links, panel, d} → d not in input → no match
    const result = matchVisiblePanelCommand('open the links panel plsss', threeLinksWidgets)
    expect(result.type).toBe('exact')
    expect(result.matches.length).toBe(1)
    expect(result.matches[0].id).toBe('links-panels')
  })

  test('"open the links panel pls" → exact match for Links Panels only', () => {
    // "pls" → stopword → filtered
    // tokens = {open, links, panel}
    const result = matchVisiblePanelCommand('open the links panel pls', threeLinksWidgets)
    expect(result.type).toBe('exact')
    expect(result.matches.length).toBe(1)
    expect(result.matches[0].id).toBe('links-panels')
  })

  test('"links panel d" → exact match for D only (tiebreaker: D more specific)', () => {
    // Raw input without verb → tokens = {links, panel, d}
    // "Links Panel D" tokens = {links, panel, d} → title⊆input → exact (3 tokens)
    // "Links Panels" tokens = {links, panel} → title⊆input → exact (2 tokens)
    // "Links Panel E" tokens = {links, panel, e} → e ∉ input → no match
    // Tiebreaker: D has 3 tokens > 2 → only D survives
    const result = matchVisiblePanelCommand('links panel d', threeLinksWidgets)
    expect(result.type).toBe('exact')
    expect(result.matches.map(m => m.id)).toEqual(['links-panel-d'])
  })

  test('"open the links panel pleaseee" → exact match for Links Panels only', () => {
    // "pleaseee" → "please" (dedup) → stopword → filtered
    // tokens = {open, links, panel}
    const result = matchVisiblePanelCommand('open the links panel pleaseee', threeLinksWidgets)
    expect(result.type).toBe('exact')
    expect(result.matches.length).toBe(1)
  })

  test('"open the links panel thxx" → exact match for Links Panels only', () => {
    // "thxx" → "thx" (dedup) → stopword → filtered
    // tokens = {open, links, panel}
    const result = matchVisiblePanelCommand('open the links panel thxx', threeLinksWidgets)
    expect(result.type).toBe('exact')
    expect(result.matches.length).toBe(1)
  })
})

// =============================================================================
// Best-specificity tiebreaker — stopword badge fix
// =============================================================================

describe('matchVisiblePanelCommand — best-specificity tiebreaker', () => {
  test('"open links panel b" with A and B → single exact match for B (stopword tiebreaker)', () => {
    // "Links Panel A" → tokens {links, panel} (badge 'a' stripped as stopword)
    // "Links Panel B" → tokens {links, panel, b}
    // Input → tokens {open, links, panel, b}
    // Both are subsets of input → both exact matches
    // Tiebreaker: B has 3 tokens > A's 2 → only B survives
    const widgets: VisibleWidget[] = [
      { id: 'links-panel-a', title: 'Links Panel A', type: 'links_note_tiptap' },
      { id: 'links-panel-b', title: 'Links Panel B', type: 'links_note_tiptap' },
    ]
    const result = matchVisiblePanelCommand('open links panel b', widgets)
    expect(result.type).toBe('exact')
    expect(result.matches.length).toBe(1)
    expect(result.matches[0].id).toBe('links-panel-b')
  })

  test('two panels with equal token count → both survive tiebreaker', () => {
    // "Budget Panel" → tokens {budget, panel} (2 tokens)
    // "Report Panel" → tokens {report, panel} (2 tokens)
    // Input "budget report panel" → tokens {budget, report, panel}
    // Both title token sets are subsets of input → both exact
    // Equal token count → tied → both survive
    const widgets: VisibleWidget[] = [
      { id: 'budget-panel', title: 'Budget Panel', type: 'custom' },
      { id: 'report-panel', title: 'Report Panel', type: 'custom' },
    ]
    const result = matchVisiblePanelCommand('budget report panel', widgets)
    expect(result.type).toBe('exact')
    expect(result.matches.length).toBe(2)
  })
})

// =============================================================================
// handlePanelDisambiguation — multiple exact matches (Layer 2 defense)
// =============================================================================

describe('handlePanelDisambiguation — multiple exact matches', () => {
  test('multiple exact matches (equal specificity) → disambiguation handled', () => {
    // Two panels with identical token counts after normalization
    // Both are exact matches → tiebreaker keeps both → disambiguation handler catches them
    const setPendingOptions = jest.fn()
    const addMessage = jest.fn()
    const result = handlePanelDisambiguation({
      trimmedInput: 'budget report panel',
      visibleWidgets: [
        { id: 'budget-panel', title: 'Budget Panel', type: 'custom' },
        { id: 'report-panel', title: 'Report Panel', type: 'custom' },
      ],
      addMessage,
      setIsLoading: jest.fn(),
      setPendingOptions,
      setPendingOptionsMessageId: jest.fn(),
      setLastClarification: jest.fn(),
      saveLastOptionsShown: jest.fn(),
      clearWidgetSelectionContext: jest.fn(),
    })
    expect(result.handled).toBe(true)
    expect(addMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('Multiple'),
      })
    )
    expect(setPendingOptions).toHaveBeenCalled()
  })
})
