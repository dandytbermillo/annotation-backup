#!/usr/bin/env npx tsx
/**
 * Seed Shadow-Reorder Fixture — Phase 3c Validation
 *
 * Seeds chat_routing_memory_index with entries pointing to budget200 (position 2
 * in the grounding clarifier) so that testing with "show budget" triggers:
 *   B1 miss → B2 hit (cosine >= 0.92) → shadow_reordered
 *
 * B1 avoidance strategy:
 *   B1 exact lookup matches on (query_fingerprint, context_fingerprint).
 *   B2 semantic lookup matches on cosine similarity only (ignores context_fingerprint).
 *   So we seed "show budget" text with a DIFFERENT context_fingerprint — B1 misses
 *   (fingerprint mismatch) but B2 finds it (cosine 1.0).
 *
 * Item ID note:
 *   Grounding candidates use widget-panel IDs (98cec0f2-...) which may differ
 *   from items-table IDs (45bfa4cf-...). The seed must use the grounding candidate
 *   ID so computeClarifierReorderTelemetry can match.
 *
 * Isolation: Uses scope_source='phase3c_seed' for easy cleanup.
 *
 * Usage:
 *   npx tsx scripts/seed-shadow-reorder-fixture.ts           # Seed entries
 *   npx tsx scripts/seed-shadow-reorder-fixture.ts --dry-run  # Preview without writing
 *   npx tsx scripts/seed-shadow-reorder-fixture.ts --verify   # Check existing entries
 *   npx tsx scripts/seed-shadow-reorder-fixture.ts --cleanup  # Remove seeded entries
 *
 * After seeding, soak test:
 *   1. "show budget" in chat → clarifier with budget100 and budget200
 *   2. Check durable log: b2_clarifier_status should be 'shadow_reordered'
 *   3. Select the option → verify correlation fields
 */

import { Pool } from 'pg'
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { createHash } from 'crypto'

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

// Grounding candidate ID for budget200 — this is the ID the widget panel uses,
// which may differ from the items table ID. The seed must use this ID because
// computeClarifierReorderTelemetry matches grounding candidate IDs against
// B2 slots_json.itemId.
// Verified from soak log: b2_clarifier_option_ids includes this UUID at position 2.
const BUDGET200_GROUNDING_ID = '98cec0f2-b869-412e-93a8-9162e00b9074'
const BUDGET200_LABEL = 'budget200'

// Seed queries: includes the exact test query "show budget" plus semantic variants.
// B1 avoidance: we use a deliberately different context_fingerprint (SEED_CONTEXT)
// so B1 exact lookup misses (it matches on query_fingerprint + context_fingerprint).
// B2 semantic lookup ignores context_fingerprint, so it finds these by cosine similarity.
const SEED_QUERIES = [
  'show budget',      // Exact test query — cosine 1.0 for B2, B1-safe via context mismatch
  'display budget',   // Semantic variant
  'open budget',      // Semantic variant
  'bring up budget',  // Semantic variant
]

// Isolation marker — all seeded rows use this scope_source for cleanup
const SEED_SCOPE_SOURCE = 'phase3c_seed'

// Memory index constants (must match lib/chat/routing-log/types.ts)
const OPTION_A_TENANT_ID = 'default'
const OPTION_A_USER_ID = 'local'
const MEMORY_SCHEMA_VERSION = 'v1'
const MEMORY_TOOL_VERSION = 'v2'
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
// Helpers
// ---------------------------------------------------------------------------

function normalizeForStorage(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ').toLowerCase()
}

function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex')
}

function sortKeysDeep(value: unknown): unknown {
  if (value === null || value === undefined) return value
  if (typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(sortKeysDeep)
  const sorted: Record<string, unknown> = {}
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    sorted[key] = sortKeysDeep((value as Record<string, unknown>)[key])
  }
  return sorted
}

// Deliberately different context snapshot for B1 avoidance.
// The real runtime context has active_panel_count=4, message_count=N, etc.
// By using active_panel_count=99 (impossible in real usage), the context_fingerprint
// will never match the runtime context → B1 always misses these entries.
// B2 ignores context_fingerprint entirely, so this doesn't affect B2 lookup.
const SEED_CONTEXT = {
  version: 'v1_minimal',
  active_panel_count: 99,  // Deliberately unrealistic — prevents B1 match
  has_pending_options: false,
  has_active_option_set: false,
  has_last_clarification: false,
  has_last_suggestion: false,
  latch_enabled: true,
}

const CONTEXT_FINGERPRINT = sha256Hex(JSON.stringify(sortKeysDeep(SEED_CONTEXT)))

// ---------------------------------------------------------------------------
// OpenAI embedding (direct API call, no server dependency)
// ---------------------------------------------------------------------------

function getApiKey(): string | null {
  const envKey = process.env.OPENAI_API_KEY
  if (envKey?.startsWith('sk-') && envKey.length > 40) return envKey
  try {
    const secretsPath = join(process.cwd(), 'config', 'secrets.json')
    if (existsSync(secretsPath)) {
      const secrets = JSON.parse(readFileSync(secretsPath, 'utf-8'))
      if (secrets.OPENAI_API_KEY) return secrets.OPENAI_API_KEY
    }
  } catch { /* ignore */ }
  return null
}

async function computeEmbedding(text: string): Promise<number[] | null> {
  const apiKey = getApiKey()
  if (!apiKey) {
    console.error('[seed] No OpenAI API key found in env or config/secrets.json')
    return null
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 10000)

  try {
    const response = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'text-embedding-3-small',
        input: text,
      }),
      signal: controller.signal,
    })
    clearTimeout(timer)

    if (!response.ok) {
      const body = await response.text()
      console.error(`[seed] OpenAI API error ${response.status}: ${body.slice(0, 200)}`)
      return null
    }

    const data = await response.json()
    return data.data?.[0]?.embedding ?? null
  } catch (err) {
    clearTimeout(timer)
    console.error('[seed] Embedding failed:', (err as Error).message)
    return null
  }
}

// ---------------------------------------------------------------------------
// UPSERT SQL (mirrors app/api/chat/routing-memory/route.ts)
// ---------------------------------------------------------------------------

const UPSERT_SQL = `
  INSERT INTO chat_routing_memory_index (
    tenant_id, user_id, scope_source, intent_class,
    query_fingerprint, normalized_query_text,
    semantic_embedding, embedding_model_version,
    context_fingerprint,
    intent_id, slots_json, target_ids,
    schema_version, tool_version, permission_signature,
    risk_tier, success_count, last_success_at, ttl_expires_at
  ) VALUES (
    $1, $2, $3, $4,
    $5, $6,
    $7, $8,
    $9,
    $10, $11, $12,
    $13, $14, $15,
    $16, 1, now(), now() + interval '${MEMORY_DEFAULT_TTL_DAYS} days'
  )
  ON CONFLICT (tenant_id, user_id, query_fingerprint, context_fingerprint, schema_version, tool_version)
    WHERE is_deleted = false
  DO UPDATE SET
    success_count = chat_routing_memory_index.success_count + 1,
    last_success_at = now(),
    ttl_expires_at = now() + interval '${MEMORY_DEFAULT_TTL_DAYS} days',
    semantic_embedding = COALESCE(EXCLUDED.semantic_embedding, chat_routing_memory_index.semantic_embedding),
    embedding_model_version = CASE
      WHEN EXCLUDED.semantic_embedding IS NOT NULL THEN EXCLUDED.embedding_model_version
      ELSE chat_routing_memory_index.embedding_model_version
    END,
    slots_json = EXCLUDED.slots_json,
    target_ids = EXCLUDED.target_ids,
    updated_at = now()
`

// ---------------------------------------------------------------------------
// Verify
// ---------------------------------------------------------------------------

async function verify() {
  console.log('\n--- Verification: phase3c_seed entries for budget200 B ---\n')

  const { rows } = await pool.query(`
    SELECT normalized_query_text, intent_id,
           slots_json->>'itemId' as item_id,
           CASE WHEN semantic_embedding IS NOT NULL THEN 'YES' ELSE 'NO' END as has_embedding,
           success_count, scope_source, created_at
    FROM chat_routing_memory_index
    WHERE scope_source = $1
      AND is_deleted = false
    ORDER BY created_at DESC
  `, [SEED_SCOPE_SOURCE])

  if (rows.length === 0) {
    console.log('No phase3c_seed entries found.')
    console.log('Run without flags to seed entries.')
  } else {
    console.log(`Found ${rows.length} seeded entries:\n`)
    for (const row of rows) {
      console.log(`  "${row.normalized_query_text}"`)
      console.log(`    itemId: ${row.item_id}, embedding: ${row.has_embedding}, count: ${row.success_count}`)
    }
  }

  // Also check if "show budget" has a B1-eligible exact entry (would defeat the test)
  const testNormalized = normalizeForStorage('show budget')
  const testFingerprint = sha256Hex(testNormalized)
  const { rows: b1Rows } = await pool.query(`
    SELECT normalized_query_text, scope_source, intent_id, context_fingerprint
    FROM chat_routing_memory_index
    WHERE query_fingerprint = $1
      AND tenant_id = $2 AND user_id = $3
      AND schema_version = $4 AND tool_version = $5
      AND is_deleted = false
    LIMIT 5
  `, [testFingerprint, OPTION_A_TENANT_ID, OPTION_A_USER_ID, MEMORY_SCHEMA_VERSION, MEMORY_TOOL_VERSION])

  console.log(`\n--- B1 exact-hit check for "show budget" ---\n`)
  if (b1Rows.length > 0) {
    // B1 matches on (query_fingerprint, context_fingerprint). Entries with our seed
    // context_fingerprint won't match runtime context, so they're B1-safe.
    const dangerous = b1Rows.filter((r: Record<string, unknown>) => r.scope_source !== SEED_SCOPE_SOURCE)
    if (dangerous.length > 0) {
      console.log('WARNING: Non-seed B1 entries exist for "show budget":')
      for (const row of dangerous) {
        console.log(`  scope: ${row.scope_source}, intent: ${row.intent_id}, ctx_fp: ${(row.context_fingerprint as string).slice(0, 12)}...`)
      }
      console.log('\nThese may cause B1 auto-execute, bypassing the clarifier.')
    } else {
      console.log(`Found ${b1Rows.length} entry(ies) with matching query_fingerprint, but all are phase3c_seed`)
      console.log(`(with context_fingerprint ${CONTEXT_FINGERPRINT.slice(0, 12)}... — won't match runtime context).`)
      console.log('B1-safe: runtime context will produce a different context_fingerprint.')
    }
  } else {
    console.log('No entries with matching query_fingerprint — B1-safe.')
  }
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

async function cleanup() {
  console.log(`\n--- Cleanup: removing all scope_source='${SEED_SCOPE_SOURCE}' entries ---\n`)

  const { rowCount } = await pool.query(`
    DELETE FROM chat_routing_memory_index
    WHERE scope_source = $1
  `, [SEED_SCOPE_SOURCE])

  console.log(`Deleted ${rowCount} rows.`)
}

// ---------------------------------------------------------------------------
// Seed
// ---------------------------------------------------------------------------

async function seed() {
  console.log(`\n--- Seeding ${SEED_QUERIES.length} entries for shadow_reordered fixture ---\n`)
  console.log(`Target: ${BUDGET200_LABEL} (${BUDGET200_GROUNDING_ID})`)
  console.log(`Scope:  ${SEED_SCOPE_SOURCE}`)
  console.log(`Context FP: ${CONTEXT_FINGERPRINT.slice(0, 16)}... (deliberately different from runtime)`)
  console.log(`Mode:   ${dryRun ? 'DRY RUN' : 'LIVE'}\n`)

  const slotsJson = {
    action_type: 'execute_widget_item',
    widgetId: 'w_links_b',
    segmentId: null,
    itemId: BUDGET200_GROUNDING_ID,
    itemLabel: BUDGET200_LABEL,
    action: 'open',
  }

  const targetIds = ['w_links_b', BUDGET200_GROUNDING_ID]

  let successCount = 0
  let failCount = 0

  for (const rawQuery of SEED_QUERIES) {
    const normalizedText = normalizeForStorage(rawQuery)
    const queryFingerprint = sha256Hex(normalizedText)

    console.log(`  "${rawQuery}"`)
    console.log(`    normalized: "${normalizedText}", fp: ${queryFingerprint.slice(0, 12)}...`)

    if (dryRun) {
      console.log(`    -> would upsert\n`)
      successCount++
      continue
    }

    const embedding = await computeEmbedding(normalizedText)
    if (!embedding) {
      console.log(`    -> SKIP: no embedding\n`)
      failCount++
      continue
    }

    console.log(`    embedding: ${embedding.length} dims`)

    try {
      await pool.query(UPSERT_SQL, [
        OPTION_A_TENANT_ID, OPTION_A_USER_ID, SEED_SCOPE_SOURCE, 'action_intent',
        queryFingerprint, normalizedText,
        `[${embedding.join(',')}]`, 'openai:text-embedding-3-small@v1',
        CONTEXT_FINGERPRINT,
        'grounding_llm_widget_item_execute', JSON.stringify(slotsJson), JSON.stringify(targetIds),
        MEMORY_SCHEMA_VERSION, MEMORY_TOOL_VERSION, 'default',
        'low',
      ])
      console.log(`    -> OK\n`)
      successCount++
    } catch (err) {
      console.log(`    -> DB ERROR: ${(err as Error).message}\n`)
      failCount++
    }
  }

  console.log(`\nResult: ${successCount} ok, ${failCount} failed`)
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  try {
    if (cleanupOnly) {
      await cleanup()
    } else if (verifyOnly) {
      await verify()
    } else {
      await seed()
      console.log('\n--- Post-seed verification ---')
      await verify()
    }
  } finally {
    await pool.end()
  }
}

main().catch((err) => {
  console.error('Fatal:', err)
  process.exit(1)
})
