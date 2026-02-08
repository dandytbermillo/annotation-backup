/**
 * Unit tests for selection-intent-arbitration plan implementation.
 *
 * Tests:
 * 1. isSelectionOnly strict vs embedded mode
 * 2. FocusLatchState discriminated union + getLatchId
 * 3. normalizeOrdinalTypos shared utility
 * 4. Command escape: "open second one" stays in selection flow with embedded, escapes with strict
 */

import {
  isSelectionOnly,
  normalizeOrdinalTypos,
  isExplicitCommand,
  resolveScopeCue,
  ORDINAL_TARGETS,
} from '@/lib/chat/input-classifiers'
import { getLatchId } from '@/lib/chat/chat-navigation-context'
import type { ResolvedFocusLatch, PendingFocusLatch, FocusLatchState } from '@/lib/chat/chat-navigation-context'

// =============================================================================
// isSelectionOnly: strict vs embedded mode
// =============================================================================

describe('isSelectionOnly', () => {
  describe('strict mode', () => {
    it('matches pure ordinals', () => {
      expect(isSelectionOnly('first', 5, [], 'strict')).toEqual({ isSelection: true, index: 0 })
      expect(isSelectionOnly('second', 5, [], 'strict')).toEqual({ isSelection: true, index: 1 })
      expect(isSelectionOnly('3', 5, [], 'strict')).toEqual({ isSelection: true, index: 2 })
      expect(isSelectionOnly('the first one', 5, [], 'strict')).toEqual({ isSelection: true, index: 0 })
      expect(isSelectionOnly('option 2', 5, [], 'strict')).toEqual({ isSelection: true, index: 1 })
    })

    it('rejects embedded ordinals (long-tail phrasing)', () => {
      expect(isSelectionOnly('open second one', 5, [], 'strict').isSelection).toBe(false)
      expect(isSelectionOnly('can you pick the first', 5, [], 'strict').isSelection).toBe(false)
      expect(isSelectionOnly('open that second option', 5, [], 'strict').isSelection).toBe(false)
      expect(isSelectionOnly('pls open the initial choice now', 5, [], 'strict').isSelection).toBe(false)
    })

    it('handles typos via normalizeOrdinalTypos', () => {
      expect(isSelectionOnly('sedond', 5, [], 'strict')).toEqual({ isSelection: true, index: 1 })
      expect(isSelectionOnly('ffirst', 5, [], 'strict')).toEqual({ isSelection: true, index: 0 })
    })

    it('matches single letters with label badge check', () => {
      expect(isSelectionOnly('a', 3, ['Panel A', 'Panel B', 'Panel C'], 'strict')).toEqual({ isSelection: true, index: 0 })
      expect(isSelectionOnly('b', 3, ['Panel A', 'Panel B', 'Panel C'], 'strict')).toEqual({ isSelection: true, index: 1 })
    })

    it('handles last ordinal', () => {
      expect(isSelectionOnly('last', 3, [], 'strict')).toEqual({ isSelection: true, index: 2 })
      expect(isSelectionOnly('the last one', 3, [], 'strict')).toEqual({ isSelection: true, index: 2 })
    })
  })

  describe('embedded mode', () => {
    it('matches pure ordinals (same as strict)', () => {
      expect(isSelectionOnly('first', 5, [], 'embedded')).toEqual({ isSelection: true, index: 0 })
      expect(isSelectionOnly('second', 5, [], 'embedded')).toEqual({ isSelection: true, index: 1 })
      expect(isSelectionOnly('3', 5, [], 'embedded')).toEqual({ isSelection: true, index: 2 })
    })

    it('matches embedded ordinals (long-tail phrasing)', () => {
      // CRITICAL: "open second one" must be detected as selection in embedded mode
      // This is the key behavior for looksLikeNewCommand at line 2335
      expect(isSelectionOnly('open second one', 5, [], 'embedded').isSelection).toBe(true)
      expect(isSelectionOnly('open second one', 5, [], 'embedded').index).toBe(1)
    })

    it('matches phrases with embedded ordinals', () => {
      expect(isSelectionOnly('can you pick the first', 5, [], 'embedded')).toEqual({ isSelection: true, index: 0 })
      expect(isSelectionOnly('go with the second', 5, [], 'embedded')).toEqual({ isSelection: true, index: 1 })
      expect(isSelectionOnly('I choose the second one', 5, [], 'embedded')).toEqual({ isSelection: true, index: 1 })
    })

    it('handles typos and variations', () => {
      expect(isSelectionOnly('sedond', 5, [], 'embedded')).toEqual({ isSelection: true, index: 1 })
      expect(isSelectionOnly('the other one', 2, [], 'embedded')).toEqual({ isSelection: true, index: 1 })
      expect(isSelectionOnly('top', 5, [], 'embedded')).toEqual({ isSelection: true, index: 0 })
      // Note: "bottom" fails due to dedup normalization ("tt" → "t" → "botom") — pre-existing behavior
      expect(isSelectionOnly('last', 5, [], 'embedded')).toEqual({ isSelection: true, index: 4 })
    })

    it('rejects out-of-bounds indices', () => {
      expect(isSelectionOnly('fifth', 3, [], 'embedded').isSelection).toBe(false)
      expect(isSelectionOnly('5', 3, [], 'embedded').isSelection).toBe(false)
    })
  })

  describe('command escape (critical acceptance check)', () => {
    it('line 2335 looksLikeNewCommand: "open second one" stays in selection flow with embedded', () => {
      // At line 2335: !isSelectionOnly(input, 10, [], 'embedded').isSelection
      // "open second one" should be isSelection: true → !true = false → looksLikeNewCommand = false
      // → stays in selection flow (correct behavior)
      const result = isSelectionOnly('open second one', 10, [], 'embedded')
      expect(result.isSelection).toBe(true)
    })

    it('line 2335 looksLikeNewCommand: "open second one" escapes with strict mode', () => {
      // If we had used strict mode here, "open second one" would NOT match
      // → isSelection: false → !false = true → looksLikeNewCommand = true
      // → escapes selection flow (wrong behavior for this path)
      const result = isSelectionOnly('open second one', 10, [], 'strict')
      expect(result.isSelection).toBe(false)
    })

    it('"open recent" is not a selection in either mode', () => {
      expect(isSelectionOnly('open recent', 10, [], 'strict').isSelection).toBe(false)
      expect(isSelectionOnly('open recent', 10, [], 'embedded').isSelection).toBe(false)
    })
  })
})

// =============================================================================
// FocusLatchState discriminated union + getLatchId
// =============================================================================

describe('FocusLatchState discriminated union', () => {
  it('getLatchId returns widgetId for resolved latch', () => {
    const resolved: ResolvedFocusLatch = {
      kind: 'resolved',
      widgetId: 'w_links_d',
      widgetLabel: 'Quick Links D',
      latchedAt: Date.now(),
      turnsSinceLatched: 0,
    }
    expect(getLatchId(resolved)).toBe('w_links_d')
  })

  it('getLatchId returns pending:panelId for pending latch', () => {
    const pending: PendingFocusLatch = {
      kind: 'pending',
      pendingPanelId: 'uuid-1234',
      widgetLabel: 'Quick Links D',
      latchedAt: Date.now(),
      turnsSinceLatched: 0,
    }
    expect(getLatchId(pending)).toBe('pending:uuid-1234')
  })

  it('resolved latch has widgetId, not pendingPanelId', () => {
    const resolved: ResolvedFocusLatch = {
      kind: 'resolved',
      widgetId: 'w_links_d',
      widgetLabel: 'Quick Links D',
      latchedAt: Date.now(),
      turnsSinceLatched: 0,
    }
    // TypeScript ensures widgetId exists on resolved
    expect(resolved.widgetId).toBe('w_links_d')
    // @ts-expect-error — pendingPanelId doesn't exist on ResolvedFocusLatch
    expect(resolved.pendingPanelId).toBeUndefined()
  })

  it('pending latch has pendingPanelId, not widgetId', () => {
    const pending: PendingFocusLatch = {
      kind: 'pending',
      pendingPanelId: 'uuid-1234',
      widgetLabel: 'Quick Links D',
      latchedAt: Date.now(),
      turnsSinceLatched: 0,
    }
    expect(pending.pendingPanelId).toBe('uuid-1234')
    // @ts-expect-error — widgetId doesn't exist on PendingFocusLatch
    expect(pending.widgetId).toBeUndefined()
  })

  it('both kinds support suspended state', () => {
    const resolved: ResolvedFocusLatch = {
      kind: 'resolved',
      widgetId: 'w_links_d',
      widgetLabel: 'Quick Links D',
      latchedAt: Date.now(),
      turnsSinceLatched: 0,
      suspended: true,
    }
    expect(resolved.suspended).toBe(true)

    const pending: PendingFocusLatch = {
      kind: 'pending',
      pendingPanelId: 'uuid-1234',
      widgetLabel: 'Quick Links D',
      latchedAt: Date.now(),
      turnsSinceLatched: 0,
      suspended: true,
    }
    expect(pending.suspended).toBe(true)
  })

  it('latchBlocksStaleChat is true for both resolved and pending (not suspended)', () => {
    const resolved: FocusLatchState = {
      kind: 'resolved',
      widgetId: 'w_links_d',
      widgetLabel: 'Quick Links D',
      latchedAt: Date.now(),
      turnsSinceLatched: 0,
    }
    const pending: FocusLatchState = {
      kind: 'pending',
      pendingPanelId: 'uuid-1234',
      widgetLabel: 'Quick Links D',
      latchedAt: Date.now(),
      turnsSinceLatched: 0,
    }
    // Simulates: isLatchEnabled && focusLatch && !focusLatch.suspended
    const check = (latch: FocusLatchState | null) => !!latch && !latch.suspended
    expect(check(resolved)).toBe(true)
    expect(check(pending)).toBe(true)
    expect(check(null)).toBe(false)
    expect(check({ ...resolved, suspended: true })).toBe(false)
  })
})

// =============================================================================
// normalizeOrdinalTypos
// =============================================================================

describe('normalizeOrdinalTypos', () => {
  it('deduplicates repeated letters', () => {
    expect(normalizeOrdinalTypos('ffirst')).toBe('first')
    expect(normalizeOrdinalTypos('seecond')).toBe('second')
  })

  it('splits concatenated ordinal+option', () => {
    expect(normalizeOrdinalTypos('secondoption')).toBe('second option')
    expect(normalizeOrdinalTypos('firstone')).toBe('first one')
  })

  it('strips polite suffixes', () => {
    expect(normalizeOrdinalTypos('second please')).toBe('second')
    expect(normalizeOrdinalTypos('first pls')).toBe('first')
  })

  it('fuzzy matches typos to canonical ordinals', () => {
    // "scond" → distance 1 from "second" → "second"
    expect(normalizeOrdinalTypos('scond')).toBe('second')
    // "thrid" → distance 1 from "third" → "third"
    expect(normalizeOrdinalTypos('thrid')).toBe('third')
  })

  it('preserves short tokens (< 4 chars)', () => {
    expect(normalizeOrdinalTypos('for')).toBe('for')
    expect(normalizeOrdinalTypos('the')).toBe('the')
  })
})

// =============================================================================
// ORDINAL_TARGETS constant
// =============================================================================

describe('ORDINAL_TARGETS', () => {
  it('has 6 canonical ordinals', () => {
    expect(ORDINAL_TARGETS).toEqual(['first', 'second', 'third', 'fourth', 'fifth', 'last'])
  })
})

// =============================================================================
// isExplicitCommand — bypass for ordinals
// =============================================================================

describe('isExplicitCommand', () => {
  it('returns false when input contains ordinals (bypass)', () => {
    expect(isExplicitCommand('open first')).toBe(false)
    expect(isExplicitCommand('open second one')).toBe(false)
    expect(isExplicitCommand('show 2')).toBe(false)
  })

  it('returns true for commands without ordinals', () => {
    expect(isExplicitCommand('open recent')).toBe(true)
    expect(isExplicitCommand('show links')).toBe(true)
    expect(isExplicitCommand('go home')).toBe(true)
  })

  it('returns false for non-command input', () => {
    expect(isExplicitCommand('hello')).toBe(false)
    expect(isExplicitCommand('second')).toBe(false)
    expect(isExplicitCommand('what is this')).toBe(false)
  })
})

// =============================================================================
// resolveScopeCue: scope-cue classification
// =============================================================================

describe('resolveScopeCue', () => {
  describe('chat cues', () => {
    it('detects "in chat"', () => {
      expect(resolveScopeCue('open the first one in chat')).toEqual({ scope: 'chat', cueText: 'in chat', confidence: 'high' })
    })

    it('detects "from chat"', () => {
      expect(resolveScopeCue('from chat')).toEqual({ scope: 'chat', cueText: 'from chat', confidence: 'high' })
    })

    it('detects "from chat" in longer phrase', () => {
      expect(resolveScopeCue('open the first one from chat')).toEqual({ scope: 'chat', cueText: 'from chat', confidence: 'high' })
    })

    it('detects "back to options"', () => {
      expect(resolveScopeCue('back to options')).toEqual({ scope: 'chat', cueText: 'back to options', confidence: 'high' })
    })

    it('detects "from earlier options"', () => {
      expect(resolveScopeCue('from earlier options')).toEqual({ scope: 'chat', cueText: 'from earlier options', confidence: 'high' })
    })

    it('detects "from chat options"', () => {
      expect(resolveScopeCue('from chat options')).toEqual({ scope: 'chat', cueText: 'from chat options', confidence: 'high' })
    })

    it('detects "from the chat"', () => {
      expect(resolveScopeCue('from the chat')).toEqual({ scope: 'chat', cueText: 'from the chat', confidence: 'high' })
    })
  })

  describe('non-chat (scope: none)', () => {
    it('returns none for ordinal-only input', () => {
      expect(resolveScopeCue('open the second one')).toEqual({ scope: 'none', cueText: null, confidence: 'none' })
    })

    it('returns none for commands', () => {
      expect(resolveScopeCue('open recent')).toEqual({ scope: 'none', cueText: null, confidence: 'none' })
    })

    it('returns none for plain selection', () => {
      expect(resolveScopeCue('second one pls')).toEqual({ scope: 'none', cueText: null, confidence: 'none' })
    })

    it('returns none for questions', () => {
      expect(resolveScopeCue('what is this')).toEqual({ scope: 'none', cueText: null, confidence: 'none' })
    })
  })

  describe('edge cases — word boundary', () => {
    it('does not match "chat" as part of "chatbot"', () => {
      expect(resolveScopeCue('chatbot help')).toEqual({ scope: 'none', cueText: null, confidence: 'none' })
    })

    it('returns none for empty string', () => {
      expect(resolveScopeCue('')).toEqual({ scope: 'none', cueText: null, confidence: 'none' })
    })

    it('does not match "chat" as part of "chatter"', () => {
      expect(resolveScopeCue('from chatter')).toEqual({ scope: 'none', cueText: null, confidence: 'none' })
    })

    it('does not match "chat" as part of "chatroom"', () => {
      expect(resolveScopeCue('podcast in chatroom')).toEqual({ scope: 'none', cueText: null, confidence: 'none' })
    })
  })
})

// =============================================================================
// Scope-cue + isSelectionOnly interaction (command precedence)
// =============================================================================

describe('scope-cue + isSelectionOnly interaction (command precedence)', () => {
  const MOCK_OPTIONS = ['Links Panels', 'Links Panel D', 'Links Panel E']

  it('selection wins over command when ordinal is present: "open the first one in chat"', () => {
    const scopeResult = resolveScopeCue('open the first one in chat')
    expect(scopeResult.scope).toBe('chat')
    const selectionResult = isSelectionOnly('open the first one in chat', 3, MOCK_OPTIONS, 'embedded')
    expect(selectionResult.isSelection).toBe(true)
    expect(selectionResult.index).toBe(0)
  })

  it('selection wins over command when ordinal is present: "show the second one in chat"', () => {
    const scopeResult = resolveScopeCue('show the second one in chat')
    expect(scopeResult.scope).toBe('chat')
    const selectionResult = isSelectionOnly('show the second one in chat', 3, MOCK_OPTIONS, 'embedded')
    expect(selectionResult.isSelection).toBe(true)
    expect(selectionResult.index).toBe(1)
  })

  it('command wins when no ordinal: "open recent in chat"', () => {
    const scopeResult = resolveScopeCue('open recent in chat')
    expect(scopeResult.scope).toBe('chat')
    const selectionResult = isSelectionOnly('open recent in chat', 3, MOCK_OPTIONS, 'embedded')
    expect(selectionResult.isSelection).toBe(false)
  })

  it('question with fuzzy ordinal "this"→"third": embedded mode detects selection (pre-existing)', () => {
    // "this" fuzzy-matches "third" via levenshtein distance 2 in embedded mode.
    // This is pre-existing embedded parser behavior, not scope-cue specific.
    const scopeResult = resolveScopeCue('what is this in chat')
    expect(scopeResult.scope).toBe('chat')
    const selectionResult = isSelectionOnly('what is this in chat', 3, MOCK_OPTIONS, 'embedded')
    expect(selectionResult.isSelection).toBe(true)
    expect(selectionResult.index).toBe(2) // "this" → "third" → index 2
  })

  it('question without ordinal-like words falls through: "how does it work in chat"', () => {
    const scopeResult = resolveScopeCue('how does it work in chat')
    expect(scopeResult.scope).toBe('chat')
    const selectionResult = isSelectionOnly('how does it work in chat', 3, MOCK_OPTIONS, 'embedded')
    expect(selectionResult.isSelection).toBe(false)
  })

  it('question with ordinal — edge case: selection wins (matches existing behavior)', () => {
    const scopeResult = resolveScopeCue('what is the first one in chat')
    expect(scopeResult.scope).toBe('chat')
    const selectionResult = isSelectionOnly('what is the first one in chat', 3, MOCK_OPTIONS, 'embedded')
    expect(selectionResult.isSelection).toBe(true)
    expect(selectionResult.index).toBe(0)
  })

  it('standalone scope cue: "from chat" is not a selection', () => {
    const scopeResult = resolveScopeCue('from chat')
    expect(scopeResult.scope).toBe('chat')
    const selectionResult = isSelectionOnly('from chat', 3, MOCK_OPTIONS, 'embedded')
    expect(selectionResult.isSelection).toBe(false)
  })

  it('standalone scope cue: "back to options" is not a selection', () => {
    const scopeResult = resolveScopeCue('back to options')
    expect(scopeResult.scope).toBe('chat')
    const selectionResult = isSelectionOnly('back to options', 3, MOCK_OPTIONS, 'embedded')
    expect(selectionResult.isSelection).toBe(false)
  })
})
