/**
 * Integration Test: Search should not return soft-deleted notes
 */

import { Pool } from 'pg'
import { NextRequest } from 'next/server'
import { GET as searchGet } from '@/app/api/search/route'

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/annotation_dev',
})

const TEST_NOTE = '99999999-dead-beef-dead-000000000001'

async function ensureWorkspaceId(client: Pool): Promise<string> {
  const existing = await client.query<{ id: string }>('SELECT id FROM workspaces WHERE is_default = true LIMIT 1')
  if (existing.rowCount > 0) return existing.rows[0].id
  const inserted = await client.query<{ id: string }>(
    `INSERT INTO workspaces (name, is_default) VALUES ('Default Workspace', true)
     ON CONFLICT ON CONSTRAINT only_one_default
     DO UPDATE SET is_default = true
     RETURNING id`,
  )
  return inserted.rows[0].id
}

async function ensureKbRoot(client: Pool, workspaceId: string): Promise<string> {
  const kb = await client.query<{ id: string }>(
    `SELECT id FROM items WHERE path = '/knowledge-base' AND workspace_id = $1 LIMIT 1`,
    [workspaceId],
  )
  if (kb.rowCount > 0) return kb.rows[0].id
  const inserted = await client.query<{ id: string }>(
    `INSERT INTO items (id, type, parent_id, path, name, metadata, workspace_id, created_at, updated_at)
       VALUES (gen_random_uuid(), 'folder', NULL, '/knowledge-base', 'Knowledge Base', '{}'::jsonb, $1, NOW(), NOW())
       ON CONFLICT (path) DO UPDATE SET updated_at = NOW()
       RETURNING id`,
    [workspaceId],
  )
  return inserted.rows[0].id
}

async function seedDeletedNote(client: Pool, workspaceId: string) {
  // cleanup
  await client.query('DELETE FROM document_saves WHERE note_id = $1', [TEST_NOTE])
  await client.query('DELETE FROM panels WHERE note_id = $1', [TEST_NOTE])
  await client.query('DELETE FROM items WHERE id = $1', [TEST_NOTE])
  await client.query('DELETE FROM notes WHERE id = $1', [TEST_NOTE])

  const kbId = await ensureKbRoot(client, workspaceId)

  // insert note + item soft-deleted
  await client.query(
    `INSERT INTO notes (id, title, content_text, search_vector, workspace_id, deleted_at, created_at, updated_at)
     VALUES ($1, 'Deleted Note Search Hit', 'should not show', to_tsvector('english', 'should not show'), $2, NOW(), NOW(), NOW())`,
    [TEST_NOTE, workspaceId],
  )
  await client.query(
    `INSERT INTO items (id, type, parent_id, path, name, workspace_id, deleted_at, created_at, updated_at)
     VALUES ($1, 'note', $3, '/knowledge-base/Deleted Note Search Hit', 'Deleted Note Search Hit', $2, NOW(), NOW(), NOW())`,
    [TEST_NOTE, workspaceId, kbId],
  )
}

describe('Search filters soft-deleted notes', () => {
  let workspaceId: string

  beforeAll(async () => {
    workspaceId = await ensureWorkspaceId(pool)
  })

  afterAll(async () => {
    await pool.end()
  })

  it('does not return deleted notes in GET /api/search?q=', async () => {
    const client = await pool.connect()
    try {
      await seedDeletedNote(client, workspaceId)
    } finally {
      client.release()
    }

    const request = new NextRequest(`http://localhost:3000/api/search?q=Deleted%20Note%20Search%20Hit`, {
      method: 'GET',
    })

    const response = await searchGet(request)
    const result = await response.json()

    expect(response.status).toBe(200)
    const notes = result?.results?.notes?.items ?? []
    const docs = result?.results?.documents?.items ?? []
    const branches = result?.results?.branches?.items ?? []

    expect(notes.find((n: any) => n.id === TEST_NOTE)).toBeUndefined()
    expect(docs.find((d: any) => d.note_id === TEST_NOTE)).toBeUndefined()
    expect(branches.find((b: any) => b.note_id === TEST_NOTE)).toBeUndefined()
  })
})
