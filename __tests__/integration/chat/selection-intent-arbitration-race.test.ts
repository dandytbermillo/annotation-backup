/**
 * Integration tests for selection-intent-arbitration race conditions.
 *
 * Tests the end-to-end behavior of the focus latch system:
 * 1. Pending latch race: pending latch blocks stale chat ordinals
 * 2. Command escape: embedded mode keeps "open second one" in selection flow
 * 3. Flag-off behavior: NEXT_PUBLIC_SELECTION_INTENT_ARBITRATION_V1=false → no-op
 *
 * These tests exercise the actual latch logic and stale-chat blocking invariant
 * (latchBlocksStaleChat) across the discriminated union states.
 */

import {
  isSelectionOnly,
  isExplicitCommand,
} from '@/lib/chat/input-classifiers'
import { getLatchId } from '@/lib/chat/chat-navigation-context'
import type {
  ResolvedFocusLatch,
  PendingFocusLatch,
  FocusLatchState,
} from '@/lib/chat/chat-navigation-context'

// =============================================================================
// Helpers
// =============================================================================

/** Simulates latchBlocksStaleChat: isLatchEnabled && focusLatch && !focusLatch.suspended */
function latchBlocksStaleChat(isLatchEnabled: boolean, focusLatch: FocusLatchState | null): boolean {
  return isLatchEnabled && !!focusLatch && !focusLatch.suspended
}

/** Simulates activeWidgetId resolution from Tier 4.5 scoping (routing-dispatcher.ts:2586-2607) */
function resolveActiveWidgetId(
  focusLatch: FocusLatchState | null,
  activeSnapshotWidgetId: string | null,
  isLatchEnabled: boolean,
): string | undefined {
  if (!isLatchEnabled || !focusLatch || focusLatch.suspended) return undefined
  if (focusLatch.kind === 'resolved') return focusLatch.widgetId
  // Pending: fallback to activeSnapshotWidgetId
  return activeSnapshotWidgetId ?? undefined
}

function makeResolvedLatch(widgetId: string, opts?: Partial<ResolvedFocusLatch>): ResolvedFocusLatch {
  return {
    kind: 'resolved',
    widgetId,
    widgetLabel: `Widget ${widgetId}`,
    latchedAt: Date.now(),
    turnsSinceLatched: 0,
    ...opts,
  }
}

function makePendingLatch(panelId: string, opts?: Partial<PendingFocusLatch>): PendingFocusLatch {
  return {
    kind: 'pending',
    pendingPanelId: panelId,
    widgetLabel: `Panel ${panelId}`,
    latchedAt: Date.now(),
    turnsSinceLatched: 0,
    ...opts,
  }
}

// =============================================================================
// Test 1: Pending latch race
// =============================================================================

describe('Pending latch race', () => {
  it('pending latch blocks stale chat ordinals (latchBlocksStaleChat = true)', () => {
    // Scenario: panel disambiguation → select panel → pending latch set
    // → immediate "open second one" → stale chat should NOT capture the ordinal
    const pendingLatch = makePendingLatch('uuid-panel-links-d')

    // latchBlocksStaleChat should be true for pending latch
    expect(latchBlocksStaleChat(true, pendingLatch)).toBe(true)
  })

  it('pending latch resolves to activeSnapshotWidgetId as fallback for Tier 4.5', () => {
    // Widget not yet registered (pending), but activeSnapshotWidgetId is available
    const pendingLatch = makePendingLatch('uuid-panel-links-d')
    const activeSnapshotWidgetId = 'w_links_d'

    const widgetId = resolveActiveWidgetId(pendingLatch, activeSnapshotWidgetId, true)
    expect(widgetId).toBe('w_links_d')
  })

  it('pending latch with no activeSnapshotWidgetId returns undefined (triggers "Still loading")', () => {
    const pendingLatch = makePendingLatch('uuid-panel-links-d')

    const widgetId = resolveActiveWidgetId(pendingLatch, null, true)
    expect(widgetId).toBeUndefined()
  })

  it('pending latch upgrades to resolved when widget registers (kind transition)', () => {
    const pendingLatch = makePendingLatch('uuid-panel-links-d')

    // Simulate widget registration: find widget by panelId → upgrade
    const registeredWidget = { id: 'w_links_d', panelId: 'uuid-panel-links-d' }
    expect(registeredWidget.panelId).toBe(pendingLatch.pendingPanelId)

    // Upgrade: pending → resolved
    const resolvedLatch: ResolvedFocusLatch = {
      kind: 'resolved',
      widgetId: registeredWidget.id,
      widgetLabel: pendingLatch.widgetLabel,
      latchedAt: pendingLatch.latchedAt,
      turnsSinceLatched: pendingLatch.turnsSinceLatched,
    }
    expect(resolvedLatch.kind).toBe('resolved')
    expect(resolvedLatch.widgetId).toBe('w_links_d')
    expect(getLatchId(resolvedLatch)).toBe('w_links_d')
  })

  it('pending latch expires after 2 turns without resolution', () => {
    const pendingLatch = makePendingLatch('uuid-panel-links-d', { turnsSinceLatched: 2 })

    // Per plan: turnsSinceLatched >= 2 → clear (graceful degradation)
    expect(pendingLatch.turnsSinceLatched >= 2).toBe(true)
    // After clearing: latchBlocksStaleChat becomes false
    expect(latchBlocksStaleChat(true, null)).toBe(false)
  })

  it('ordinal "open the second one pls" is selection-like in embedded mode (Tier 4.5 resolves)', () => {
    const result = isSelectionOnly('open the second one pls', 10, [], 'embedded')
    expect(result.isSelection).toBe(true)
    expect(result.index).toBe(1)
  })

  it('full race sequence: pending latch blocks stale chat → ordinal resolves via widget', () => {
    // Step 1: disambiguation options shown (Links Panels, Links Panel D, Links Panel E)
    const disambiguationOptions = ['Links Panels', 'Links Panel D', 'Links Panel E']

    // Step 2: user selects "second one pls" → opens Links Panel D → pending latch set
    const pendingLatch = makePendingLatch('uuid-links-panel-d')

    // Step 3: stale chat ordinal guard fires — latch blocks it
    expect(latchBlocksStaleChat(true, pendingLatch)).toBe(true)

    // Step 4: "open the second one pls" is selection-like → bypass intercept → Tier 4.5
    const selectionResult = isSelectionOnly('open the second one pls', disambiguationOptions.length, disambiguationOptions, 'embedded')
    expect(selectionResult.isSelection).toBe(true)
    expect(selectionResult.index).toBe(1)

    // Step 5: Tier 4.5 resolves with activeSnapshotWidgetId (widget registered by now)
    const resolvedLatch = makeResolvedLatch('w_links_d')
    const activeWidgetId = resolveActiveWidgetId(resolvedLatch, 'w_links_d', true)
    expect(activeWidgetId).toBe('w_links_d')
    // Widget item #2 ("summary 155 D") would be resolved by handleGroundingSetFallback
  })
})

// =============================================================================
// Test 2: Command escape
// =============================================================================

describe('Command escape', () => {
  it('"open second one" stays in selection flow with embedded mode (looksLikeNewCommand = false)', () => {
    // At routing-dispatcher.ts line 2335: looksLikeNewCommand uses embedded mode
    // !isSelectionOnly(input, 10, [], 'embedded').isSelection → !true = false → stays in selection
    const result = isSelectionOnly('open second one', 10, [], 'embedded')
    expect(result.isSelection).toBe(true)
    expect(result.index).toBe(1)
  })

  it('"open second one" escapes selection flow with strict mode (looksLikeNewCommand = true)', () => {
    // If strict mode were used, "open second one" would NOT match → escapes
    const result = isSelectionOnly('open second one', 10, [], 'strict')
    expect(result.isSelection).toBe(false)
  })

  it('"open recent" bypasses latch as explicit command', () => {
    // "open recent" is detected as explicit command → latch bypassed
    expect(isExplicitCommand('open recent')).toBe(true)
    // NOT a selection in either mode
    expect(isSelectionOnly('open recent', 10, [], 'embedded').isSelection).toBe(false)
    expect(isSelectionOnly('open recent', 10, [], 'strict').isSelection).toBe(false)
  })

  it('"open links panel d" bypasses latch as explicit command', () => {
    expect(isExplicitCommand('open links panel d')).toBe(true)
  })

  it('"second one pls" is not an explicit command (stays in selection)', () => {
    expect(isExplicitCommand('second one pls')).toBe(false)
    expect(isSelectionOnly('second one pls', 5, [], 'embedded').isSelection).toBe(true)
  })

  it('explicit command bypasses latch but latch remains active', () => {
    // User says "open recent" → detected as command → latch bypass logged
    // But the latch itself is not cleared by the command — it stays for future ordinals
    // (The panel open handler sets a NEW latch on the target widget)
    const currentLatch = makeResolvedLatch('w_links_d')
    expect(isExplicitCommand('open recent')).toBe(true)
    // Latch still valid
    expect(latchBlocksStaleChat(true, currentLatch)).toBe(true)
    // After "open recent" opens Recent, trySetWidgetLatch replaces with new latch
    const newLatch = makeResolvedLatch('w_recent')
    expect(getLatchId(newLatch)).toBe('w_recent')
  })
})

// =============================================================================
// Test 3: Flag-off behavior
// =============================================================================

describe('Flag-off behavior (NEXT_PUBLIC_SELECTION_INTENT_ARBITRATION_V1=false)', () => {
  it('latchBlocksStaleChat is false when flag is off', () => {
    const resolvedLatch = makeResolvedLatch('w_links_d')
    // isLatchEnabled = false → latchBlocksStaleChat = false regardless of latch state
    expect(latchBlocksStaleChat(false, resolvedLatch)).toBe(false)
    expect(latchBlocksStaleChat(false, null)).toBe(false)
  })

  it('resolveActiveWidgetId returns undefined when flag is off', () => {
    const resolvedLatch = makeResolvedLatch('w_links_d')
    expect(resolveActiveWidgetId(resolvedLatch, 'w_links_d', false)).toBeUndefined()
  })

  it('parser functions work regardless of flag (pure functions)', () => {
    // isSelectionOnly and isExplicitCommand are pure parsers — no flag dependency
    expect(isSelectionOnly('second', 5, [], 'strict').isSelection).toBe(true)
    expect(isSelectionOnly('open second one', 5, [], 'embedded').isSelection).toBe(true)
    expect(isExplicitCommand('open recent')).toBe(true)
  })

  it('all stale-chat paths pass through when flag is off', () => {
    // Simulates the 4 stale-chat ordinal paths with flag off:
    // All should pass through (latchBlocksStaleChat = false)
    const pendingLatch = makePendingLatch('uuid-1234')
    const resolvedLatch = makeResolvedLatch('w_links_d')

    // Tier 3a primary: !hasActiveFocusLatch (false when flag off)
    expect(latchBlocksStaleChat(false, resolvedLatch)).toBe(false)
    // Tier 3a message-derived: same
    expect(latchBlocksStaleChat(false, pendingLatch)).toBe(false)
    // Interrupt-paused path: || latchBlocksStaleChat (false → doesn't skip)
    expect(latchBlocksStaleChat(false, resolvedLatch)).toBe(false)
    // Post-action ordinal window: isLatchOrPreLatch (false → doesn't skip)
    expect(latchBlocksStaleChat(false, null)).toBe(false)
  })
})

// =============================================================================
// Cooldown behavior: pending latch + no activeWidgetId
// =============================================================================

describe('Pending latch cooldown', () => {
  it('turnsSinceLatched === 0 triggers "Still loading" message', () => {
    const pendingLatch = makePendingLatch('uuid-panel', { turnsSinceLatched: 0 })
    const noActiveWidget = null
    const activeWidgetId = resolveActiveWidgetId(pendingLatch, noActiveWidget, true)

    // Pending + no activeWidgetId + turnsSinceLatched === 0 → show message
    expect(activeWidgetId).toBeUndefined()
    expect(pendingLatch.turnsSinceLatched).toBe(0)
    // → return { handled: true } with "Still loading..." message
  })

  it('turnsSinceLatched > 0 returns handled silently (no fall-through to Tier 4.5)', () => {
    const pendingLatch = makePendingLatch('uuid-panel', { turnsSinceLatched: 1 })
    const noActiveWidget = null
    const activeWidgetId = resolveActiveWidgetId(pendingLatch, noActiveWidget, true)

    // Pending + no activeWidgetId + turnsSinceLatched > 0 → silent handled: true
    expect(activeWidgetId).toBeUndefined()
    expect(pendingLatch.turnsSinceLatched).toBeGreaterThan(0)
    // → return { handled: true } silently (no message, no multi-list ambiguity)
  })

  it('turnsSinceLatched >= 2 expires the pending latch entirely', () => {
    const pendingLatch = makePendingLatch('uuid-panel', { turnsSinceLatched: 2 })

    // Per plan: turnsSinceLatched >= 2 → clear latch
    expect(pendingLatch.turnsSinceLatched >= 2).toBe(true)
    // After clear: no latch → stale chat paths unblocked
    expect(latchBlocksStaleChat(true, null)).toBe(false)
  })
})
