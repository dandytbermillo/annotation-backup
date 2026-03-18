/**
 * Pending Phase 5 Write — Types and Helpers
 *
 * Phase 5 exemplar writes use one-turn delayed promotion:
 * - Successful turn → pending write created (not immediately written)
 * - Next turn non-correction → promoted (written to memory index)
 * - Next turn correction ("no", "wrong", "not that") → dropped
 * - Session end/reload → dropped (not persisted)
 */

import type { MemoryWritePayload } from './memory-write-payload'

export interface PendingPhase5Write {
  payload: MemoryWritePayload
  turnTimestamp: number
  fromClarifiedSuccess: boolean
  fromCuratedSeedAssisted: boolean
}
