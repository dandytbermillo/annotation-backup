import { NextRequest, NextResponse } from 'next/server'
import { serverPool } from '@/lib/db/pool'
import { normalizeForStorage, computeQueryFingerprint, sha256Hex } from '@/lib/chat/routing-log/normalization'
import { canonicalJsonSerialize, stripVolatileFields, stripVolatileFieldsForNavigation } from '@/lib/chat/routing-log/context-snapshot'
import {
  OPTION_A_TENANT_ID,
  OPTION_A_USER_ID,
  MEMORY_SCHEMA_VERSION,
  MEMORY_TOOL_VERSION,
} from '@/lib/chat/routing-log/types'
import type { ContextSnapshotV1 } from '@/lib/chat/routing-log/context-snapshot'

const LOOKUP_SQL = `
  SELECT intent_id, intent_class, slots_json, target_ids, risk_tier,
         success_count, context_fingerprint
  FROM chat_routing_memory_index
  WHERE tenant_id = $1 AND user_id = $2
    AND query_fingerprint = $3
    AND context_fingerprint = $4
    AND schema_version = $5 AND tool_version = $6
    AND is_deleted = false
    AND (ttl_expires_at IS NULL OR ttl_expires_at > now())
  LIMIT 1
`

/**
 * POST /api/chat/routing-memory/lookup
 *
 * Phase 2b: exact memory lookup by query + context fingerprint.
 * Returns matching memory entry or null.
 *
 * Gate 4: Server-authoritative kill switch (CHAT_ROUTING_MEMORY_KILL)
 * Gate 7: Server-authoritative enable flag (CHAT_ROUTING_MEMORY_READ_ENABLED)
 * Fail-open: returns { match: null } on DB errors.
 */
export async function POST(request: NextRequest) {
  // Gate 4: Emergency kill switch
  if (process.env.CHAT_ROUTING_MEMORY_KILL === 'true') {
    return NextResponse.json({ match: null }, { status: 200 })
  }

  // Gate 7: Server-authoritative enable flag
  if (process.env.CHAT_ROUTING_MEMORY_READ_ENABLED !== 'true') {
    return NextResponse.json({ match: null }, { status: 200 })
  }

  try {
    const payload: {
      raw_query_text: string
      context_snapshot: ContextSnapshotV1
      navigation_replay_mode?: boolean  // Phase 5: use navigation-specific minimal fingerprint
    } = await request.json()

    // Normalize and fingerprint on server side (crypto available here)
    const normalizedText = normalizeForStorage(payload.raw_query_text)
    const queryFingerprint = computeQueryFingerprint(normalizedText)

    // Phase 5 navigation rows use a minimal fingerprint (strips ephemeral UI state)
    const strippedSnapshot = payload.navigation_replay_mode
      ? stripVolatileFieldsForNavigation(payload.context_snapshot)
      : stripVolatileFields(payload.context_snapshot)
    const contextFingerprint = sha256Hex(canonicalJsonSerialize(strippedSnapshot))

    const { rows } = await serverPool.query(LOOKUP_SQL, [
      OPTION_A_TENANT_ID, OPTION_A_USER_ID,
      queryFingerprint,
      contextFingerprint,
      MEMORY_SCHEMA_VERSION, MEMORY_TOOL_VERSION,
    ])

    if (rows.length === 0) {
      return NextResponse.json({ match: null }, { status: 200 })
    }

    const row = rows[0]
    return NextResponse.json({
      match: {
        intent_id: row.intent_id,
        intent_class: row.intent_class,
        slots_json: row.slots_json,
        target_ids: row.target_ids,
        risk_tier: row.risk_tier,
        success_count: row.success_count,
        context_fingerprint: row.context_fingerprint,
      },
    }, { status: 200 })
  } catch (err: unknown) {
    // Fail-open: return null match on DB errors
    console.warn('[routing-memory] server lookup failed (non-fatal):', (err as Error).message)
    return NextResponse.json({ match: null }, { status: 200 })
  }
}
