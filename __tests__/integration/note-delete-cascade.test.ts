/**
 * Integration Test: Canonical note deletion cascade
 *
 * Verifies DELETE /api/postgres-offline/notes/[id] soft-deletes notes/items/panels
 * and hard-deletes document_saves so reload cannot resurrect them.
 */

import { Pool } from 'pg'
import { NextRequest } from 'next/server'
import { DELETE as deleteNote } from '@/app/api/postgres-offline/notes/[id]/route'

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/annotation_dev',
})

const TEST_NOTE = '99999999-aaaa-bbbb-cccc-000000000001'
const TEST_PANEL_ID = 'test-panel-delete'

async function getWorkspaceId(client: Pool): Promise<string> {
  const res = await client.query<{ id: string }>(
    'SELECT id FROM workspaces WHERE is_default = true LIMIT 1',
  )
  if (res.rowCount > 0) return res.rows[0].id

  const inserted = await client.query<{ id: string }>(
    `INSERT INTO workspaces (name, is_default)
     VALUES ('Default Workspace', true)
     ON CONFLICT ON CONSTRAINT only_one_default
     DO UPDATE SET is_default = true
     RETURNING id`,
  )
  return inserted.rows[0].id
}

async function seedNote(client: Pool, workspaceId: string) {
  // Clean any leftovers from prior runs
  await client.query('DELETE FROM document_saves WHERE note_id = $1', [TEST_NOTE])
  await client.query('DELETE FROM panels WHERE note_id = $1', [TEST_NOTE])
  await client.query('DELETE FROM items WHERE id = $1', [TEST_NOTE])
  await client.query('DELETE FROM notes WHERE id = $1', [TEST_NOTE])

  // Ensure Knowledge Base root exists (enforced path constraint)
  const kb = await client.query<{ id: string }>(
    `SELECT id FROM items WHERE path = '/knowledge-base' AND type = 'folder' LIMIT 1`,
  )
  let kbId = kb.rows[0]?.id
  if (!kbId) {
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO items (type, parent_id, path, name, metadata, workspace_id, created_at, updated_at)
         VALUES ('folder', NULL, '/knowledge-base', 'Knowledge Base', '{}'::jsonb, $1, NOW(), NOW())
         ON CONFLICT (path) DO UPDATE SET updated_at = NOW()
         RETURNING id`,
      [workspaceId],
    )
    kbId = inserted.rows[0].id
  }

  // Seed note + item
  await client.query(
    `INSERT INTO notes (id, title, workspace_id, created_at, updated_at)
     VALUES ($1, 'Delete Me', $2, NOW(), NOW())`,
    [TEST_NOTE, workspaceId],
  )
  await client.query(
    `INSERT INTO items (id, type, parent_id, path, name, metadata, workspace_id, created_at, updated_at)
     VALUES ($1, 'note', $3, '/knowledge-base/Delete Me', 'Delete Me', '{}'::jsonb, $2, NOW(), NOW())`,
    [TEST_NOTE, workspaceId, kbId],
  )

  // Seed panel (non-main) to verify soft delete
  await client.query(
    `INSERT INTO panels (
        id, note_id, panel_id, position, dimensions,
        position_x_world, position_y_world, width_world, height_world,
        state, title, type, workspace_id, last_accessed, created_at, updated_at
     ) VALUES (
        gen_random_uuid(), $1, $2,
        '{"x":0,"y":0}'::jsonb, '{"width":300,"height":200}'::jsonb,
        0, 0, 300, 200,
        'active', 'Test Panel', 'editor',
        $3, NOW(), NOW(), NOW()
     )`,
    [TEST_NOTE, TEST_PANEL_ID, workspaceId],
  )

  // Seed a document_saves row
  await client.query(
    `INSERT INTO document_saves
       (note_id, panel_id, content, document_text, search_tsv, version, workspace_id, created_at)
     VALUES
       ($1, NULL, '{}'::jsonb, '', to_tsvector('english', ''), 1, $2, NOW())`,
    [TEST_NOTE, workspaceId],
  )
}

describe('Note deletion cascade', () => {
  let workspaceId: string

  beforeAll(async () => {
    workspaceId = await getWorkspaceId(pool)
  })

  afterAll(async () => {
    await pool.end()
  })

  it('soft-deletes note/items/panels and clears document_saves', async () => {
    const client = await pool.connect()
    try {
      await seedNote(client, workspaceId)
    } finally {
      client.release()
    }

    const request = new NextRequest(
      `http://localhost:3000/api/postgres-offline/notes/${TEST_NOTE}`,
      {
        method: 'DELETE',
        body: JSON.stringify({ workspaceId }),
        headers: { 'Content-Type': 'application/json' },
      },
    )

    const response = await deleteNote(request, {
      params: Promise.resolve({ id: TEST_NOTE }),
    })
    const result = await response.json()

    expect(response.status).toBe(200)
    expect(result.success).toBe(true)
    expect(result.deletedNote).toBe(true)

    const verify = await pool.connect()
    try {
      const noteRow = await verify.query(
        'SELECT deleted_at FROM notes WHERE id = $1',
        [TEST_NOTE],
      )
      expect(noteRow.rowCount).toBe(1)
      expect(noteRow.rows[0].deleted_at).not.toBeNull()

      const itemRow = await verify.query(
        'SELECT deleted_at FROM items WHERE id = $1',
        [TEST_NOTE],
      )
      expect(itemRow.rowCount).toBe(1)
      expect(itemRow.rows[0].deleted_at).not.toBeNull()

      const panelRow = await verify.query(
        'SELECT deleted_at FROM panels WHERE note_id = $1',
        [TEST_NOTE],
      )
      expect(panelRow.rowCount).toBe(1)
      expect(panelRow.rows[0].deleted_at).not.toBeNull()

      const docSaveCount = await verify.query(
        'SELECT COUNT(*)::int AS count FROM document_saves WHERE note_id = $1',
        [TEST_NOTE],
      )
      expect(docSaveCount.rows[0].count).toBe(0)
    } finally {
      verify.release()
    }
  })
})
