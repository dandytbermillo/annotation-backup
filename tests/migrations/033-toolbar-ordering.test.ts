/**
 * Migration Test: 033_add_toolbar_ordering
 *
 * Verifies:
 * - Migration can be applied forward (up) successfully
 * - Backfill assigns correct toolbar_sequence values
 * - Constraints are enforced after backfill
 * - Migration can be rolled back (down) successfully
 * - Indexes are created and dropped correctly
 *
 * @see migrations/033_add_toolbar_ordering.up.sql
 * @see migrations/033_add_toolbar_ordering.down.sql
 */

import { Pool } from 'pg'
import * as fs from 'fs'
import * as path from 'path'

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/annotation_dev'
})

const migrationUpPath = path.join(process.cwd(), 'migrations', '033_add_toolbar_ordering.up.sql')
const migrationDownPath = path.join(process.cwd(), 'migrations', '033_add_toolbar_ordering.down.sql')

describe('Migration 033: Add Toolbar Ordering', () => {
  let client: any

  beforeAll(async () => {
    client = await pool.connect()

    // Ensure migration is rolled back
    try {
      await client.query('ALTER TABLE canvas_workspace_notes DROP COLUMN IF EXISTS toolbar_sequence CASCADE')
      await client.query('ALTER TABLE canvas_workspace_notes DROP COLUMN IF EXISTS is_focused CASCADE')
      await client.query('ALTER TABLE canvas_workspace_notes DROP COLUMN IF EXISTS opened_at CASCADE')
    } catch (error) {
      // Ignore errors - columns may not exist
    }
  })

  afterAll(async () => {
    // Clean up test data
    await client.query('DELETE FROM canvas_workspace_notes WHERE note_id LIKE $$test-migration-%$$')
    await client.query('DELETE FROM notes WHERE id LIKE $$test-migration-%$$')
    client.release()
    await pool.end()
  })

  test('should apply migration forward (up) successfully', async () => {
    // Insert test data before migration
    await client.query(
      'INSERT INTO notes (id, title, content) VALUES ($1, $2, $3), ($4, $5, $6)',
      [
        'test-migration-1', 'Migration Test 1', '{}',
        'test-migration-2', 'Migration Test 2', '{}'
      ]
    )

    await client.query(
      `INSERT INTO canvas_workspace_notes (note_id, is_open, main_position_x, main_position_y)
       VALUES ($1, $2, $3, $4), ($5, $6, $7, $8)`,
      [
        'test-migration-1', true, 100, 100,
        'test-migration-2', false, 200, 200
      ]
    )

    // Apply migration
    const upSql = fs.readFileSync(migrationUpPath, 'utf8')
    await client.query(upSql)

    // Verify columns were added
    const columnsResult = await client.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'canvas_workspace_notes'
        AND column_name IN ('toolbar_sequence', 'is_focused', 'opened_at')
      ORDER BY column_name
    `)

    expect(columnsResult.rows).toHaveLength(3)
    expect(columnsResult.rows[0].column_name).toBe('is_focused')
    expect(columnsResult.rows[0].data_type).toBe('boolean')
    expect(columnsResult.rows[1].column_name).toBe('opened_at')
    expect(columnsResult.rows[2].column_name).toBe('toolbar_sequence')

    // Verify backfill assigned toolbar_sequence correctly
    const dataResult = await client.query(`
      SELECT note_id, toolbar_sequence, is_focused
      FROM canvas_workspace_notes
      WHERE note_id IN ($1, $2) AND is_open = TRUE
      ORDER BY toolbar_sequence
    `, ['test-migration-1', 'test-migration-2'])

    expect(dataResult.rows).toHaveLength(1) // Only test-migration-1 is open
    expect(dataResult.rows[0].note_id).toBe('test-migration-1')
    expect(dataResult.rows[0].toolbar_sequence).toBe(0)
    expect(dataResult.rows[0].is_focused).toBe(true) // First note should be focused
  })

  test('should enforce constraint: open notes must have toolbar_sequence', async () => {
    // Try to insert open note without toolbar_sequence (should fail)
    await expect(
      client.query(`
        INSERT INTO canvas_workspace_notes (note_id, is_open, main_position_x, main_position_y)
        VALUES ($1, $2, $3, $4)
      `, ['test-migration-3', true, 300, 300])
    ).rejects.toThrow()
  })

  test('should enforce unique toolbar_sequence for open notes', async () => {
    // Try to insert duplicate toolbar_sequence (should fail)
    await client.query(
      'INSERT INTO notes (id, title, content) VALUES ($1, $2, $3)',
      ['test-migration-4', 'Test Duplicate', '{}']
    )

    await expect(
      client.query(`
        INSERT INTO canvas_workspace_notes (note_id, is_open, toolbar_sequence, main_position_x, main_position_y)
        VALUES ($1, $2, $3, $4, $5)
      `, ['test-migration-4', true, 0, 400, 400])
    ).rejects.toThrow()
  })

  test('should enforce only one focused note at a time', async () => {
    // Try to insert second focused note (should fail)
    await client.query(
      'INSERT INTO notes (id, title, content) VALUES ($1, $2, $3)',
      ['test-migration-5', 'Test Focused', '{}']
    )

    await expect(
      client.query(`
        INSERT INTO canvas_workspace_notes (note_id, is_open, toolbar_sequence, is_focused, main_position_x, main_position_y)
        VALUES ($1, $2, $3, $4, $5, $6)
      `, ['test-migration-5', true, 1, true, 500, 500])
    ).rejects.toThrow()
  })

  test('should roll back migration (down) successfully', async () => {
    // Apply down migration
    const downSql = fs.readFileSync(migrationDownPath, 'utf8')
    await client.query(downSql)

    // Verify columns were removed
    const columnsResult = await client.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'canvas_workspace_notes'
        AND column_name IN ('toolbar_sequence', 'is_focused', 'opened_at')
    `)

    expect(columnsResult.rows).toHaveLength(0)

    // Verify indexes were dropped
    const indexesResult = await client.query(`
      SELECT indexname
      FROM pg_indexes
      WHERE tablename = 'canvas_workspace_notes'
        AND indexname IN ('idx_toolbar_sequence_unique', 'idx_canvas_workspace_notes_focused')
    `)

    expect(indexesResult.rows).toHaveLength(0)

    // Verify constraint was dropped
    const constraintsResult = await client.query(`
      SELECT constraint_name
      FROM information_schema.table_constraints
      WHERE table_name = 'canvas_workspace_notes'
        AND constraint_name = 'check_open_notes_have_sequence'
    `)

    expect(constraintsResult.rows).toHaveLength(0)
  })
})
