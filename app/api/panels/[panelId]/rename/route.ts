import { NextRequest, NextResponse } from 'next/server'
import { serverPool } from '@/lib/db/pool'

// POST /api/panels/[panelId]/rename - Atomic rename across all tables
//
// TODO: Multi-user hardening (when adding collaboration):
//   - Add SELECT ... FOR UPDATE to prevent concurrent rename races
//   - Verify panel.note_id matches request noteId (row ownership check)
//   - Add workspace authorization to ensure user has permission
//   - Include previous title/version for optimistic locking
//
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ panelId: string }> }
) {
  const client = await serverPool.connect()

  try {
    const { panelId } = await params
    const { noteId, newTitle } = await request.json()

    if (!noteId || !newTitle?.trim()) {
      return NextResponse.json(
        { error: 'noteId and newTitle are required' },
        { status: 400 }
      )
    }

    const trimmedTitle = newTitle.trim()

    // BEGIN TRANSACTION - all or nothing
    await client.query('BEGIN')

    try {
      // 1. Update notes table (canonical source)
      const notesResult = await client.query(
        `UPDATE notes
         SET title = $1, updated_at = NOW()
         WHERE id = $2
         RETURNING id, title, updated_at`,
        [trimmedTitle, noteId]
      )

      if (notesResult.rows.length === 0) {
        throw new Error('Note not found')
      }

      // 2. Update panels table (layout/state)
      await client.query(
        `UPDATE panels
         SET title = $1, updated_at = NOW()
         WHERE note_id = $2 AND panel_id = $3`,
        [trimmedTitle, noteId, panelId]
      )

      // If no panel exists, create it
      const panelCheck = await client.query(
        'SELECT id FROM panels WHERE note_id = $1 AND panel_id = $2',
        [noteId, panelId]
      )

      if (panelCheck.rows.length === 0) {
        // Get workspace_id from note
        const noteResult = await client.query(
          'SELECT workspace_id FROM notes WHERE id = $1',
          [noteId]
        )

        if (noteResult.rows.length > 0) {
          await client.query(
            `INSERT INTO panels (id, note_id, panel_id, title, workspace_id, position, dimensions, state, type, last_accessed)
             VALUES (gen_random_uuid(), $1, $2, $3, $4, $5::jsonb, $6::jsonb, 'active', 'editor', NOW())`,
            [
              noteId,
              panelId,
              trimmedTitle,
              noteResult.rows[0].workspace_id,
              JSON.stringify({ x: 0, y: 0 }),
              JSON.stringify({ width: 800, height: 600 })
            ]
          )
        }
      }

      // 3. Update items table (knowledge tree/popup overlay)
      await client.query(
        `UPDATE items
         SET name = $1, updated_at = NOW()
         WHERE id = $2`,
        [trimmedTitle, noteId]
      )

      // COMMIT - all updates succeeded
      await client.query('COMMIT')

      return NextResponse.json({
        success: true,
        title: trimmedTitle,
        noteId,
        panelId,
        updatedAt: notesResult.rows[0].updated_at
      })

    } catch (txError) {
      // ROLLBACK on any error
      await client.query('ROLLBACK')
      throw txError
    }

  } catch (error) {
    console.error('[POST /api/panels/[panelId]/rename] Error:', error)
    return NextResponse.json(
      {
        error: 'Failed to rename panel',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    )
  } finally {
    client.release()
  }
}
