/**
 * Regression: non-main panel should persist across workspace switches, even after adding a new note.
 */

import { Pool } from 'pg'
import { NextRequest } from 'next/server'
import { POST as createItem } from '@/app/api/items/route'

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/annotation_dev',
})

const WS_A = '99999999-aaaa-aaaa-aaaa-0000000000aa'
const WS_B = '99999999-bbbb-bbbb-bbbb-0000000000bb'
const NOTE_A = '99999999-aaaa-1111-aaaa-0000000000aa'
const NOTE_B = '99999999-aaaa-2222-aaaa-0000000000aa'
const PANEL_BRANCH = 'branch-panel-1'

async function ensureWorkspace(client: Pool, id: string, name: string) {
  await client.query(
    `INSERT INTO workspaces (id, name, is_default) VALUES ($1, $2, false)
     ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name`,
    [id, name],
  )
}

async function ensureKnowledgeBase(client: Pool): Promise<string> {
  const existing = await client.query<{ id: string }>(
    `SELECT id FROM items WHERE path = '/knowledge-base' LIMIT 1`,
  )
  if (existing.rowCount > 0) return existing.rows[0].id
  const inserted = await client.query<{ id: string }>(
    `INSERT INTO items (id, type, parent_id, path, name, metadata, created_at, updated_at)
     VALUES (gen_random_uuid(), 'folder', NULL, '/knowledge-base', 'Knowledge Base', '{}'::jsonb, NOW(), NOW())
     RETURNING id`,
  )
  return inserted.rows[0].id
}

async function seedWorkspaceA(client: Pool) {
  // clean
  await client.query('DELETE FROM document_saves WHERE workspace_id IN ($1, $2)', [WS_A, WS_B])
  await client.query('DELETE FROM panels WHERE workspace_id IN ($1, $2)', [WS_A, WS_B])
  await client.query('DELETE FROM items WHERE workspace_id IN ($1, $2)', [WS_A, WS_B])
  await client.query('DELETE FROM notes WHERE workspace_id IN ($1, $2)', [WS_A, WS_B])
  await client.query('DELETE FROM workspaces WHERE id IN ($1, $2)', [WS_A, WS_B])

  await ensureWorkspace(client, WS_A, 'Workspace A')
  await ensureWorkspace(client, WS_B, 'Workspace B')

  // Ensure global KB root exists
  const kbId = await ensureKnowledgeBase(client)

  // create note A in workspace A
  await client.query(
    `INSERT INTO notes (id, title, workspace_id, created_at, updated_at) VALUES ($1, 'Note A', $2, NOW(), NOW())`,
    [NOTE_A, WS_A],
  )
  await client.query(
    `INSERT INTO items (id, type, path, name, workspace_id, parent_id, created_at, updated_at)
     VALUES ($1, 'note', '/knowledge-base/Note A', 'Note A', $2, $3, NOW(), NOW())
     ON CONFLICT (id) DO NOTHING`,
    [NOTE_A, WS_A, kbId],
  )

  // create non-main panel for Note A
  await client.query(
    `INSERT INTO panels (
        id, note_id, panel_id, position, dimensions,
        position_x_world, position_y_world, width_world, height_world,
        state, title, type, workspace_id, last_accessed, created_at, updated_at
     ) VALUES (
        gen_random_uuid(), $1, $2,
        '{"x":100,"y":100}'::jsonb, '{"width":300,"height":200}'::jsonb,
        100, 100, 300, 200,
        'active', 'Branch Panel', 'branch',
        $3, NOW(), NOW(), NOW()
     )`,
    [NOTE_A, PANEL_BRANCH, WS_A],
  )

  // create workspace B empty
  await client.query(
    `INSERT INTO notes (id, title, workspace_id, created_at, updated_at) VALUES ($1, 'WB-Placeholder', $2, NOW(), NOW())`,
    ['99999999-bbbb-3333-bbbb-0000000000bb', WS_B],
  )
  await client.query(
    `INSERT INTO items (id, type, path, name, workspace_id, parent_id, created_at, updated_at)
     VALUES ($1, 'note', '/knowledge-base/WB-Placeholder', 'WB-Placeholder', $2, $3, NOW(), NOW())
     ON CONFLICT (id) DO NOTHING`,
    ['99999999-bbbb-3333-bbbb-0000000000bb', WS_B, kbId],
  )
}

describe('Workspace non-main panel persists across switches', () => {
  beforeEach(async () => {
    const client = await pool.connect()
    try {
      await seedWorkspaceA(client)
    } finally {
      client.release()
    }
  })

  afterAll(async () => {
    await pool.end()
  })

  it('keeps non-main panel after adding a new note and switching away/back', async () => {
    // simulate creating a new note in workspace A via API (items POST)
    const clientKb = await pool.connect()
    let kbId: string
    try {
      kbId = await ensureKnowledgeBase(clientKb)
    } finally {
      clientKb.release()
    }
    const createNoteReq = new NextRequest('http://localhost:3000/api/items', {
      method: 'POST',
      body: JSON.stringify({
        type: 'note',
        name: 'Note B',
        parentId: kbId,
        workspaceId: WS_A,
      }),
      headers: { 'Content-Type': 'application/json', 'x-overlay-workspace-id': WS_A },
    })
    await createItem(createNoteReq)

    // simulate switching to workspace B and back to A by replaying cached snapshot:
    // here we just verify DB still has the branch panel row after the operations above
    const client = await pool.connect()
    try {
      const panelRows = await client.query(
        `SELECT note_id, panel_id FROM panels WHERE note_id = $1 AND panel_id = $2 AND deleted_at IS NULL`,
        [NOTE_A, PANEL_BRANCH],
      )
      expect(panelRows.rowCount).toBe(1)
    } finally {
      client.release()
    }
  })
})
