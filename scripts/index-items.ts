#!/usr/bin/env npx tsx
/**
 * CLI script to index all notes into items_knowledge_chunks
 *
 * Usage:
 *   npx tsx scripts/index-items.ts
 *   npm run index:items
 *
 * Options:
 *   --dry-run   Show what would be indexed without making changes
 *   --user-id   Filter to specific user's notes
 */

import { indexAllItems, getChunksCount } from '../lib/docs/items-indexing'
import { serverPool } from '../lib/db/pool'

async function main() {
  const args = process.argv.slice(2)
  const dryRun = args.includes('--dry-run')
  const userIdIndex = args.indexOf('--user-id')
  const userId = userIdIndex !== -1 ? args[userIdIndex + 1] : undefined

  console.log('='.repeat(60))
  console.log('Items Indexing CLI')
  console.log('='.repeat(60))

  if (dryRun) {
    console.log('Mode: DRY RUN (no changes will be made)')
  }

  if (userId) {
    console.log(`Filter: user_id = ${userId}`)
  }

  // Show current state
  const beforeCount = await getChunksCount(userId)
  console.log(`\nCurrent chunks in items_knowledge_chunks: ${beforeCount}`)

  // Count notes to index
  let countQuery = `
    SELECT COUNT(*) as count
    FROM items i
    WHERE i.type = 'note' AND i.deleted_at IS NULL
  `
  const countParams: string[] = []
  if (userId) {
    countQuery += ` AND (i.user_id = $1 OR i.user_id IS NULL)`
    countParams.push(userId)
  }

  const countResult = await serverPool.query(countQuery, countParams)
  const noteCount = parseInt(countResult.rows[0].count, 10)
  console.log(`Notes to process: ${noteCount}`)

  if (dryRun) {
    console.log('\n[DRY RUN] Would index these notes. Run without --dry-run to execute.')
    await serverPool.end()
    process.exit(0)
  }

  if (noteCount === 0) {
    console.log('\nNo notes to index.')
    await serverPool.end()
    process.exit(0)
  }

  console.log('\nStarting indexing...')
  const startTime = Date.now()

  try {
    const result = await indexAllItems(userId)
    const duration = ((Date.now() - startTime) / 1000).toFixed(2)

    console.log('\n' + '='.repeat(60))
    console.log('Indexing Complete')
    console.log('='.repeat(60))
    console.log(`Total notes processed: ${result.total}`)
    console.log(`Successfully indexed: ${result.indexed}`)
    console.log(`Failed: ${result.failed}`)
    console.log(`Duration: ${duration}s`)

    // Show final state
    const afterCount = await getChunksCount(userId)
    console.log(`\nChunks in items_knowledge_chunks: ${afterCount}`)
    console.log(`Change: ${afterCount - beforeCount >= 0 ? '+' : ''}${afterCount - beforeCount}`)

  } catch (error) {
    console.error('\nIndexing failed:', error)
    await serverPool.end()
    process.exit(1)
  }

  await serverPool.end()
  process.exit(0)
}

main().catch(err => {
  console.error('Unexpected error:', err)
  process.exit(1)
})
