/**
 * Routing Log — Client-Side Barrel Export
 *
 * Phase 1: Durable log integration (observe-only).
 * Phase 2a: Memory write (deferred to sendMessage after confirmed execution).
 * Phase 2b: Memory read + validate + execute (exact-match memory assist).
 *
 * Server-only modules (normalization with crypto, redaction) are imported
 * directly by the API route — NOT re-exported here to avoid pulling Node.js
 * crypto into client bundles.
 */

// Phase 1: Client-safe exports
export { recordRoutingLog } from './writer'
export { tierToLane, provenanceToDecisionSource, deriveResultStatus, deriveRiskTier } from './mapping'
export { buildContextSnapshot, canonicalJsonSerialize, stripVolatileFields } from './context-snapshot'
export type { DurableLogRow, RoutingLane, DecisionSource, RiskTier, ResultStatus } from './types'
export type { ContextSnapshotV1, SnapshotInputs } from './context-snapshot'
export { deriveFallbackInteractionId, simpleStringHash } from './ids'
export type { RoutingLogPayload } from './payload'

// Phase 2a: Memory write (client-safe)
export { buildMemoryWritePayload, buildNoteManifestWritePayload } from './memory-write-payload'
export { recordMemoryEntry } from './memory-writer'
export type { MemoryWritePayload } from './memory-write-payload'

// Bug #3: Execution outcome logging (client-safe)
export { fireOutcomeLog, fireFailedOutcomeLog } from './outcome-logger'

// Phase 2b: Memory read + validate + execute (client-safe)
export { lookupExactMemory } from './memory-reader'
export type { MemoryLookupResult } from './memory-reader'
export { validateMemoryCandidate, revalidateMemoryHit } from './memory-validator'
export type { ValidationResult } from './memory-validator'
export { buildResultFromMemory } from './memory-action-builder'

// Phase 3: Semantic memory read (client-safe)
export { lookupSemanticMemory } from './memory-semantic-reader'
export type { SemanticCandidate } from './memory-semantic-reader'
