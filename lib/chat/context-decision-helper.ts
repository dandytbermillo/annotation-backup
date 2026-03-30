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
      destinationConstraint?: 'chat' | 'surface'
    }
  | {
      mode: 'active_surface_followup'
      surfaceId: string
      confidence: 'high' | 'medium'
      destinationConstraint?: 'chat' | 'surface'
    }
  | { mode: 'conflict' }
  | { mode: 'none' }

export interface ContextDecisionInput {
  clarificationOptions?: ClarificationOption[]
  hasPendingOptions: boolean
  activeSurfaceId?: string
  activeSurfaceLabel?: string
  isReferentialInput: boolean  // "read it", "summarize that", etc.
}

// =============================================================================
// Threshold Contract (versioned, shared across all lanes)
// =============================================================================

export const CONTEXT_THRESHOLDS_VERSION = '1.0'

/**
 * Check if the input is referential (refers to a previous turn's target).
 * Used for active-surface follow-up detection.
 */
const REFERENTIAL_PATTERN = /^\s*(read|summarize|explain|describe|show|what('s| is| does))\s+(it|that|this|the content|the text|me the content)\s*[?.!]?\s*$/i

export function isReferentialFollowUp(input: string): boolean {
  return REFERENTIAL_PATTERN.test(input)
}

// =============================================================================
// Main Decision Function
// =============================================================================

/**
 * Resolve which bounded context wins for the current turn.
 *
 * Priority order (per clarification-vs-active-surface-priority-plan.md):
 * 1. Explicit scope cue or explicit specific target
 * 2. Latest active clarification (if input matches an option)
 * 3. Active or just-opened surface (if input is referential)
 * 4. General routing (mode: 'none')
 */
export function resolveContextDecision(
  rawInput: string,
  ctx: ContextDecisionInput,
): ContextDecision {
  const lower = rawInput.toLowerCase().trim()

  // --- Priority 1: Explicit scope cue or explicit specific target ---
  // If user supplies a clearly specific target, let it escape clarification
  const scopeCue = resolveScopeCue(rawInput)
  if (scopeCue && scopeCue.scope !== 'none') {
    return { mode: 'none' } // explicit scope cue → escape to normal routing
  }

  // Explicit specific target (not generic) → escape clarification
  if (!isGenericAmbiguousPanelPhrase(rawInput)) {
    // Input is specific enough (e.g., "open entry navigator c", "open links panel cc")
    // Let it escape clarification and route normally
    return { mode: 'none' }
  }

  // Extract destination constraint (separate from scope)
  const deliveryState = extractDeliveryState(rawInput)
  const destinationConstraint = deliveryState.presentationTarget === 'chat'
    ? 'chat' as const
    : deliveryState.presentationTarget === 'surface'
      ? 'surface' as const
      : undefined

  // --- Priority 2: Latest active clarification ---
  if (ctx.clarificationOptions?.length && ctx.hasPendingOptions) {
    const matches = findMatchingOptions(rawInput, ctx.clarificationOptions)

    if (matches.length === 1) {
      // Unique strong match → clarification selection
      return {
        mode: 'clarification_selection',
        optionId: matches[0].id,
        optionLabel: matches[0].label,
        confidence: 'high',
        destinationConstraint,
      }
    }

    if (matches.length > 1) {
      // Multiple matches → ambiguous, re-show clarification
      return { mode: 'conflict' }
    }

    // No match → check if it's a referential follow-up for active surface
  }

  // --- Priority 3: Active or just-opened surface (referential follow-ups) ---
  if (ctx.activeSurfaceId && ctx.isReferentialInput) {
    // If there's also active clarification, check for conflict
    if (ctx.clarificationOptions?.length && ctx.hasPendingOptions) {
      // Both contexts active but clarification didn't match → conflict
      // (active surface wants to claim, but clarification is still live)
      return { mode: 'conflict' }
    }

    return {
      mode: 'active_surface_followup',
      surfaceId: ctx.activeSurfaceId,
      confidence: 'high',
      destinationConstraint,
    }
  }

  // --- Priority 4: No bounded context wins ---
  return { mode: 'none' }
}
