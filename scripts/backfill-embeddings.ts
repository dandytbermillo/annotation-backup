#!/usr/bin/env npx tsx
/**
 * Backfill Embeddings — Phase 3
 *
 * Populates semantic_embedding for existing memory entries (from Phase 2 B1)
 * that currently have NULL embeddings.
 *
 * Usage:
 *   npx tsx scripts/backfill-embeddings.ts                    # All rows
 *   npx tsx scripts/backfill-embeddings.ts --dry-run           # Count only
 *   npx tsx scripts/backfill-embeddings.ts --limit 50          # First 50 rows
 *   npx tsx scripts/backfill-embeddings.ts --after-id <uuid>   # Resume after specific row
 *   npx tsx scripts/backfill-embeddings.ts --after-id <uuid> --limit 100  # Resume + cap
 *
 * After backfill:
 *   ANALYZE chat_routing_memory_index;
 *   REINDEX INDEX CONCURRENTLY idx_chat_routing_memory_index_semantic;
 */

import { Pool } from 'pg'
import OpenAI from 'openai'
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const EMBEDDING_MODEL = 'text-embedding-3-small'
const EMBEDDING_MODEL_VERSION = 'openai:text-embedding-3-small@v1'
const BATCH_SIZE = 20
const BATCH_DELAY_MS = 100

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const limitIdx = args.indexOf('--limit')
const limit = limitIdx !== -1 ? parseInt(args[limitIdx + 1], 10) : Infinity
const afterIdx = args.indexOf('--after-id')
const afterId = afterIdx !== -1 ? args[afterIdx + 1] : null

// ---------------------------------------------------------------------------
// Database
// ---------------------------------------------------------------------------

function getDatabaseUrl(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL
  const user = process.env.POSTGRES_USER || 'postgres'
  const password = process.env.POSTGRES_PASSWORD || 'postgres'
  const host = process.env.POSTGRES_HOST || 'localhost'
  const port = process.env.POSTGRES_PORT || '5432'
  const database = process.env.POSTGRES_DB || 'annotation_dev'
  return `postgresql://${user}:${password}@${host}:${port}/${database}`
}

// ---------------------------------------------------------------------------
// OpenAI client
// ---------------------------------------------------------------------------

function getApiKey(): string {
  const envKey = process.env.OPENAI_API_KEY
  if (envKey && envKey.startsWith('sk-') && envKey.length > 40) return envKey

  try {
    const secretsPath = join(process.cwd(), 'config', 'secrets.json')
    if (existsSync(secretsPath)) {
      const secrets = JSON.parse(readFileSync(secretsPath, 'utf-8'))
      if (secrets.OPENAI_API_KEY) return secrets.OPENAI_API_KEY
    }
  } catch { /* ignore */ }

  throw new Error('OPENAI_API_KEY not found in env or config/secrets.json')
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const pool = new Pool({ connectionString: getDatabaseUrl() })
  const openai = new OpenAI({ apiKey: getApiKey() })

  try {
    // Count rows to backfill
    const countSql = afterId
      ? `SELECT COUNT(*) FROM chat_routing_memory_index WHERE semantic_embedding IS NULL AND is_deleted = false AND id > $1`
      : `SELECT COUNT(*) FROM chat_routing_memory_index WHERE semantic_embedding IS NULL AND is_deleted = false`
    const countResult = await pool.query(countSql, afterId ? [afterId] : [])
    const totalRows = Number(countResult.rows[0].count)

    console.log(`Found ${totalRows} rows with NULL embedding${afterId ? ` (after id ${afterId})` : ''}`)
    const rowsToProcess = Math.min(totalRows, limit)
    console.log(`Will process: ${rowsToProcess} rows (batch size: ${BATCH_SIZE})`)

    if (dryRun) {
      console.log('DRY RUN — no changes made')
      return
    }

    if (rowsToProcess === 0) {
      console.log('Nothing to backfill')
      return
    }

    // Fetch rows in batches
    let processed = 0
    let lastId = afterId

    while (processed < rowsToProcess) {
      const batchLimit = Math.min(BATCH_SIZE, rowsToProcess - processed)
      const fetchSql = lastId
        ? `SELECT id, normalized_query_text FROM chat_routing_memory_index WHERE semantic_embedding IS NULL AND is_deleted = false AND id > $1 ORDER BY id ASC LIMIT $2`
        : `SELECT id, normalized_query_text FROM chat_routing_memory_index WHERE semantic_embedding IS NULL AND is_deleted = false ORDER BY id ASC LIMIT $1`
      const fetchResult = await pool.query(fetchSql, lastId ? [lastId, batchLimit] : [batchLimit])

      if (fetchResult.rows.length === 0) break

      const rows = fetchResult.rows as Array<{ id: string; normalized_query_text: string }>
      const texts = rows.map(r => r.normalized_query_text)

      // Batch embedding call
      try {
        const response = await openai.embeddings.create({
          model: EMBEDDING_MODEL,
          input: texts,
        })

        // Update each row
        for (const item of response.data) {
          const row = rows[item.index]
          if (!row) continue
          const embedding = item.embedding
          const embeddingParam = `[${embedding.join(',')}]`

          await pool.query(
            `UPDATE chat_routing_memory_index SET semantic_embedding = $1, embedding_model_version = $2, updated_at = now() WHERE id = $3`,
            [embeddingParam, EMBEDDING_MODEL_VERSION, row.id],
          )
        }

        processed += rows.length
        lastId = rows[rows.length - 1].id
        console.log(`  Batch done: ${processed}/${rowsToProcess} (last id: ${lastId})`)
      } catch (err: unknown) {
        console.error(`  Batch failed at id ${rows[0].id}:`, (err as Error).message)
        console.error(`  Resume with: --after-id ${lastId ?? rows[0].id}`)
        throw err
      }

      // Rate limit
      if (processed < rowsToProcess) {
        await new Promise(resolve => setTimeout(resolve, BATCH_DELAY_MS))
      }
    }

    console.log(`\nBackfill complete: ${processed} rows updated`)
    console.log('Run the following to optimize the index:')
    console.log('  ANALYZE chat_routing_memory_index;')
    console.log('  REINDEX INDEX CONCURRENTLY idx_chat_routing_memory_index_semantic;')
  } finally {
    await pool.end()
  }
}

main().catch(err => {
  console.error('Backfill failed:', err)
  process.exit(1)
})
