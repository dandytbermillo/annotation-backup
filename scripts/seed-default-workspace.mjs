#!/usr/bin/env node
import pg from 'pg'
import { randomUUID } from 'crypto'

const connectionString =
  process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/annotation_dev'

const userId =
  process.env.NOTE_WORKSPACE_USER_ID ||
  process.env.NEXT_PUBLIC_WORKSPACE_USER_ID ||
  process.env.WORKSPACE_USER_ID

if (!userId) {
  console.error('Missing NOTE_WORKSPACE_USER_ID (or NEXT_PUBLIC_WORKSPACE_USER_ID).')
  process.exit(1)
}

const DEFAULT_NAME = 'Default Workspace'

async function main() {
  const pool = new pg.Pool({ connectionString })
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await client.query(
      `INSERT INTO note_workspaces (user_id, name, payload, is_default)
       VALUES ($1, $2, '{"schemaVersion":"1.0.0","openNotes":[],"activeNoteId":null,"camera":{"x":0,"y":0,"scale":1},"panels":[]}', true)
       ON CONFLICT (user_id) WHERE is_default
       DO UPDATE SET name = EXCLUDED.name, payload = EXCLUDED.payload, is_default = true
       RETURNING id`,
      [userId, DEFAULT_NAME],
    )
    const workspaceId = result.rows[0]?.id
    if (!workspaceId) {
      throw new Error('Failed to upsert default workspace')
    }
    console.log('Default workspace ensured:', { workspaceId, userId })
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    console.error('Failed to ensure default workspace:', error)
    process.exitCode = 1
  } finally {
    client.release()
    await client.pool.end()
  }
}

main()
