/**
 * Surface Command Resolver — Phase E
 *
 * Dedicated pre-LLM resolver for built-in non-note surfaces.
 * Uses DB-backed seeded queries + manifest validation + live context checks.
 * Independent of Phase 5 hint retrieval pipeline.
 *
 * This module does NOT:
 * - Use regex phrase detection
 * - Depend on detectHintScope()
 * - Piggyback on Phase 5 hint retrieval
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

interface SurfaceSeedCandidate {
  intent_id: string
  intent_class: string
  slots_json: Record<string, unknown>
  similarity_score: number
  from_curated_seed: boolean
}

interface SurfaceResolverError {
  matchedStrongly: true
  validationError: string
}

export type SurfaceResolverResult = ResolvedSurfaceCommand | SurfaceResolverError | null

// =============================================================================
// Constants
// =============================================================================

const SIMILARITY_FLOOR = 0.88
const NEAR_TIE_MARGIN = 0.03
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
// Resolver
// =============================================================================

/**
 * Resolve a surface command from seeded query rows.
 *
 * Returns:
 * - ResolvedSurfaceCommand on validated high-confidence match
 * - { matchedStrongly: true, validationError } on strong match with validation failure
 * - null on weak/no match (normal routing continues)
 */
export async function resolveSurfaceCommand(
  input: string,
  runtimeContext: SurfaceRuntimeContext,
): Promise<SurfaceResolverResult> {
  // 1. Retrieve seeded candidates
  const candidates = await lookupSurfaceSeeds(input)
  if (candidates.length === 0) return null

  const top = candidates[0]

  // 2. Gate: similarity floor
  if (top.similarity_score < SIMILARITY_FLOOR) return null

  // 3. Gate: near-tie
  if (candidates[1] && (top.similarity_score - candidates[1].similarity_score) < NEAR_TIE_MARGIN) return null

  // 4. Gate: curated seed only
  if (!top.from_curated_seed) return null

  // 5. Gate: action type discriminant
  if (top.slots_json.action_type !== 'surface_manifest_execute') return null

  // --- Strong match: this branch now owns the turn ---

  const manifest = top.slots_json.surface_manifest as Record<string, string> | undefined
  const validation = top.slots_json.validation as Record<string, boolean> | undefined

  if (!manifest) {
    return { matchedStrongly: true, validationError: 'Seed missing surface_manifest metadata' }
  }

  // 6. Validate container match
  if (validation?.requiresContainerMatch) {
    if (runtimeContext.containerType !== manifest.containerType) {
      return { matchedStrongly: true, validationError: `Container mismatch: expected ${manifest.containerType}, got ${runtimeContext.containerType}` }
    }
  }

  // 7. Validate visible surface
  if (validation?.requiresVisibleSurface) {
    const visible = runtimeContext.visibleSurfaceTypes.some(
      t => t === manifest.surfaceType
    )
    if (!visible) {
      return { matchedStrongly: true, validationError: `Surface '${manifest.surfaceType}' not visible` }
    }
  }

  // 8. Validate against live manifest
  registerBuiltInSurfaceManifests() // idempotent
  const entry = findSurfaceEntry(manifest.surfaceType, manifest.containerType as SurfaceContainerType)
  if (!entry) {
    return { matchedStrongly: true, validationError: `No manifest entry for ${manifest.surfaceType}/${manifest.containerType}` }
  }
  if (entry.handlerId !== manifest.handlerId) {
    return { matchedStrongly: true, validationError: `Handler mismatch: manifest=${entry.handlerId}, seed=${manifest.handlerId}` }
  }
  const cmd = findSurfaceCommand(manifest.surfaceType, manifest.containerType as SurfaceContainerType, manifest.intentFamily, manifest.intentSubtype)
  if (!cmd) {
    return { matchedStrongly: true, validationError: `No command for ${manifest.intentFamily}.${manifest.intentSubtype}` }
  }
  if (cmd.executionPolicy !== manifest.executionPolicy) {
    return { matchedStrongly: true, validationError: `Policy mismatch: manifest=${cmd.executionPolicy}, seed=${manifest.executionPolicy}` }
  }

  // 9. Build resolved command
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

// =============================================================================
// Type guard
// =============================================================================

export function isSurfaceResolverError(result: SurfaceResolverResult): result is SurfaceResolverError {
  return result !== null && 'matchedStrongly' in result
}
