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
 * Batches:
 *   shadow  — phase3c_seed         (original shadow-mode soak, 12 queries)
 *   active  — phase3c_seed_active  (active-mode trial, 12 fresh queries)
 *
 * Usage:
 *   npx tsx scripts/seed-shadow-reorder-fixture.ts                        # Seed shadow batch
 *   npx tsx scripts/seed-shadow-reorder-fixture.ts --batch active         # Seed active batch
 *   npx tsx scripts/seed-shadow-reorder-fixture.ts --batch active --dry-run
 *   npx tsx scripts/seed-shadow-reorder-fixture.ts --batch active --verify
 *   npx tsx scripts/seed-shadow-reorder-fixture.ts --batch active --cleanup
 *   npx tsx scripts/seed-shadow-reorder-fixture.ts --batch all --verify   # Verify both batches
 *   npx tsx scripts/seed-shadow-reorder-fixture.ts --batch all --cleanup  # Clean both batches
 *
 * After seeding, soak test:
 *   1. Type a query from the batch in chat → clarifier with budget100 and budget200
 *   2. Check durable log: b2_clarifier_status should be 'shadow_reordered' (shadow)
 *      or budget200 at rank 1 (active)
 *   3. Select the option → verify correlation fields
 */

import { Pool } from 'pg'
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { createHash } from 'crypto'

// ---------------------------------------------------------------------------
// Batch definitions
// ---------------------------------------------------------------------------

interface BatchConfig {
  name: string
  scopeSource: string
  queries: string[]
}

const BATCH_SHADOW: BatchConfig = {
  name: 'shadow',
  scopeSource: 'phase3c_seed',
  queries: [
    'show budget',      // Exact test query — cosine 1.0 for B2, B1-safe via context mismatch
    'display budget',   // Semantic variant
    'open budget',      // Semantic variant
    'bring up budget',  // Semantic variant
    'view budget',      // Semantic variant
    'check budget',     // Semantic variant
    'pull up budget',   // Semantic variant
    'find budget',      // Semantic variant
    'go to budget',     // Semantic variant
    'look at budget',   // Semantic variant
    'see budget',       // Semantic variant
    'get budget',       // Semantic variant
  ],
}

const BATCH_ACTIVE: BatchConfig = {
  name: 'active',
  scopeSource: 'phase3c_seed_active',
  queries: [
    'reveal budget',       // Fresh variant — not in shadow batch
    'present budget',      // Fresh variant
    'access budget',       // Fresh variant
    'load budget',         // Fresh variant
    'navigate to budget',  // Fresh variant
    'browse budget',       // Fresh variant
    'locate budget',       // Fresh variant
    'search budget',       // Fresh variant
    'explore budget',      // Fresh variant
    'preview budget',      // Fresh variant
    'inspect budget',      // Fresh variant
    'review budget',       // Fresh variant
  ],
}

const ALL_BATCHES: Record<string, BatchConfig> = {
  shadow: BATCH_SHADOW,
  active: BATCH_ACTIVE,
}

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

function parseBatchArg(): string {
  const idx = args.indexOf('--batch')
  if (idx === -1 || idx + 1 >= args.length) return 'shadow' // default
  return args[idx + 1]
}

const batchArg = parseBatchArg()

function resolveBatches(): BatchConfig[] {
  if (batchArg === 'all') return Object.values(ALL_BATCHES)
  const batch = ALL_BATCHES[batchArg]
  if (!batch) {
    console.error(`Unknown batch: "${batchArg}". Valid: ${Object.keys(ALL_BATCHES).join(', ')}, all`)
    process.exit(1)
  }
  return [batch]
}

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
// Overlap check
// ---------------------------------------------------------------------------

/**
 * Check for overlap between the target batch queries and other batches or
 * non-seed B1-sensitive entries. Fails if any overlap is found.
 */
async function checkOverlap(batch: BatchConfig): Promise<boolean> {
  let hasOverlap = false

  // 1. Check against other batch query lists (in-memory)
  for (const [name, other] of Object.entries(ALL_BATCHES)) {
    if (name === batch.name) continue
    const otherNormalized = new Set(other.queries.map(normalizeForStorage))
    for (const q of batch.queries) {
      if (otherNormalized.has(normalizeForStorage(q))) {
        console.error(`  OVERLAP: "${q}" exists in batch "${name}"`)
        hasOverlap = true
      }
    }
  }

  // 2. Check against non-seed B1 entries in the DB
  for (const q of batch.queries) {
    const normalized = normalizeForStorage(q)
    const fp = sha256Hex(normalized)
    const { rows } = await pool.query(`
      SELECT scope_source, context_fingerprint
      FROM chat_routing_memory_index
      WHERE query_fingerprint = $1
        AND tenant_id = $2 AND user_id = $3
        AND schema_version = $4 AND tool_version = $5
        AND is_deleted = false
        AND scope_source NOT LIKE 'phase3c_seed%'
    `, [fp, OPTION_A_TENANT_ID, OPTION_A_USER_ID, MEMORY_SCHEMA_VERSION, MEMORY_TOOL_VERSION])

    if (rows.length > 0) {
      console.error(`  OVERLAP: "${q}" has ${rows.length} non-seed B1 entry(ies) (scope: ${rows.map((r: Record<string, string>) => r.scope_source).join(', ')})`)
      hasOverlap = true
    }
  }

  return hasOverlap
}

// ---------------------------------------------------------------------------
// Verify
// ---------------------------------------------------------------------------

async function verify(batch: BatchConfig) {
  console.log(`\n--- Verification: ${batch.name} batch (scope_source='${batch.scopeSource}') ---\n`)

  const { rows } = await pool.query(`
    SELECT normalized_query_text, intent_id,
           slots_json->>'itemId' as item_id,
           CASE WHEN semantic_embedding IS NOT NULL THEN 'YES' ELSE 'NO' END as has_embedding,
           success_count, scope_source, created_at
    FROM chat_routing_memory_index
    WHERE scope_source = $1
      AND is_deleted = false
    ORDER BY created_at DESC
  `, [batch.scopeSource])

  if (rows.length === 0) {
    console.log(`No ${batch.scopeSource} entries found.`)
    console.log('Run without --verify to seed entries.')
  } else {
    console.log(`Found ${rows.length} seeded entries:\n`)
    for (const row of rows) {
      console.log(`  "${row.normalized_query_text}"`)
      console.log(`    itemId: ${row.item_id}, embedding: ${row.has_embedding}, count: ${row.success_count}`)
    }
  }

  // B1 safety check for the first query in the batch
  const testQuery = batch.queries[0]
  const testNormalized = normalizeForStorage(testQuery)
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

  console.log(`\n--- B1 exact-hit check for "${testQuery}" ---\n`)
  if (b1Rows.length > 0) {
    const dangerous = b1Rows.filter((r: Record<string, unknown>) =>
      typeof r.scope_source === 'string' && !r.scope_source.startsWith('phase3c_seed')
    )
    if (dangerous.length > 0) {
      console.log(`WARNING: Non-seed B1 entries exist for "${testQuery}":`)
      for (const row of dangerous) {
        console.log(`  scope: ${row.scope_source}, intent: ${row.intent_id}, ctx_fp: ${(row.context_fingerprint as string).slice(0, 12)}...`)
      }
      console.log('\nThese may cause B1 auto-execute, bypassing the clarifier.')
    } else {
      console.log(`Found ${b1Rows.length} entry(ies) with matching query_fingerprint, but all are phase3c_seed*`)
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

async function cleanup(batch: BatchConfig) {
  console.log(`\n--- Cleanup: removing all scope_source='${batch.scopeSource}' entries ---\n`)

  const { rowCount } = await pool.query(`
    DELETE FROM chat_routing_memory_index
    WHERE scope_source = $1
  `, [batch.scopeSource])

  console.log(`Deleted ${rowCount} rows.`)
}

// ---------------------------------------------------------------------------
// Seed
// ---------------------------------------------------------------------------

async function seed(batch: BatchConfig) {
  console.log(`\n--- Seeding ${batch.queries.length} entries for ${batch.name} batch ---\n`)
  console.log(`Target: ${BUDGET200_LABEL} (${BUDGET200_GROUNDING_ID})`)
  console.log(`Scope:  ${batch.scopeSource}`)
  console.log(`Context FP: ${CONTEXT_FINGERPRINT.slice(0, 16)}... (deliberately different from runtime)`)
  console.log(`Mode:   ${dryRun ? 'DRY RUN' : 'LIVE'}\n`)

  // Overlap check (skip in dry-run — still useful to see)
  console.log('--- Overlap check ---\n')
  const hasOverlap = await checkOverlap(batch)
  if (hasOverlap && !dryRun) {
    console.error('\nFAILED: Overlap detected. Resolve before seeding.')
    console.error('Use --dry-run to preview without this check blocking.')
    return
  } else if (hasOverlap) {
    console.log('\n(overlap detected but --dry-run — continuing preview)\n')
  } else {
    console.log('  No overlap found.\n')
  }

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

  for (const rawQuery of batch.queries) {
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
        OPTION_A_TENANT_ID, OPTION_A_USER_ID, batch.scopeSource, 'action_intent',
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
  const batches = resolveBatches()

  try {
    for (const batch of batches) {
      if (cleanupOnly) {
        await cleanup(batch)
      } else if (verifyOnly) {
        await verify(batch)
      } else {
        await seed(batch)
        console.log('\n--- Post-seed verification ---')
        await verify(batch)
      }
    }
  } finally {
    await pool.end()
  }
}

main().catch((err) => {
  console.error('Fatal:', err)
  process.exit(1)
})
