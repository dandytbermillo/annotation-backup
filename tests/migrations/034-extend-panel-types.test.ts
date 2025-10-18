/**
 * Migration Test: 034_extend_panel_types
 *
 * Verifies:
 * - Migration can be applied forward (up) successfully
 * - Widget type can be inserted
 * - Migration can be rolled back (down) successfully
 * - Widget type is removed on rollback
 *
 * @see migrations/034_extend_panel_types.up.sql
 * @see migrations/034_extend_panel_types.down.sql
 */

import { Pool } from 'pg'
import * as fs from 'fs'
import * as path from 'path'

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/annotation_dev'
})

const migrationUpPath = path.join(process.cwd(), 'migrations', '034_extend_panel_types.up.sql')
const migrationDownPath = path.join(process.cwd(), 'migrations', '034_extend_panel_types.down.sql')

describe('Migration 034: Extend Panel Types', () => {
  let client: any

  beforeAll(async () => {
    client = await pool.connect()

    // Ensure migration is rolled back
    try {
      // Check if 'widget' type exists and remove it
      const checkWidget = await client.query(`
        SELECT EXISTS (
          SELECT 1 FROM pg_enum
          WHERE enumlabel = 'widget'
            AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'panel_type')
        )
      `)

      if (checkWidget.rows[0].exists) {
        // Remove enum value (PostgreSQL 10+)
        await client.query(`
          ALTER TYPE panel_type RENAME TO panel_type_old;
          CREATE TYPE panel_type AS ENUM ('main', 'branch', 'inspector', 'note', 'link');
          ALTER TABLE panels ALTER COLUMN type TYPE panel_type USING type::text::panel_type;
          DROP TYPE panel_type_old;
        `)
      }
    } catch (error) {
      // Ignore errors - type may not exist or already in correct state
      console.warn('Migration rollback preparation:', error)
    }
  })

  afterAll(async () => {
    // Clean up test data
    await client.query('DELETE FROM panels WHERE note_id LIKE $$test-panel-%$$')
    await client.query('DELETE FROM notes WHERE id LIKE $$test-panel-%$$')
    client.release()
    await pool.end()
  })

  test('should apply migration forward (up) successfully', async () => {
    // Apply migration
    const upSql = fs.readFileSync(migrationUpPath, 'utf8')
    await client.query(upSql)

    // Verify 'widget' type was added
    const enumResult = await client.query(`
      SELECT enumlabel
      FROM pg_enum
      WHERE enumtypid = (SELECT oid FROM pg_type WHERE typname = 'panel_type')
      ORDER BY enumlabel
    `)

    const types = enumResult.rows.map((r: any) => r.enumlabel)
    expect(types).toContain('widget')
    expect(types).toContain('main')
    expect(types).toContain('branch')
    expect(types).toContain('inspector')
  })

  test('should allow inserting widget panel type', async () => {
    // Create test note
    await client.query(
      'INSERT INTO notes (id, title, content) VALUES ($1, $2, $3)',
      ['test-panel-widget', 'Widget Test', '{}']
    )

    // Insert widget panel
    await expect(
      client.query(`
        INSERT INTO panels (note_id, panel_id, type, position_x_world, position_y_world, width_world, height_world, z_index)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `, ['test-panel-widget', 'widget-1', 'widget', 100, 100, 200, 150, 1])
    ).resolves.toBeDefined()

    // Verify widget was inserted
    const widgetResult = await client.query(`
      SELECT panel_id, type
      FROM panels
      WHERE note_id = $1 AND panel_id = $2
    `, ['test-panel-widget', 'widget-1'])

    expect(widgetResult.rows).toHaveLength(1)
    expect(widgetResult.rows[0].type).toBe('widget')
  })

  test('should roll back migration (down) successfully', async () => {
    // Apply down migration
    const downSql = fs.readFileSync(migrationDownPath, 'utf8')
    await client.query(downSql)

    // Verify 'widget' type was removed
    const enumResult = await client.query(`
      SELECT enumlabel
      FROM pg_enum
      WHERE enumtypid = (SELECT oid FROM pg_type WHERE typname = 'panel_type')
      ORDER BY enumlabel
    `)

    const types = enumResult.rows.map((r: any) => r.enumlabel)
    expect(types).not.toContain('widget')
    expect(types).toContain('main')
    expect(types).toContain('branch')
  })

  test('should not allow inserting widget after rollback', async () => {
    // Try to insert widget panel (should fail)
    await client.query(
      'INSERT INTO notes (id, title, content) VALUES ($1, $2, $3)',
      ['test-panel-no-widget', 'No Widget Test', '{}']
    )

    await expect(
      client.query(`
        INSERT INTO panels (note_id, panel_id, type, position_x_world, position_y_world, width_world, height_world, z_index)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `, ['test-panel-no-widget', 'widget-2', 'widget', 200, 200, 200, 150, 1])
    ).rejects.toThrow()
  })
})
