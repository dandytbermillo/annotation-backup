#!/usr/bin/env npx tsx
/**
 * Seed Phase 5 Curated Exemplars
 *
 * Inserts curated semantic exemplars into chat_routing_memory_index
 * under the reserved sentinel user_id (__curated_seed__).
 *
 * These serve as hint-only precedents for Phase 5 retrieval-backed
 * semantic hinting. They are never directly executed — final truth
 * comes from live validation.
 *
 * Usage:
 *   npx tsx scripts/seed-phase5-curated-exemplars.ts
 *   npx tsx scripts/seed-phase5-curated-exemplars.ts --dry-run
 *   npx tsx scripts/seed-phase5-curated-exemplars.ts --verify
 *   npx tsx scripts/seed-phase5-curated-exemplars.ts --cleanup
 */

import { Pool } from 'pg'
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { createHash } from 'crypto'
import { normalizeForStorage, computeQueryFingerprint } from '../lib/chat/routing-log/normalization'
import { computeEmbedding, EMBEDDING_MODEL_VERSION } from '../lib/chat/routing-log/embedding-service'
import { canonicalJsonSerialize, stripVolatileFields } from '../lib/chat/routing-log/context-snapshot'
import {
  OPTION_A_TENANT_ID,
  ROUTING_MEMORY_CURATED_SEED_USER_ID,
  MEMORY_SCHEMA_VERSION,
  MEMORY_TOOL_VERSION,
} from '../lib/chat/routing-log/types'

// ---------------------------------------------------------------------------
// Curated seed definitions
// ---------------------------------------------------------------------------

interface CuratedSeed {
  query: string
  intent_id: string
  intent_class: 'action_intent' | 'info_intent'
  slots_json: Record<string, unknown>
}

const CURATED_SEEDS: CuratedSeed[] = [
  // History / info
  { query: 'what did I just do?', intent_id: 'last_action', intent_class: 'info_intent', slots_json: { resolved_intent: 'last_action', answer_source: 'session_state' } },
  { query: 'what was my last action?', intent_id: 'last_action', intent_class: 'info_intent', slots_json: { resolved_intent: 'last_action', answer_source: 'session_state' } },
  { query: 'remind me what I just did', intent_id: 'last_action', intent_class: 'info_intent', slots_json: { resolved_intent: 'last_action', answer_source: 'session_state' } },
  { query: 'did I open links panel b?', intent_id: 'verify_action', intent_class: 'info_intent', slots_json: { resolved_intent: 'verify_action', answer_source: 'action_history' } },
  // Navigation
  { query: 'go home', intent_id: 'go_home', intent_class: 'action_intent', slots_json: { action_type: 'go_home' } },
  { query: 'take me home', intent_id: 'go_home', intent_class: 'action_intent', slots_json: { action_type: 'go_home' } },
  { query: 'return home', intent_id: 'go_home', intent_class: 'action_intent', slots_json: { action_type: 'go_home' } },
  // Stable panel command families only — no user-specific targets
  // Instance seeds: explicit selector forms (family_id + target_kind: 'instance')
  { query: 'open links panel a', intent_id: 'open_panel', intent_class: 'action_intent', slots_json: { action_type: 'open_panel', target_name: 'links panel a', family_id: 'quick-links', target_kind: 'instance' } },
  { query: 'open links panel b', intent_id: 'open_panel', intent_class: 'action_intent', slots_json: { action_type: 'open_panel', target_name: 'links panel b', family_id: 'quick-links', target_kind: 'instance' } },
  { query: 'open links panel c', intent_id: 'open_panel', intent_class: 'action_intent', slots_json: { action_type: 'open_panel', target_name: 'links panel c', family_id: 'quick-links', target_kind: 'instance' } },
  { query: 'open links panel d', intent_id: 'open_panel', intent_class: 'action_intent', slots_json: { action_type: 'open_panel', target_name: 'links panel d', family_id: 'quick-links', target_kind: 'instance' } },
  // Family seeds: generic duplicate-capable forms (family_id + target_kind: 'family')
  { query: 'open navigator', intent_id: 'open_panel', intent_class: 'action_intent', slots_json: { action_type: 'open_panel', target_name: 'navigator', family_id: 'navigator', target_kind: 'family' } },
  { query: 'open links panel', intent_id: 'open_panel', intent_class: 'action_intent', slots_json: { action_type: 'open_panel', target_name: 'links panel', family_id: 'quick-links', target_kind: 'family' } },
  // Singleton seeds: no family metadata (not duplicate-capable)
  { query: 'open widget manager', intent_id: 'open_panel', intent_class: 'action_intent', slots_json: { action_type: 'open_panel', target_name: 'widget manager' } },
  // Phase 2: Bare-noun seeds — noun-only forms for semantic-first known-noun convergence
  { query: 'recent', intent_id: 'open_panel', intent_class: 'action_intent', slots_json: { action_type: 'open_panel', target_name: 'recent' } },
  { query: 'widget manager', intent_id: 'open_panel', intent_class: 'action_intent', slots_json: { action_type: 'open_panel', target_name: 'widget manager' } },
  // Family seeds: bare-noun generic duplicate-capable forms
  { query: 'navigator', intent_id: 'open_panel', intent_class: 'action_intent', slots_json: { action_type: 'open_panel', target_name: 'navigator', family_id: 'navigator', target_kind: 'family' } },
  { query: 'links panel', intent_id: 'open_panel', intent_class: 'action_intent', slots_json: { action_type: 'open_panel', target_name: 'links panel', family_id: 'quick-links', target_kind: 'family' } },
  { query: 'quick links', intent_id: 'open_panel', intent_class: 'action_intent', slots_json: { action_type: 'open_panel', target_name: 'quick links', family_id: 'quick-links', target_kind: 'family' } },
  // Instance seeds: bare-noun explicit selector forms
  { query: 'links panel a', intent_id: 'open_panel', intent_class: 'action_intent', slots_json: { action_type: 'open_panel', target_name: 'links panel a', family_id: 'quick-links', target_kind: 'instance' } },
  { query: 'links panel b', intent_id: 'open_panel', intent_class: 'action_intent', slots_json: { action_type: 'open_panel', target_name: 'links panel b', family_id: 'quick-links', target_kind: 'instance' } },
  { query: 'links panel c', intent_id: 'open_panel', intent_class: 'action_intent', slots_json: { action_type: 'open_panel', target_name: 'links panel c', family_id: 'quick-links', target_kind: 'instance' } },
  { query: 'links panel d', intent_id: 'open_panel', intent_class: 'action_intent', slots_json: { action_type: 'open_panel', target_name: 'links panel d', family_id: 'quick-links', target_kind: 'instance' } },
  // Step 10a: State-info seeds — semantic retrieval for freeform widget/panel state questions
  // Generic open-state
  { query: 'what panels are open?', intent_id: 'state_info', intent_class: 'info_intent', slots_json: { action_type: 'state_info', query_type: 'open_state', scope: 'panels' } },
  { query: 'what widgets are open?', intent_id: 'state_info', intent_class: 'info_intent', slots_json: { action_type: 'state_info', query_type: 'open_state', scope: 'widgets' } },
  { query: 'what panel is open?', intent_id: 'state_info', intent_class: 'info_intent', slots_json: { action_type: 'state_info', query_type: 'open_state', scope: 'panels' } },
  { query: 'what panel are open?', intent_id: 'state_info', intent_class: 'info_intent', slots_json: { action_type: 'state_info', query_type: 'open_state', scope: 'panels' } },
  { query: 'what widgets are visible?', intent_id: 'state_info', intent_class: 'info_intent', slots_json: { action_type: 'state_info', query_type: 'open_state', scope: 'widgets' } },
  { query: 'which panels are open?', intent_id: 'state_info', intent_class: 'info_intent', slots_json: { action_type: 'state_info', query_type: 'open_state', scope: 'panels' } },
  // Generic active-state
  { query: 'what is the active panel?', intent_id: 'state_info', intent_class: 'info_intent', slots_json: { action_type: 'state_info', query_type: 'active_state', scope: 'panel' } },
  { query: 'which panel is active?', intent_id: 'state_info', intent_class: 'info_intent', slots_json: { action_type: 'state_info', query_type: 'active_state', scope: 'panel' } },
  { query: 'what is the active widget?', intent_id: 'state_info', intent_class: 'info_intent', slots_json: { action_type: 'state_info', query_type: 'active_state', scope: 'widget' } },
  // Noun-specific open-state
  { query: 'is recent open?', intent_id: 'state_info', intent_class: 'info_intent', slots_json: { action_type: 'state_info', query_type: 'open_state', target_name: 'recent' } },
  { query: 'is recent widget open?', intent_id: 'state_info', intent_class: 'info_intent', slots_json: { action_type: 'state_info', query_type: 'open_state', target_name: 'recent', scope: 'widget' } },
  { query: 'is navigator open?', intent_id: 'state_info', intent_class: 'info_intent', slots_json: { action_type: 'state_info', query_type: 'open_state', target_name: 'navigator', family_id: 'navigator' } },
  { query: 'which navigator is open?', intent_id: 'state_info', intent_class: 'info_intent', slots_json: { action_type: 'state_info', query_type: 'open_state', target_name: 'navigator', family_id: 'navigator' } },
  { query: 'is links panel open?', intent_id: 'state_info', intent_class: 'info_intent', slots_json: { action_type: 'state_info', query_type: 'open_state', target_name: 'links panel', family_id: 'quick-links' } },
  { query: 'which links panel is open?', intent_id: 'state_info', intent_class: 'info_intent', slots_json: { action_type: 'state_info', query_type: 'open_state', target_name: 'links panel', family_id: 'quick-links' } },
  { query: 'is links panel a open?', intent_id: 'state_info', intent_class: 'info_intent', slots_json: { action_type: 'state_info', query_type: 'open_state', target_name: 'links panel a' } },
  { query: 'is links panel b open?', intent_id: 'state_info', intent_class: 'info_intent', slots_json: { action_type: 'state_info', query_type: 'open_state', target_name: 'links panel b' } },
  { query: 'is links panel c open?', intent_id: 'state_info', intent_class: 'info_intent', slots_json: { action_type: 'state_info', query_type: 'open_state', target_name: 'links panel c' } },
  { query: 'is links panel d open?', intent_id: 'state_info', intent_class: 'info_intent', slots_json: { action_type: 'state_info', query_type: 'open_state', target_name: 'links panel d' } },
  { query: 'is widget manager open?', intent_id: 'state_info', intent_class: 'info_intent', slots_json: { action_type: 'state_info', query_type: 'open_state', target_name: 'widget manager' } },
  // Surface manifest seeds (Phase E) — dedicated surface resolver
  // Contract (surface-command-resolver-design.md:644-651):
  //   show recent / show recent widget / show recent widget entries → drawer/display
  //   list recent entries / show recent entries in the chat → chat answer

  // ── Chat-list seeds (explicit list/in-the-chat phrasing) ──
  {
    query: 'list my recent entries',
    intent_id: 'surface_manifest:recent.state_info.list_recent',
    intent_class: 'info_intent',
    slots_json: {
      action_type: 'surface_manifest_execute',
      surface_manifest: {
        surfaceType: 'recent',
        containerType: 'dashboard',
        intentFamily: 'state_info',
        intentSubtype: 'list_recent',
        executionPolicy: 'list_items',
        handlerId: 'recent_panel_handler',
      },
      validation: {
        requiresVisibleSurface: true,
        requiresContainerMatch: true,
      },
      executionMode: 'chat_answer',
    },
  },
  {
    query: 'show recent entries in the chat',
    intent_id: 'surface_manifest:recent.state_info.list_recent',
    intent_class: 'info_intent',
    slots_json: {
      action_type: 'surface_manifest_execute',
      surface_manifest: {
        surfaceType: 'recent',
        containerType: 'dashboard',
        intentFamily: 'state_info',
        intentSubtype: 'list_recent',
        executionPolicy: 'list_items',
        handlerId: 'recent_panel_handler',
      },
      validation: {
        requiresVisibleSurface: true,
        requiresContainerMatch: true,
      },
      executionMode: 'chat_answer',
    },
  },

  {
    query: 'show recent widget contents in the chat',
    intent_id: 'surface_manifest:recent.state_info.list_recent',
    intent_class: 'info_intent',
    slots_json: {
      action_type: 'surface_manifest_execute',
      surface_manifest: {
        surfaceType: 'recent',
        containerType: 'dashboard',
        intentFamily: 'state_info',
        intentSubtype: 'list_recent',
        executionPolicy: 'list_items',
        handlerId: 'recent_panel_handler',
      },
      validation: {
        requiresVisibleSurface: true,
        requiresContainerMatch: true,
      },
      executionMode: 'chat_answer',
    },
  },

  // ── Drawer/display seeds (bare "show" / "open" defaults to drawer) ──
  {
    query: 'open recent',
    intent_id: 'surface_manifest:recent.navigate.open_drawer',
    intent_class: 'action_intent',
    slots_json: {
      action_type: 'surface_manifest_execute',
      surface_manifest: {
        surfaceType: 'recent',
        containerType: 'dashboard',
        intentFamily: 'navigate',
        intentSubtype: 'open_drawer',
        executionPolicy: 'open_surface',
        handlerId: 'recent_panel_handler',
      },
      validation: {
        requiresVisibleSurface: true,
        requiresContainerMatch: true,
      },
      executionMode: 'drawer_display',
    },
  },
  {
    query: 'show recent',
    intent_id: 'surface_manifest:recent.navigate.open_drawer',
    intent_class: 'action_intent',
    slots_json: {
      action_type: 'surface_manifest_execute',
      surface_manifest: {
        surfaceType: 'recent',
        containerType: 'dashboard',
        intentFamily: 'navigate',
        intentSubtype: 'open_drawer',
        executionPolicy: 'open_surface',
        handlerId: 'recent_panel_handler',
      },
      validation: {
        requiresVisibleSurface: true,
        requiresContainerMatch: true,
      },
      executionMode: 'drawer_display',
    },
  },
  {
    query: 'show me my recent items',
    intent_id: 'surface_manifest:recent.navigate.open_drawer',
    intent_class: 'action_intent',
    slots_json: {
      action_type: 'surface_manifest_execute',
      surface_manifest: {
        surfaceType: 'recent',
        containerType: 'dashboard',
        intentFamily: 'navigate',
        intentSubtype: 'open_drawer',
        executionPolicy: 'open_surface',
        handlerId: 'recent_panel_handler',
      },
      validation: {
        requiresVisibleSurface: true,
        requiresContainerMatch: true,
      },
      executionMode: 'drawer_display',
    },
  },
  {
    query: 'show my recent entries',
    intent_id: 'surface_manifest:recent.navigate.open_drawer',
    intent_class: 'action_intent',
    slots_json: {
      action_type: 'surface_manifest_execute',
      surface_manifest: {
        surfaceType: 'recent',
        containerType: 'dashboard',
        intentFamily: 'navigate',
        intentSubtype: 'open_drawer',
        executionPolicy: 'open_surface',
        handlerId: 'recent_panel_handler',
      },
      validation: {
        requiresVisibleSurface: true,
        requiresContainerMatch: true,
      },
      executionMode: 'drawer_display',
    },
  },
  {
    query: 'open recent widget',
    intent_id: 'surface_manifest:recent.navigate.open_drawer',
    intent_class: 'action_intent',
    slots_json: {
      action_type: 'surface_manifest_execute',
      surface_manifest: {
        surfaceType: 'recent',
        containerType: 'dashboard',
        intentFamily: 'navigate',
        intentSubtype: 'open_drawer',
        executionPolicy: 'open_surface',
        handlerId: 'recent_panel_handler',
      },
      validation: {
        requiresVisibleSurface: true,
        requiresContainerMatch: true,
      },
      executionMode: 'drawer_display',
    },
  },
  {
    query: 'open the recent widget',
    intent_id: 'surface_manifest:recent.navigate.open_drawer',
    intent_class: 'action_intent',
    slots_json: {
      action_type: 'surface_manifest_execute',
      surface_manifest: {
        surfaceType: 'recent',
        containerType: 'dashboard',
        intentFamily: 'navigate',
        intentSubtype: 'open_drawer',
        executionPolicy: 'open_surface',
        handlerId: 'recent_panel_handler',
      },
      validation: {
        requiresVisibleSurface: true,
        requiresContainerMatch: true,
      },
      executionMode: 'drawer_display',
    },
  },
  {
    query: 'show recent widget entries',
    intent_id: 'surface_manifest:recent.navigate.open_drawer',
    intent_class: 'action_intent',
    slots_json: {
      action_type: 'surface_manifest_execute',
      surface_manifest: {
        surfaceType: 'recent',
        containerType: 'dashboard',
        intentFamily: 'navigate',
        intentSubtype: 'open_drawer',
        executionPolicy: 'open_surface',
        handlerId: 'recent_panel_handler',
      },
      validation: {
        requiresVisibleSurface: true,
        requiresContainerMatch: true,
      },
      executionMode: 'drawer_display',
    },
  },
]

// ---------------------------------------------------------------------------
// Config (constants imported from runtime modules above)
// ---------------------------------------------------------------------------

const MEMORY_DEFAULT_TTL_DAYS = 30

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const verifyOnly = args.includes('--verify')
const cleanupOnly = args.includes('--cleanup')

// ---------------------------------------------------------------------------
// Database
// ---------------------------------------------------------------------------

function getDatabaseUrl(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL
  try {
    const envPath = join(process.cwd(), '.env.local')
    if (existsSync(envPath)) {
      const content = readFileSync(envPath, 'utf-8')
      const match = content.match(/^DATABASE_URL=(.+)$/m)
      if (match) return match[1].trim()
    }
  } catch { /* ignore */ }
  return 'postgresql://postgres:postgres@localhost:5432/annotation_dev'
}

const pool = new Pool({ connectionString: getDatabaseUrl() })

// ---------------------------------------------------------------------------
// Helpers (reuse runtime pipeline)
// ---------------------------------------------------------------------------

// Curated seeds use a generic context snapshot (not user-specific)
const SEED_CONTEXT = {
  version: 'v1_minimal' as const,
  active_panel_count: 0,
  has_pending_options: false,
  has_active_option_set: false,
  has_last_clarification: false,
  has_last_suggestion: false,
  latch_enabled: true,
  message_count: 0,
}

// Use same fingerprint computation as runtime
function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex')
}

const CONTEXT_FINGERPRINT = sha256Hex(
  canonicalJsonSerialize(stripVolatileFields(SEED_CONTEXT))
)

// Embedding uses the runtime computeEmbedding from embedding-service.ts (imported above)

// ---------------------------------------------------------------------------
// UPSERT SQL
// ---------------------------------------------------------------------------

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
    success_count = chat_routing_memory_index.success_count + 1,
    last_success_at = now(),
    ttl_expires_at = now() + interval '${MEMORY_DEFAULT_TTL_DAYS} days',
    semantic_embedding = COALESCE(EXCLUDED.semantic_embedding, chat_routing_memory_index.semantic_embedding),
    updated_at = now()
`

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function seedAll() {
  console.log(`[seed] Phase 5 curated exemplars — ${CURATED_SEEDS.length} seeds`)
  console.log(`[seed] User ID: ${ROUTING_MEMORY_CURATED_SEED_USER_ID}`)
  console.log(`[seed] Mode: ${dryRun ? 'DRY RUN' : 'LIVE'}`)

  let succeeded = 0
  let failed = 0

  for (const seed of CURATED_SEEDS) {
    const normalized = normalizeForStorage(seed.query)
    const fingerprint = computeQueryFingerprint(normalized)

    console.log(`\n[seed] "${seed.query}" → ${seed.intent_id} (${seed.intent_class})`)
    console.log(`  normalized: "${normalized}"`)
    console.log(`  fingerprint: ${fingerprint.slice(0, 16)}...`)

    const embedding = await computeEmbedding(normalized, fingerprint)
    if (!embedding) {
      console.error(`  ✗ Embedding failed — skipping`)
      failed++
      continue
    }

    console.log(`  embedding: ${embedding.length} dimensions`)

    if (dryRun) {
      console.log(`  [DRY RUN] Would upsert`)
      succeeded++
      continue
    }

    const embeddingParam = `[${embedding.join(',')}]`

    try {
      await pool.query(UPSERT_SQL, [
        OPTION_A_TENANT_ID,
        ROUTING_MEMORY_CURATED_SEED_USER_ID,
        'curated_seed',
        seed.intent_class,
        fingerprint,
        normalized,
        embeddingParam,
        EMBEDDING_MODEL_VERSION,
        CONTEXT_FINGERPRINT,
        seed.intent_id,
        JSON.stringify(seed.slots_json),
        JSON.stringify([]),
        MEMORY_SCHEMA_VERSION,
        MEMORY_TOOL_VERSION,
        'none',
        'low',
      ])
      console.log(`  ✓ Upserted`)
      succeeded++
    } catch (err: unknown) {
      console.error(`  ✗ DB error: ${(err as Error).message}`)
      failed++
    }
  }

  console.log(`\n[seed] Done: ${succeeded} succeeded, ${failed} failed`)
}

async function verify() {
  console.log('[seed] Verifying curated seeds...')
  const { rows } = await pool.query(
    `SELECT normalized_query_text, intent_id, intent_class, scope_source, risk_tier,
            semantic_embedding IS NOT NULL AS has_embedding
     FROM chat_routing_memory_index
     WHERE user_id = $1 AND scope_source = 'curated_seed' AND is_deleted = false
     ORDER BY normalized_query_text`,
    [ROUTING_MEMORY_CURATED_SEED_USER_ID]
  )

  if (rows.length === 0) {
    console.log('[seed] No curated seeds found.')
    return
  }

  for (const row of rows) {
    const emb = row.has_embedding ? '✓ emb' : '✗ no-emb'
    console.log(`  ${emb} | ${row.intent_class} | ${row.intent_id} | "${row.normalized_query_text}"`)
  }
  console.log(`[seed] Total: ${rows.length} curated seeds`)
}

async function cleanup() {
  console.log('[seed] Soft-deleting all curated seeds...')
  const { rowCount } = await pool.query(
    `UPDATE chat_routing_memory_index SET is_deleted = true, updated_at = now()
     WHERE user_id = $1 AND scope_source = 'curated_seed' AND is_deleted = false`,
    [ROUTING_MEMORY_CURATED_SEED_USER_ID]
  )
  console.log(`[seed] Soft-deleted ${rowCount} rows`)
}

async function main() {
  try {
    if (verifyOnly) {
      await verify()
    } else if (cleanupOnly) {
      await cleanup()
    } else {
      await seedAll()
    }
  } finally {
    await pool.end()
  }
}

main().catch((err) => {
  console.error('[seed] Fatal:', err)
  process.exit(1)
})
