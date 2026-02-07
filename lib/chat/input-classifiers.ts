/**
 * Input Classifiers (shared utility)
 *
 * Extracted from routing-dispatcher.ts to avoid circular dependency
 * when chat-routing.ts needs these classifiers.
 *
 * Per selection-intent-arbitration-incubation-plan.md Phase 3b:
 * isExplicitCommand must be importable by chat-routing.ts for
 * command/question guards on latch bypass.
 */

// =============================================================================
// Explicit Command Detection
// =============================================================================

/**
 * Check if input is an explicit command (has action verb).
 * Used by Tier 2 to clear pending options before executing new commands.
 * Used by focus-latch bypass to prevent selection binding on commands (Rule 4).
 */
export function isExplicitCommand(input: string): boolean {
  const normalized = input.toLowerCase()

  // Phase 2b: Ordinal/number language bypass
  const hasOrdinal = /\b(first|second|third|fourth|fifth|last|[1-9])\b/i.test(normalized)
  if (hasOrdinal) {
    return false
  }

  // Action verbs that indicate a new command
  const actionVerbs = [
    'open', 'show', 'list', 'view', 'go', 'back', 'home',
    'create', 'rename', 'delete', 'remove',
  ]

  return actionVerbs.some(verb => normalized.includes(verb))
}
