/**
 * Shared Context Decision Helper
 *
 * One shared helper that ALL lanes must consult before clearing clarification
 * state or executing a panel open. Sole owner of:
 * - clarification-state clearing decisions
 * - recoverable-source validation
 * - context-winner selection
 *
 * No lane may clear clarification state before this helper runs.
 *
 * Design doc: clarification-vs-active-surface-priority-plan.md
 * Surface doc: surface-command-resolver-design.md:569-589
 */

import type { ClarificationOption } from './chat-navigation-context'
import { findMatchingOptions } from './chat-routing-clarification-utils'
import { extractDeliveryState, type DeliveryState } from './surface-resolver'
import { resolveScopeCue } from './input-classifiers'
import { isGenericAmbiguousPanelPhrase } from './generic-phrase-guard'

// =============================================================================
// Types
// =============================================================================

export type ContextDecision =
  | {
      mode: 'clarification_selection'
      optionId: string
      optionLabel: string
      confidence: 'high' | 'medium'
      sourceUsed: 'pendingOptions' | 'lastClarification' | 'lastOptionsShown' | 'clarificationSnapshot'
      destinationConstraint?: 'chat' | 'surface'
    }
  | {
      mode: 'active_surface_followup'
      surfaceId: string
      confidence: 'high' | 'medium'
      destinationConstraint?: 'chat' | 'surface'
    }
  | {
      mode: 'conflict'
      clarificationOptions: ClarificationOption[]
    }
  | { mode: 'none' }

/** Recoverable clarification source with lifetime metadata */
export interface RecoverableSource {
  options: ClarificationOption[]
  turnAge: number
  /** Lineage ID for alignment checks (e.g., message ID that created the options) */
  lineageId?: string
  /** Whether the source has been invalidated (e.g., by unrelated command) */
  invalidated?: boolean
}

export interface ContextDecisionInput {
  // --- Clarification sources (in precedence order) ---
  /** Live pending options (always valid, always wins) */
  pendingOptions: ClarificationOption[]
  /** Last clarification state (valid if fresh + aligned to current lineage) */
  lastClarification: RecoverableSource | null
  /** Last options shown in a message (valid if within TTL + same lineage) */
  lastOptionsShown: RecoverableSource | null
  /** Clarification snapshot for recovery (valid if within TTL + same lineage + not invalidated) */
  clarificationSnapshot: RecoverableSource | null
  /** Active option set ID for lineage alignment */
  activeOptionSetId: string | null

  // --- Active-surface sources ---
  activeSurface: {
    focusLatchWidgetId: string | null
    widgetSelectionContextId: string | null
    previousRoutingPanelId: string | null
    suspended: boolean
  }

  // --- Input classification ---
  isReferentialInput: boolean  // "read it", "summarize that", etc.
}

// =============================================================================
// Threshold Contract (versioned, shared across all lanes)
// =============================================================================

export const CONTEXT_THRESHOLDS_VERSION = '1.0'

/** Source lifetime limits (in turns) */
const SOURCE_TTL = {
  lastClarification: 1,      // valid for current turn or 1 turn ago
  lastOptionsShown: 2,       // valid for 2 turns
  clarificationSnapshot: 3,  // valid for 3 turns
} as const

/**
 * Check if the input is referential (refers to a previous turn's target).
 * Used for active-surface follow-up detection.
 */
const REFERENTIAL_PATTERN = /^\s*(read|summarize|explain|describe|show|what('s| is| does))\s+(it|that|this|the content|the text|me the content)\s*[?.!]?\s*$/i

export function isReferentialFollowUp(input: string): boolean {
  return REFERENTIAL_PATTERN.test(input)
}

// =============================================================================
// Source Validation
// =============================================================================

/**
 * Check if a recoverable source is still valid based on its lifetime metadata.
 * This is the sole owner of "is this source still valid?" decisions.
 *
 * Validates: existence, non-empty, turn TTL, invalidation flag, and lineage alignment.
 * Lineage alignment ensures the source belongs to the same clarification cycle as
 * the active option set. Without this, options from an unrelated earlier clarification
 * could be matched against the user's current input.
 */
function isSourceValid(
  source: RecoverableSource | null,
  maxTurnAge: number,
  activeOptionSetId?: string | null,
): boolean {
  if (!source) return false
  if (source.options.length === 0) return false
  if (source.turnAge > maxTurnAge) return false
  if (source.invalidated) return false
  // Lineage check: if activeOptionSetId is set and source has a lineageId,
  // they must align. Skip check if either is missing (backwards-compatible).
  if (activeOptionSetId && source.lineageId && source.lineageId !== activeOptionSetId) {
    return false
  }
  return true
}

// =============================================================================
// Main Decision Function
// =============================================================================

/**
 * Resolve which bounded context wins for the current turn.
 *
 * Priority order (per clarification-vs-active-surface-priority-plan.md):
 * 1. Explicit scope cue or explicit specific target → escape to normal routing
 * 2. Latest active clarification (checked in source precedence order)
 * 3. Active or just-opened surface (if input is referential)
 * 4. General routing (mode: 'none')
 *
 * Source precedence for clarification matching:
 * 1. Live pendingOptions — always valid
 * 2. lastClarification — valid if ≤1 turn + aligned to lineage
 * 3. lastOptionsShown — valid if ≤2 turns + same lineage
 * 4. clarificationSnapshot — valid if ≤3 turns + same lineage + not invalidated
 */
export function resolveContextDecision(
  rawInput: string,
  ctx: ContextDecisionInput,
): ContextDecision {
  // --- Priority 1: Explicit scope cue or explicit specific target ---
  const scopeCue = resolveScopeCue(rawInput)
  if (scopeCue && scopeCue.scope !== 'none') {
    return { mode: 'none' } // explicit scope cue → escape to normal routing
  }

  // Explicit specific target (not generic) → escape clarification
  if (!isGenericAmbiguousPanelPhrase(rawInput)) {
    return { mode: 'none' }
  }

  // Extract destination constraint (separate from target choice)
  const deliveryState = extractDeliveryState(rawInput)
  const destinationConstraint = deliveryState.presentationTarget === 'chat'
    ? 'chat' as const
    : deliveryState.presentationTarget === 'surface'
      ? 'surface' as const
      : undefined

  // --- Priority 2: Latest active clarification (source precedence order) ---
  // Check each recoverable source in order of freshness/reliability.
  //
  // Generic ambiguous phrases (e.g., "open entries") may ONLY match from live pendingOptions.
  // Recoverable sources (lastOptionsShown, snapshot) should not auto-select for generic phrases
  // because the clarification cycle is "spent" once options are consumed — a fresh generic query
  // should start a new clarification cycle, not replay the old one.
  const isGeneric = isGenericAmbiguousPanelPhrase(rawInput)
  type SourceName = 'pendingOptions' | 'lastClarification' | 'lastOptionsShown' | 'clarificationSnapshot'
  const sources: Array<{ name: SourceName; options: ClarificationOption[] }> = []

  // Source 1: Live pendingOptions (always valid, even for generic phrases)
  if (ctx.pendingOptions.length > 0) {
    sources.push({ name: 'pendingOptions', options: ctx.pendingOptions })
  }

  // Sources 2-4: Recoverable sources — only for non-generic/specific follow-ups.
  // Generic phrases must not auto-select from spent/stale sources.
  if (!isGeneric) {
    // Source 2: lastClarification (valid if fresh + aligned to lineage)
    if (isSourceValid(ctx.lastClarification, SOURCE_TTL.lastClarification, ctx.activeOptionSetId)) {
      sources.push({ name: 'lastClarification', options: ctx.lastClarification!.options })
    }

    // Source 3: lastOptionsShown (valid if within TTL + same lineage)
    if (isSourceValid(ctx.lastOptionsShown, SOURCE_TTL.lastOptionsShown, ctx.activeOptionSetId)) {
      sources.push({ name: 'lastOptionsShown', options: ctx.lastOptionsShown!.options })
    }

    // Source 4: clarificationSnapshot (valid if within TTL + not invalidated + aligned)
    if (isSourceValid(ctx.clarificationSnapshot, SOURCE_TTL.clarificationSnapshot, ctx.activeOptionSetId)) {
      sources.push({ name: 'clarificationSnapshot', options: ctx.clarificationSnapshot!.options })
    }
  }

  // Try matching against each source in precedence order
  for (const source of sources) {
    const matches = findMatchingOptions(rawInput, source.options)

    if (matches.length === 1) {
      return {
        mode: 'clarification_selection',
        optionId: matches[0].id,
        optionLabel: matches[0].label,
        confidence: 'high',
        sourceUsed: source.name,
        destinationConstraint,
      }
    }

    if (matches.length > 1) {
      // Multiple matches in this source → ambiguous, re-show clarification
      return { mode: 'conflict', clarificationOptions: source.options }
    }

    // No match in this source → try next source
  }

  // Collect all available clarification options for conflict detection
  const allClarificationOptions = sources.length > 0 ? sources[0].options : []

  // --- Priority 3: Active or just-opened surface (referential follow-ups) ---
  const activeSurfaceId = !ctx.activeSurface.suspended
    ? (ctx.activeSurface.focusLatchWidgetId
      ?? ctx.activeSurface.widgetSelectionContextId
      ?? ctx.activeSurface.previousRoutingPanelId)
    : null

  if (activeSurfaceId && ctx.isReferentialInput) {
    // If there are also valid clarification options, that's a conflict
    if (allClarificationOptions.length > 0) {
      return { mode: 'conflict', clarificationOptions: allClarificationOptions }
    }

    return {
      mode: 'active_surface_followup',
      surfaceId: activeSurfaceId,
      confidence: 'high',
      destinationConstraint,
    }
  }

  // --- Priority 4: No bounded context wins ---
  return { mode: 'none' }
}
