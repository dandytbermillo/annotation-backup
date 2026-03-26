/**
 * Surface Command Lookup — Phase E
 *
 * Dedicated server-side endpoint for surface manifest seed retrieval.
 * Independent of Phase 5 hint retrieval — no detectHintScope() dependency.
 *
 * Searches chat_routing_memory_index for curated surface_manifest seeds
 * by semantic similarity. Returns top candidates for the client-side
 * surface resolver to validate and execute.
 */

import { NextRequest, NextResponse } from 'next/server'
import { serverPool } from '@/lib/db/pool'
import { normalizeForStorage, computeQueryFingerprint } from '@/lib/chat/routing-log/normalization'
import { computeEmbedding } from '@/lib/chat/routing-log/embedding-service'
import {
  OPTION_A_TENANT_ID,
  ROUTING_MEMORY_CURATED_SEED_USER_ID,
  MEMORY_SCHEMA_VERSION,
  MEMORY_TOOL_VERSION,
} from '@/lib/chat/routing-log/types'

const LOOKUP_SQL = `
  SELECT
    intent_id,
    intent_class,
    slots_json,
    1 - (semantic_embedding <=> $3::vector) as similarity_score
  FROM chat_routing_memory_index
  WHERE tenant_id = $1
    AND user_id = $2
    AND scope_source = 'curated_seed'
    AND intent_id LIKE 'surface_manifest:%'
    AND is_deleted = false
    AND semantic_embedding IS NOT NULL
    AND schema_version = $4
    AND tool_version = $5
  ORDER BY semantic_embedding <=> $3::vector
  LIMIT 3
`

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const rawQueryText = body.raw_query_text as string

    if (!rawQueryText?.trim()) {
      return NextResponse.json({ candidates: [] })
    }

    // Normalize and embed
    const normalizedText = normalizeForStorage(rawQueryText)
    const embedding = await computeEmbedding(normalizedText, computeQueryFingerprint(normalizedText))

    if (!embedding) {
      return NextResponse.json({ candidates: [] })
    }

    // Query surface manifest seeds only
    const embeddingStr = `[${embedding.join(',')}]`
    const { rows } = await serverPool.query(LOOKUP_SQL, [
      OPTION_A_TENANT_ID,
      ROUTING_MEMORY_CURATED_SEED_USER_ID,
      embeddingStr,
      MEMORY_SCHEMA_VERSION,
      MEMORY_TOOL_VERSION,
    ])

    const candidates = rows.map(row => ({
      intent_id: row.intent_id as string,
      intent_class: row.intent_class as string,
      slots_json: row.slots_json as Record<string, unknown>,
      similarity_score: parseFloat(row.similarity_score),
      from_curated_seed: true,
    }))

    return NextResponse.json({ candidates })
  } catch (error) {
    console.error('[surface-command/lookup] Error:', error)
    return NextResponse.json({ candidates: [] })
  }
}
