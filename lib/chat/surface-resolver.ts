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
  sourceKind: 'curated_seed' | 'learned_success'
  selectorSpecific: boolean
  instanceLabel?: string
  arguments: Record<string, unknown>
  validationSnapshot?: {
    requiresVisibleSurface: boolean
    requiresContainerMatch: boolean
    manifestMatched: boolean
    commandMatched: boolean
  }
}

export type SurfaceResolverResult =
  | ResolvedSurfaceCommand
  | SurfaceCandidateHint
  | SurfaceResolverError
  | null

// =============================================================================
// Constants
// =============================================================================

const HIGH_CONFIDENCE_FLOOR = 0.88
const MEDIUM_CONFIDENCE_FLOOR = 0.78
const NEAR_TIE_MARGIN = 0.03
const CURATED_SEED_BIAS = 0.02  // boost curated seeds over learned rows
const LOOKUP_TIMEOUT_MS = 1500
const LOOKUP_ENDPOINT = '/api/chat/surface-command/lookup'

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

      // Curated-seed bias
      if (c.from_curated_seed || c.source_kind === 'curated_seed') {
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
  // 1. Retrieve candidates
  const rawCandidates = await lookupSurfaceSeeds(input)
  if (rawCandidates.length === 0) return null

  // 2. Rerank with live context signals + curated-seed bias
  const candidates = rerankCandidates(rawCandidates, runtimeContext)
  const top = candidates[0]

  // 3. Gate: minimum medium floor
  if (top.similarity_score < MEDIUM_CONFIDENCE_FLOOR) return null

  // 4. Gate: action type discriminant
  if (top.slots_json.action_type !== 'surface_manifest_execute') return null

  // 5. Gate: near-tie (for high-confidence execution only)
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

  if (isHighConfidence) {
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
  return result !== null && 'executionPolicy' in result && !('matchedStrongly' in result) && !('candidateConfidence' in result)
}
