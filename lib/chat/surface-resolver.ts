/**
 * Surface Command Resolver — Phase E (3-Band)
 *
 * Dedicated pre-LLM resolver for built-in non-note surfaces.
 * Uses DB-backed seeded queries + manifest validation + live context checks.
 * Independent of Phase 5 hint retrieval pipeline.
 *
 * 3 outcomes:
 * - High confidence (≥0.88): deterministic execution, owns the turn
 * - Medium confidence (≥0.78): structured hint to arbiter/LLM
 * - Low/no match: null, normal routing continues
 */

import {
  findSurfaceEntry,
  findSurfaceCommand,
  type ResolvedSurfaceCommand,
  type SurfaceRuntimeContext,
  type SurfaceContainerType,
} from './surface-manifest'
import { registerBuiltInSurfaceManifests } from './surface-manifest-definitions'

// =============================================================================
// Types
// =============================================================================

export interface SurfaceSeedCandidate {
  intent_id: string
  intent_class: string
  slots_json: Record<string, unknown>
  similarity_score: number
  from_curated_seed: boolean
  source_kind?: 'curated_seed' | 'learned_success'
}

export interface SurfaceResolverError {
  matchedStrongly: true
  validationError: string
}

export interface SurfaceCandidateHint {
  surfaceType: string
  containerType: SurfaceContainerType
  intentFamily: string
  intentSubtype: string
  candidateConfidence: 'medium'
  similarityScore: number
  visibleSurfaceMatch: boolean
  containerMatch: boolean
  sourceKind: 'curated_seed' | 'learned_success' | 'manifest_fallback'
  selectorSpecific: boolean
  instanceLabel?: string
  arguments: Record<string, unknown>
  /** How the winning candidate was retrieved (provenance for durable logs) */
  retrievalSource?: 'raw_query' | 'llm_rewrite' | 'agreement'
  validationSnapshot?: {
    requiresVisibleSurface: boolean
    requiresContainerMatch: boolean
    manifestMatched: boolean
    commandMatched: boolean
  }
}

export interface SurfaceClarificationSet {
  candidates: SurfaceCandidateHint[]
  reason: 'arbitration_declined' | 'arbitration_validation_failed' | 'arbitration_unavailable'
}

export type SurfaceResolverResult =
  | ResolvedSurfaceCommand
  | SurfaceCandidateHint
  | SurfaceClarificationSet
  | SurfaceResolverError
  | null

// =============================================================================
// Constants
// =============================================================================

const HIGH_CONFIDENCE_FLOOR = 0.88
const MEDIUM_CONFIDENCE_FLOOR = 0.78
const NEAR_TIE_MARGIN = 0.03
const CURATED_SEED_BIAS = 0.02  // boost curated seeds over learned rows
const AGREEMENT_BOOST = 0.03    // boost candidates found by both raw + rewrite
const LOOKUP_TIMEOUT_MS = 1500
const REWRITE_TIMEOUT_MS = 1500
const ARBITRATION_TIMEOUT_MS = 2000
const LOOKUP_ENDPOINT = '/api/chat/surface-command/lookup'
const REWRITE_ENDPOINT = '/api/chat/surface-command/rewrite'
const ARBITRATE_ENDPOINT = '/api/chat/surface-command/arbitrate'

// =============================================================================
// Query Normalization (retrieval aid only — not a phrase parser)
// =============================================================================

function normalizeSurfaceQuery(input: string): string {
  let q = input.trim().toLowerCase()
  // Strip low-information words + greetings — preserve single-letter tokens (instance labels)
  // Greeting stripping is a small optional retrieval helper, not the main mechanism.
  q = q.replace(/\b(my|the|please|can you|could you|hi|hello|hey|good morning|good afternoon|hi there|hey there)\b/gi, ' ')
  // NOTE: vocabulary normalization (widget→panel, entries→entry) removed.
  // It created an embedding mismatch: query was normalized but seeds were
  // embedded with original text via normalizeForStorage. Embeddings handle
  // semantic similarity between widget/panel and entries/entry natively.
  // Collapse whitespace
  q = q.replace(/\s+/g, ' ').trim()
  return q
}

// =============================================================================
// Levenshtein Distance (inline — no external dependency)
// =============================================================================

function levenshteinDistance(a: string, b: string): number {
  const m = a.length
  const n = b.length
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0))
  for (let i = 0; i <= m; i++) dp[i][0] = i
  for (let j = 0; j <= n; j++) dp[0][j] = j
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1])
    }
  }
  return dp[m][n]
}

function hasNearMatchToken(tokens: string[], target: string, maxDistance: number): boolean {
  return tokens.some(t => levenshteinDistance(t, target) <= maxDistance)
}

// =============================================================================
// Recent-Family Evidence Gate
// =============================================================================

/** Content verb + object noun shape for list/display queries */
const CONTENT_LIST_SHAPE = /\b(list|show|display|view|get|what|which)\b.*\b(entry|entries|item|items|panel|thing|stuff)\b/i

function hasRecentFamilyEvidence(
  normalizedInput: string,
  rawCandidates: SurfaceSeedCandidate[],
  runtimeContext: SurfaceRuntimeContext,
): boolean {
  // 1. Literal "recent" in normalized query
  if (normalizedInput.includes('recent')) return true

  // 2. Weak candidates pointing to recent surface
  const hasRecentCandidate = rawCandidates.some(c => {
    const manifest = c.slots_json.surface_manifest as Record<string, string> | undefined
    return manifest?.surfaceType === 'recent'
  })
  if (hasRecentCandidate) return true

  // 3. Typo-tolerant near-match to "recent" (Levenshtein ≤ 2 on any token)
  const tokens = normalizedInput.split(/\s+/)
  if (hasNearMatchToken(tokens, 'recent', 2)) return true

  // 4. Visible recent surface + content/list shape
  const hasVisibleRecent = runtimeContext.visibleSurfaceTypes.includes('recent')
  if (hasVisibleRecent && CONTENT_LIST_SHAPE.test(normalizedInput)) return true

  return false
}

// =============================================================================
// Rewrite-Assisted Retrieval Recovery
// =============================================================================

async function rewriteForRetrieval(input: string): Promise<string | null> {
  if (process.env.NEXT_PUBLIC_SURFACE_COMMAND_RESOLVER_ENABLED !== 'true') {
    return null
  }

  let timer: ReturnType<typeof setTimeout> | undefined

  try {
    const result = await Promise.race([
      fetch(REWRITE_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ raw_query_text: input }),
      }).then(async (res) => {
        clearTimeout(timer)
        if (!res.ok) return null
        const data = await res.json()
        return (data.rewritten_text as string) ?? null
      }),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), REWRITE_TIMEOUT_MS)
      }),
    ])

    return result
  } catch {
    clearTimeout(timer)
    return null
  }
}

// =============================================================================
// Bounded Candidate Arbitration (LLM selection over validated candidates)
// =============================================================================

async function arbitrateSurfaceCandidates(
  userQuery: string,
  candidates: SurfaceCandidateHint[],
): Promise<number | null> {
  if (process.env.NEXT_PUBLIC_SURFACE_COMMAND_RESOLVER_ENABLED !== 'true') {
    return null
  }
  if (candidates.length === 0) return null

  registerBuiltInSurfaceManifests()
  const requestCandidates = candidates.map((c, i) => {
    // Resolve actual execution policy from manifest for meaningful arbitration metadata
    const cmd = findSurfaceCommand(c.surfaceType, c.containerType, c.intentFamily, c.intentSubtype)
    const policy = cmd?.executionPolicy ?? 'unknown'
    // Map to human-readable intent shape for the LLM prompt
    const policyLabel = policy === 'list_items' ? 'chat-answer/list'
      : policy === 'open_surface' ? 'drawer/display'
      : policy === 'execute_item' ? 'execute-item'
      : policy
    return {
      index: i + 1,
      surface_type: c.surfaceType,
      intent_family: c.intentFamily,
      intent_subtype: c.intentSubtype,
      execution_policy: policyLabel,
      similarity_score: c.similarityScore,
      source_kind: c.sourceKind,
    }
  })

  let timer: ReturnType<typeof setTimeout> | undefined

  try {
    const result = await Promise.race([
      fetch(ARBITRATE_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_query: userQuery, candidates: requestCandidates }),
      }).then(async (res) => {
        clearTimeout(timer)
        if (!res.ok) return null
        const data = await res.json()
        return (data.selected_index as number | null) ?? null
      }),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), ARBITRATION_TIMEOUT_MS)
      }),
    ])

    return result
  } catch {
    clearTimeout(timer)
    return null
  }
}

// =============================================================================
// Candidate Merge (raw + rewrite with provenance)
// =============================================================================

interface TaggedCandidate extends SurfaceSeedCandidate {
  _source: 'raw_query' | 'llm_rewrite' | 'agreement'
}

function mergeCandidates(
  rawCandidates: SurfaceSeedCandidate[],
  rewrittenCandidates: SurfaceSeedCandidate[],
): TaggedCandidate[] {
  const merged = new Map<string, TaggedCandidate>()

  // Add raw candidates
  for (const c of rawCandidates) {
    merged.set(c.intent_id, { ...c, _source: 'raw_query' })
  }

  // Add rewritten candidates — if overlap, mark as agreement + boost
  for (const c of rewrittenCandidates) {
    const existing = merged.get(c.intent_id)
    if (existing) {
      // Agreement: keep higher score + agreement boost
      existing._source = 'agreement'
      existing.similarity_score = Math.max(existing.similarity_score, c.similarity_score) + AGREEMENT_BOOST
    } else {
      merged.set(c.intent_id, { ...c, _source: 'llm_rewrite' })
    }
  }

  return Array.from(merged.values())
}

// =============================================================================
// Manifest-Derived Fallback Hint (recent-only first slice)
// =============================================================================

function tryManifestFallbackHint(
  normalizedInput: string,
  runtimeContext: SurfaceRuntimeContext,
): SurfaceCandidateHint | null {
  registerBuiltInSurfaceManifests()

  // First slice: only 'recent' singleton surface
  for (const surfaceType of runtimeContext.visibleSurfaceTypes) {
    if (surfaceType !== 'recent') continue
    if (!normalizedInput.includes(surfaceType)) continue

    const entry = findSurfaceEntry(surfaceType, runtimeContext.containerType)
    if (!entry) continue

    const stateCmd = entry.supportedCommands.find(
      c => c.intentFamily === 'state_info' && c.executionPolicy === 'list_items'
    )
    if (!stateCmd) continue

    // Require object-noun overlap (not bare verbs — avoids "show recent" collision)
    const hasContentOverlap = /\b(entry|entries|item|items|list)\b/.test(normalizedInput)
    if (!hasContentOverlap) continue

    return {
      surfaceType,
      containerType: runtimeContext.containerType,
      intentFamily: stateCmd.intentFamily,
      intentSubtype: stateCmd.intentSubtype,
      candidateConfidence: 'medium',
      similarityScore: 0,
      visibleSurfaceMatch: true,
      containerMatch: true,
      sourceKind: 'manifest_fallback',
      selectorSpecific: false,
      arguments: {},
      validationSnapshot: {
        requiresVisibleSurface: true,
        requiresContainerMatch: true,
        manifestMatched: true,
        commandMatched: true,
      },
    }
  }
  return null
}

// =============================================================================
// Seed Retrieval (Client-side)
// =============================================================================

async function lookupSurfaceSeeds(
  rawQueryText: string,
): Promise<SurfaceSeedCandidate[]> {
  if (process.env.NEXT_PUBLIC_SURFACE_COMMAND_RESOLVER_ENABLED !== 'true') {
    return []
  }

  let timer: ReturnType<typeof setTimeout> | undefined

  try {
    const result = await Promise.race([
      fetch(LOOKUP_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ raw_query_text: rawQueryText }),
      }).then(async (res) => {
        clearTimeout(timer)
        if (!res.ok) return []
        const data = await res.json()
        return (data.candidates ?? []) as SurfaceSeedCandidate[]
      }),
      new Promise<SurfaceSeedCandidate[]>((resolve) => {
        timer = setTimeout(() => resolve([]), LOOKUP_TIMEOUT_MS)
      }),
    ])

    return result
  } catch {
    clearTimeout(timer)
    return []
  }
}

// =============================================================================
// Reranking
// =============================================================================

function rerankCandidates(
  candidates: SurfaceSeedCandidate[],
  runtimeContext: SurfaceRuntimeContext,
): SurfaceSeedCandidate[] {
  return candidates
    .map(c => {
      let boostedScore = c.similarity_score
      const manifest = c.slots_json.surface_manifest as Record<string, string> | undefined
      const tagged = c as TaggedCandidate

      // Curated-seed bias — rewrite-only candidates do NOT get this boost
      if ((c.from_curated_seed || c.source_kind === 'curated_seed') && tagged._source !== 'llm_rewrite') {
        boostedScore += CURATED_SEED_BIAS
      }

      // Visible-surface boost
      if (manifest && runtimeContext.visibleSurfaceTypes.includes(manifest.surfaceType)) {
        boostedScore += 0.01
      }

      // Container-match boost
      if (manifest && runtimeContext.containerType === manifest.containerType) {
        boostedScore += 0.01
      }

      return { ...c, similarity_score: boostedScore }
    })
    .sort((a, b) => b.similarity_score - a.similarity_score)
}

// =============================================================================
// Resolver
// =============================================================================

/**
 * Resolve a surface command from seeded query rows.
 *
 * Returns:
 * - ResolvedSurfaceCommand on validated high-confidence match
 * - SurfaceCandidateHint on medium-confidence match (hint to LLM)
 * - SurfaceResolverError on strong match with validation failure
 * - null on weak/no match (normal routing continues)
 */
export async function resolveSurfaceCommand(
  input: string,
  runtimeContext: SurfaceRuntimeContext,
): Promise<SurfaceResolverResult> {
  // 0. Normalize query for retrieval (improves embedding similarity for paraphrases)
  const normalizedInput = normalizeSurfaceQuery(input)

  // 1. Retrieve candidates (using normalized text for better embedding match)
  const rawCandidates = await lookupSurfaceSeeds(normalizedInput)

  // 2. Try to resolve from raw candidates first
  const rawResult = evaluateCandidates(rawCandidates, runtimeContext)
  if (rawResult !== null && !isSurfaceCandidateHint(rawResult)) return rawResult

  // 3. Raw retrieval was weak/empty — check manifest fallback (only if no medium hit)
  if (rawResult === null) {
    const manifestHint = tryManifestFallbackHint(normalizedInput, runtimeContext)
    if (manifestHint !== null) {
      // Manifest fallback is always medium — collect for potential arbitration
      return tryArbitrationOrReturn(input, [manifestHint], runtimeContext, 'arbitration_unavailable')
    }
  }

  // 4. Rewrite-assisted retrieval recovery
  //    Gate: recent-family evidence required for this slice
  let mergedResult: SurfaceResolverResult = rawResult
  if (rawResult === null && hasRecentFamilyEvidence(normalizedInput, rawCandidates, runtimeContext)) {
    const rewrittenQuery = await rewriteForRetrieval(normalizedInput)
    if (rewrittenQuery && rewrittenQuery.toLowerCase() !== normalizedInput) {
      const rewrittenCandidates = await lookupSurfaceSeeds(rewrittenQuery)
      if (rewrittenCandidates.length > 0 || rawCandidates.length > 0) {
        const merged = mergeCandidates(rawCandidates, rewrittenCandidates)
        mergedResult = evaluateCandidates(merged, runtimeContext)
      }
    }
  }

  // 5. If we have a high/error result from merge, return directly
  if (mergedResult !== null && !isSurfaceCandidateHint(mergedResult)) return mergedResult

  // 6. Medium hint(s) available — try bounded candidate arbitration
  const mediumHint = mergedResult !== null && isSurfaceCandidateHint(mergedResult) ? mergedResult : null
  if (mediumHint) {
    // Collect medium candidates: the top hint, plus rawResult if it was also medium and different
    const candidates: SurfaceCandidateHint[] = [mediumHint]
    if (rawResult && isSurfaceCandidateHint(rawResult) && rawResult !== mediumHint) {
      // Different medium candidate from raw vs merged — both go to arbitration
      if (rawResult.intentSubtype !== mediumHint.intentSubtype) {
        candidates.push(rawResult)
      }
    }
    return tryArbitrationOrReturn(input, candidates, runtimeContext, 'arbitration_declined')
  }

  return null
}

// =============================================================================
// Arbitration-Mediated Resolution
// =============================================================================

async function tryArbitrationOrReturn(
  rawInput: string,
  candidates: SurfaceCandidateHint[],
  runtimeContext: SurfaceRuntimeContext,
  fallbackReason: SurfaceClarificationSet['reason'],
): Promise<SurfaceResolverResult> {
  // Try bounded arbitration
  const selectedIndex = await arbitrateSurfaceCandidates(rawInput, candidates)

  if (selectedIndex !== null && selectedIndex >= 1 && selectedIndex <= candidates.length) {
    const chosen = candidates[selectedIndex - 1]

    // Validate the chosen candidate against manifest/runtime
    registerBuiltInSurfaceManifests()
    const entry = findSurfaceEntry(chosen.surfaceType, chosen.containerType)
    const cmd = entry ? findSurfaceCommand(
      chosen.surfaceType, chosen.containerType, chosen.intentFamily, chosen.intentSubtype
    ) : undefined

    if (entry && cmd) {
      // Check runtime context
      const visibleMatch = runtimeContext.visibleSurfaceTypes.includes(chosen.surfaceType)
      if (chosen.validationSnapshot?.requiresVisibleSurface && !visibleMatch) {
        // Validation failed — try next candidate or clarify
        return fallbackAfterValidationFailure(candidates, selectedIndex - 1, runtimeContext, fallbackReason)
      }

      const targetSurface = runtimeContext.visibleSurfaceIds[
        runtimeContext.visibleSurfaceTypes.indexOf(chosen.surfaceType)
      ]

      return {
        surfaceType: chosen.surfaceType,
        containerType: chosen.containerType,
        manifestVersion: entry.manifestVersion,
        intentFamily: chosen.intentFamily,
        intentSubtype: chosen.intentSubtype,
        targetSurfaceId: targetSurface,
        selectorSpecific: chosen.selectorSpecific,
        arguments: chosen.arguments,
        confidence: 'high', // arbitration-mediated
        executionPolicy: cmd.executionPolicy,
        replayPolicy: cmd.replayPolicy,
        clarificationPolicy: cmd.clarificationPolicy,
        handlerId: entry.handlerId,
        retrievalSource: 'agreement' as const, // arbitration-mediated provenance
      }
    }

    // Manifest validation failed
    return fallbackAfterValidationFailure(candidates, selectedIndex - 1, runtimeContext, 'arbitration_validation_failed')
  }

  // Arbitration declined or unavailable — preserve candidates for downstream
  if (candidates.length === 1) {
    return candidates[0] // single hint for arbiter path
  }
  return { candidates, reason: fallbackReason }
}

function fallbackAfterValidationFailure(
  candidates: SurfaceCandidateHint[],
  failedIndex: number,
  _runtimeContext: SurfaceRuntimeContext,
  reason: SurfaceClarificationSet['reason'],
): SurfaceResolverResult {
  // Remove the failed candidate, try remaining
  const remaining = candidates.filter((_, i) => i !== failedIndex)
  if (remaining.length === 0) {
    // All candidates failed validation — return original set for clarification
    // rather than bare null (preserves bounded candidate scope per design doc)
    return { candidates, reason: 'arbitration_validation_failed' }
  }
  if (remaining.length === 1) return remaining[0]
  return { candidates: remaining, reason }
}

// =============================================================================
// Candidate Evaluation (shared by raw and merged paths)
// =============================================================================

function evaluateCandidates(
  rawCandidates: SurfaceSeedCandidate[],
  runtimeContext: SurfaceRuntimeContext,
): SurfaceResolverResult {
  if (rawCandidates.length === 0) return null

  // Rerank with live context signals + curated-seed bias
  const candidates = rerankCandidates(rawCandidates, runtimeContext)
  const top = candidates[0]

  // Gate: minimum medium floor
  if (top.similarity_score < MEDIUM_CONFIDENCE_FLOOR) return null

  // Gate: action type discriminant
  if (top.slots_json.action_type !== 'surface_manifest_execute') return null

  // Gate: near-tie (for high-confidence execution only)
  const hasNearTie = candidates[1] && (top.similarity_score - candidates[1].similarity_score) < NEAR_TIE_MARGIN

  // Extract metadata
  const manifest = top.slots_json.surface_manifest as Record<string, string> | undefined
  const validation = top.slots_json.validation as Record<string, boolean> | undefined

  if (!manifest) return null

  // Compute context checks
  const containerMatch = runtimeContext.containerType === manifest.containerType
  const visibleSurfaceMatch = runtimeContext.visibleSurfaceTypes.some(t => t === manifest.surfaceType)

  // Check manifest
  registerBuiltInSurfaceManifests() // idempotent
  const entry = findSurfaceEntry(manifest.surfaceType, manifest.containerType as SurfaceContainerType)
  const cmd = entry ? findSurfaceCommand(manifest.surfaceType, manifest.containerType as SurfaceContainerType, manifest.intentFamily, manifest.intentSubtype) : undefined
  const manifestMatched = !!entry && entry.handlerId === manifest.handlerId
  const commandMatched = !!cmd && cmd.executionPolicy === manifest.executionPolicy

  const sourceKind: 'curated_seed' | 'learned_success' =
    top.source_kind ?? (top.from_curated_seed ? 'curated_seed' : 'learned_success')

  // --- Determine confidence band ---

  const isHighConfidence = top.similarity_score >= HIGH_CONFIDENCE_FLOOR && !hasNearTie

  // Safety: rewrite-only candidates cannot reach high-confidence execution
  const tagged = top as TaggedCandidate
  const isRewriteOnly = tagged._source === 'llm_rewrite'
  const effectiveHighConfidence = isHighConfidence && !isRewriteOnly

  // Provenance: how the winning candidate was retrieved
  const retrievalSource = tagged._source as 'raw_query' | 'llm_rewrite' | 'agreement' | undefined

  if (effectiveHighConfidence) {
    // HIGH: validate and execute or error

    // Container validation
    if (validation?.requiresContainerMatch && !containerMatch) {
      return { matchedStrongly: true, validationError: `Container mismatch: expected ${manifest.containerType}, got ${runtimeContext.containerType}` }
    }

    // Visible surface validation
    if (validation?.requiresVisibleSurface && !visibleSurfaceMatch) {
      return { matchedStrongly: true, validationError: `Surface '${manifest.surfaceType}' not visible` }
    }

    // Manifest validation
    if (!entry) {
      return { matchedStrongly: true, validationError: `No manifest entry for ${manifest.surfaceType}/${manifest.containerType}` }
    }
    if (!manifestMatched) {
      return { matchedStrongly: true, validationError: `Handler mismatch: manifest=${entry.handlerId}, seed=${manifest.handlerId}` }
    }
    if (!cmd) {
      return { matchedStrongly: true, validationError: `No command for ${manifest.intentFamily}.${manifest.intentSubtype}` }
    }
    if (!commandMatched) {
      return { matchedStrongly: true, validationError: `Policy mismatch: manifest=${cmd.executionPolicy}, seed=${manifest.executionPolicy}` }
    }

    // Build resolved command
    const targetSurface = runtimeContext.visibleSurfaceIds[
      runtimeContext.visibleSurfaceTypes.indexOf(manifest.surfaceType)
    ]

    return {
      surfaceType: manifest.surfaceType,
      containerType: manifest.containerType as SurfaceContainerType,
      manifestVersion: entry.manifestVersion,
      intentFamily: manifest.intentFamily,
      intentSubtype: manifest.intentSubtype,
      targetSurfaceId: targetSurface,
      selectorSpecific: false,
      arguments: (top.slots_json.arguments ?? {}) as Record<string, unknown>,
      confidence: 'high',
      executionPolicy: cmd.executionPolicy,
      replayPolicy: cmd.replayPolicy,
      clarificationPolicy: cmd.clarificationPolicy,
      handlerId: entry.handlerId,
      retrievalSource,
    }
  }

  // MEDIUM: return candidate hint for arbiter/LLM
  return {
    surfaceType: manifest.surfaceType,
    containerType: manifest.containerType as SurfaceContainerType,
    intentFamily: manifest.intentFamily,
    intentSubtype: manifest.intentSubtype,
    candidateConfidence: 'medium',
    similarityScore: top.similarity_score,
    visibleSurfaceMatch,
    containerMatch,
    sourceKind,
    selectorSpecific: false,
    arguments: (top.slots_json.arguments ?? {}) as Record<string, unknown>,
    retrievalSource,
    validationSnapshot: {
      requiresVisibleSurface: !!validation?.requiresVisibleSurface,
      requiresContainerMatch: !!validation?.requiresContainerMatch,
      manifestMatched,
      commandMatched,
    },
  }
}

// =============================================================================
// Type guards
// =============================================================================

export function isSurfaceResolverError(result: SurfaceResolverResult): result is SurfaceResolverError {
  return result !== null && 'matchedStrongly' in result
}

export function isSurfaceCandidateHint(result: SurfaceResolverResult): result is SurfaceCandidateHint {
  return result !== null && 'candidateConfidence' in result
}

export function isResolvedSurfaceCommand(result: SurfaceResolverResult): result is ResolvedSurfaceCommand {
  return result !== null && 'executionPolicy' in result && !('matchedStrongly' in result) && !('candidateConfidence' in result) && !('candidates' in result)
}

export function isSurfaceClarificationSet(result: SurfaceResolverResult): result is SurfaceClarificationSet {
  return result !== null && 'candidates' in result && 'reason' in result
}

/**
 * Quick check: does the input have surface-family evidence?
 * Used by the dispatcher to decide whether the surface resolver should run
 * even when S6 content-intent has already matched.
 */
export function hasSurfaceFamilyEvidence(input: string): boolean {
  const lower = input.toLowerCase()
  // Check for known surface-family terms
  if (/\brecent\b/.test(lower)) return true
  if (/\blinks?\s*panel\b/.test(lower)) return true
  // Content/list shape with surface term
  if (/\b(list|show|display|view)\b/.test(lower) && /\b(entries|entry|items|item|panel|widget)\b/.test(lower)) return true
  return false
}
