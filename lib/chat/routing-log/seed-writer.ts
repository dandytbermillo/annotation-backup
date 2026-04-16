/**
 * Widget Preseed Writer (Fix 3 Part A)
 *
 * Writes canonical retrieval-aid seed rows into `chat_routing_memory_index`
 * when a widget/panel is created, renamed, or restored. Soft-deletes them on
 * panel soft-delete; hard-deletes them on panel permanent delete.
 *
 * Three templates per panel instance:
 *   1. `open <title>`       — verb-prefixed navigation
 *   2. `<title>`            — bare-noun navigation
 *   3. `is <title> open?`   — canonical state-info (NO family_id — see note)
 *
 * Authority contract (per `docs/proposal/chat-navigation/plan/panels/chat/
 * meta/multi_layer/backup/how-it-works.md` lines 269-275, 300-304):
 *   - Preseeds are recall aids ONLY.
 *   - They supply retrieval candidates; execution authority remains the
 *     live installedWidgets contract + structured resolver/executor path.
 *   - Neither seeds nor learned rows bypass live resolver/executor validation.
 *
 * State-info template note:
 *   The executor at `state-info-resolvers.ts:355` treats any open_state
 *   candidate carrying `family_id` as a family query. For instance-specific
 *   state-info preseed (`is Links Panel M open?`), `family_id` is OMITTED
 *   so the executor answers about the specific instance, not the whole
 *   duplicate-capable family. This matches the Phase 1.5 T17 instance-
 *   synthesis rule at `routing-dispatcher.ts:2680-2712`.
 */

import { createHash } from 'crypto'
import { serverPool } from '@/lib/db/pool'
import { normalizeForStorage, computeQueryFingerprint } from './normalization'
import { computeEmbedding, EMBEDDING_MODEL_VERSION } from './embedding-service'
import { canonicalJsonSerialize, stripVolatileFields } from './context-snapshot'
import {
  OPTION_A_TENANT_ID,
  ROUTING_MEMORY_CURATED_SEED_USER_ID,
  MEMORY_SCHEMA_VERSION,
  MEMORY_TOOL_VERSION,
} from './types'

// Fix 3 Part A Integration (Option A): widget preseeds collapse into the
// existing curated_seed retrieval partition so they flow through the already-
// wired `PHASE5_EXACT_HIT_SEED_SQL` and `PHASE5_SEED_LOOKUP_SQL` branches at
// `app/api/chat/routing-memory/semantic-lookup/route.ts`. Those SQLs query
// `user_id = ROUTING_MEMORY_CURATED_SEED_USER_ID` and `scope_source =
// 'curated_seed'` without a context_fingerprint filter — exactly what widget
// preseeds need (they use the canonical seed context fingerprint).
//
// Widget preseeds are distinguished from GLOBAL curated seeds by carrying
// `slots_json.panelId` — global seeds have no panelId, so the lifecycle
// cleanup queries below (which filter by `slots_json->>'panelId' = $1`)
// only match the panel-owned subset and never touch global seeds.
//
// Acceptable for Option A single-user scope. If multi-user seed routing
// becomes a requirement, extend retrieval (Option B) — plan ref: Phase 2a
// Fix 3 Part A integration note.
const SCOPE_SOURCE_WIDGET_PRESEED = 'curated_seed'

const MEMORY_DEFAULT_TTL_DAYS = 30

// Canonical context-snapshot shape used by all widget preseed rows — matches
// the curated-seed script's SEED_CONTEXT at `scripts/seed-phase5-curated-
// exemplars.ts:367-376`. Using the same fingerprint keeps Gate 0 handling
// consistent between curated-seed and widget-preseed scoped rows.
const WIDGET_PRESEED_CONTEXT = {
  version: 'v1_minimal' as const,
  active_panel_count: 0,
  has_pending_options: false,
  has_active_option_set: false,
  has_last_clarification: false,
  has_last_suggestion: false,
  latch_enabled: true,
  message_count: 0,
}

const CONTEXT_FINGERPRINT = createHash('sha256')
  .update(canonicalJsonSerialize(stripVolatileFields(WIDGET_PRESEED_CONTEXT)), 'utf8')
  .digest('hex')

const UPSERT_SQL = `
  INSERT INTO chat_routing_memory_index (
    tenant_id, user_id, scope_source, intent_class,
    query_fingerprint, normalized_query_text, semantic_embedding, embedding_model_version,
    context_fingerprint, intent_id, slots_json, target_ids,
    schema_version, tool_version, permission_signature,
    risk_tier, success_count, last_success_at, ttl_expires_at
  ) VALUES (
    $1, $2, $3, $4,
    $5, $6, $7, $8,
    $9, $10, $11, $12,
    $13, $14, $15,
    $16, 1, now(), now() + interval '${MEMORY_DEFAULT_TTL_DAYS} days'
  )
  ON CONFLICT (tenant_id, user_id, query_fingerprint, context_fingerprint, schema_version, tool_version)
    WHERE is_deleted = false
  DO UPDATE SET
    intent_id = EXCLUDED.intent_id,
    intent_class = EXCLUDED.intent_class,
    slots_json = EXCLUDED.slots_json,
    target_ids = EXCLUDED.target_ids,
    success_count = chat_routing_memory_index.success_count + 1,
    last_success_at = now(),
    ttl_expires_at = now() + interval '${MEMORY_DEFAULT_TTL_DAYS} days',
    semantic_embedding = COALESCE(EXCLUDED.semantic_embedding, chat_routing_memory_index.semantic_embedding),
    updated_at = now()
`

export interface WidgetPreseedInput {
  panelId: string
  userId: string
  title: string
  familyId: string | null
  instanceLabel: string | null
}

export interface WidgetPreseedResult {
  succeeded: number
  failed: number
}

interface SeedTemplate {
  query: string
  intent_id: string
  intent_class: 'action_intent' | 'info_intent'
  slots_json: Record<string, unknown>
  risk_tier: 'low' | 'medium' | 'high'
}

function buildSeedTemplates(input: WidgetPreseedInput): SeedTemplate[] {
  const titleLower = input.title.toLowerCase()
  const navSlots: Record<string, unknown> = {
    action_type: 'open_panel',
    target_name: titleLower,
    panelId: input.panelId,
    panelTitle: input.title,
  }
  if (input.familyId) {
    navSlots.family_id = input.familyId
    navSlots.target_kind = 'instance'
    // Fix 7: validator-facing selector metadata (camelCase) for
    // memory-validator.ts:158-160 Rule 4 (explicit instance path).
    // Without these, the validator falls to Rule 2 (legacy) and
    // rejects with duplicate_family_ambiguous when siblings exist.
    navSlots.duplicateFamily = input.familyId
    navSlots.selectorSpecific = true
    navSlots.instanceLabel = input.instanceLabel
  }

  // State-info slots INTENTIONALLY omit family_id even when the panel belongs
  // to a duplicate-capable family — see module header and executor note at
  // `state-info-resolvers.ts:355`.
  const stateInfoSlots: Record<string, unknown> = {
    action_type: 'state_info',
    query_type: 'open_state',
    target_name: titleLower,
    panelId: input.panelId,
    panelTitle: input.title,
  }

  return [
    { query: `open ${titleLower}`, intent_id: 'open_panel', intent_class: 'action_intent', slots_json: { ...navSlots }, risk_tier: 'low' },
    { query: titleLower, intent_id: 'open_panel', intent_class: 'action_intent', slots_json: { ...navSlots }, risk_tier: 'low' },
    { query: `is ${titleLower} open?`, intent_id: 'state_info', intent_class: 'info_intent', slots_json: stateInfoSlots, risk_tier: 'low' },
  ]
}

async function writeSeedRow(tpl: SeedTemplate, input: WidgetPreseedInput): Promise<boolean> {
  try {
    const normalized = normalizeForStorage(tpl.query)
    const fingerprint = computeQueryFingerprint(normalized)
    const embedding = await computeEmbedding(normalized, fingerprint)
    if (!embedding) {
      console.warn(`[seed-writer] Embedding unavailable for "${tpl.query}" (panel ${input.panelId}) — skipping`)
      return false
    }
    const embeddingParam = `[${embedding.join(',')}]`
    await serverPool.query(UPSERT_SQL, [
      OPTION_A_TENANT_ID,
      // Fix 3 Part A Integration (Option A): user_id must match the
      // retrieval partition. PHASE5_SEED_LOOKUP_SQL and PHASE5_EXACT_HIT_SEED_SQL
      // both query user_id=ROUTING_MEMORY_CURATED_SEED_USER_ID. input.userId
      // is preserved in the parameter signature for future Option B migration
      // but is not used here — logged only for traceability.
      ROUTING_MEMORY_CURATED_SEED_USER_ID,
      SCOPE_SOURCE_WIDGET_PRESEED,
      tpl.intent_class,
      fingerprint,
      normalized,
      embeddingParam,
      EMBEDDING_MODEL_VERSION,
      CONTEXT_FINGERPRINT,
      tpl.intent_id,
      JSON.stringify(tpl.slots_json),
      JSON.stringify([input.panelId]),
      MEMORY_SCHEMA_VERSION,
      MEMORY_TOOL_VERSION,
      'none',
      tpl.risk_tier,
    ])
    return true
  } catch (err) {
    console.error(`[seed-writer] Failed to write seed "${tpl.query}" (panel ${input.panelId}):`, err)
    return false
  }
}

/**
 * Write 3 canonical preseed rows for a newly-created or renamed panel.
 * Failures on individual templates are logged but do not throw — callers
 * should never fail the originating API request because a seed write failed.
 */
export async function writeSeedRowsForPanel(input: WidgetPreseedInput): Promise<WidgetPreseedResult> {
  const templates = buildSeedTemplates(input)
  let succeeded = 0
  let failed = 0
  for (const tpl of templates) {
    const ok = await writeSeedRow(tpl, input)
    if (ok) succeeded += 1
    else failed += 1
  }
  return { succeeded, failed }
}

/**
 * Soft-delete all active widget-preseed rows for a given panelId.
 * Used on panel soft-delete and rename (before writing fresh rows).
 * Scope is strictly `widget_preseed` — curated seeds and learned rows
 * are untouched regardless of panelId match.
 */
export async function softDeleteSeedRowsForPanel(panelId: string): Promise<number> {
  const { rowCount } = await serverPool.query(
    `UPDATE chat_routing_memory_index
        SET is_deleted = true, updated_at = NOW()
      WHERE scope_source = $1
        AND slots_json->>'panelId' = $2
        AND is_deleted = false`,
    [SCOPE_SOURCE_WIDGET_PRESEED, panelId],
  )
  return rowCount ?? 0
}

/**
 * Hard-delete all widget-preseed rows for a given panelId (active or soft-
 * deleted). Used on permanent panel delete. Scope is strictly `widget_preseed`.
 */
export async function hardDeleteSeedRowsForPanel(panelId: string): Promise<number> {
  const { rowCount } = await serverPool.query(
    `DELETE FROM chat_routing_memory_index
      WHERE scope_source = $1
        AND slots_json->>'panelId' = $2`,
    [SCOPE_SOURCE_WIDGET_PRESEED, panelId],
  )
  return rowCount ?? 0
}
