/**
 * Memory Lookup Result Type
 *
 * Retained after B1 removal (Slice B3) because SemanticCandidate extends this interface
 * and it's used across the routing log infrastructure.
 *
 * The lookupExactMemory() function has been removed — semantic retrieval replaces B1.
 */

import type { RiskTier } from './types'

export interface MemoryLookupResult {
  intent_id: string
  intent_class: 'action_intent' | 'info_intent'
  slots_json: Record<string, unknown>
  target_ids: string[]
  risk_tier: RiskTier
  success_count: number
  context_fingerprint: string
}
