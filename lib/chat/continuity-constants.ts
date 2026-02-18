/**
 * Plan 19 Runtime Constants — single-authority reference.
 * See: orchestrator/grounding-continuity-anti-reclarify-plan.md §Runtime Constants Table
 *
 * All consumers (chat-routing.ts, routing-dispatcher.ts, chat-navigation-context.tsx,
 * tests) import from this file. Never inline these numeric literals elsewhere.
 */
export const PLAN19_CONSTANTS = {
  RECENT_ACTION_TRACE_MAX_ENTRIES: 5,       // Plan 19 line 150
  MAX_ACCEPTED_WINDOW: 5,
  MAX_REJECTED_WINDOW: 5,
  SELECTION_MAX_ENRICHMENT_STEPS: 1,        // Plan 19 line 140
  SELECTION_MAX_LLM_CALLS: 2,              // Plan 19 line 141 (retry requires fingerprint change)
  NEEDED_EVIDENCE_TYPES_MAX: 2,            // Plan 19 line 151
} as const

/** Convenience aliases for direct destructuring */
export const MAX_ACTION_TRACE = PLAN19_CONSTANTS.RECENT_ACTION_TRACE_MAX_ENTRIES
export const MAX_ACCEPTED_WINDOW = PLAN19_CONSTANTS.MAX_ACCEPTED_WINDOW
export const MAX_REJECTED_WINDOW = PLAN19_CONSTANTS.MAX_REJECTED_WINDOW
