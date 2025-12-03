import { NextRequest, NextResponse } from 'next/server'
import { serverPool } from '@/lib/db/pool'
import { resolveNoteWorkspaceUserId } from '@/app/api/note-workspaces/user-id'

/**
 * POST /api/dashboard/quick-capture
 * Create a quick capture note in the user's designated entry
 */
export async function POST(request: NextRequest) {
  const client = await serverPool.connect()

  try {
    const userId = resolveNoteWorkspaceUserId(request)
    if (userId === 'invalid') {
      return NextResponse.json({ error: 'Invalid userId' }, { status: 400 })
    }

    const body = await request.json()
    const { title, content, destinationEntryId } = body

    if (!title || !content) {
      return NextResponse.json(
        { error: 'Title and content are required' },
        { status: 400 }
      )
    }

    await client.query('BEGIN')

    // Get the destination entry - either provided or from user preferences
    let entryId = destinationEntryId

    if (!entryId) {
      // Get from user preferences
      const prefResult = await client.query(
        'SELECT quick_capture_entry_id FROM user_preferences WHERE user_id = $1',
        [userId]
      )

      if (prefResult.rows.length > 0 && prefResult.rows[0].quick_capture_entry_id) {
        entryId = prefResult.rows[0].quick_capture_entry_id
      } else {
        // Fall back to Ideas Inbox
        const inboxResult = await client.query(
          `SELECT i.id FROM items i
           JOIN items home ON i.parent_id = home.id
           WHERE home.is_system = TRUE
             AND home.name = 'Home'
             AND home.user_id = $1
             AND i.name = 'Ideas Inbox'
           LIMIT 1`,
          [userId]
        )

        if (inboxResult.rows.length > 0) {
          entryId = inboxResult.rows[0].id
        }
      }
    }

    if (!entryId) {
      await client.query('ROLLBACK')
      return NextResponse.json(
        { error: 'No destination entry configured. Please set up your Ideas Inbox.' },
        { status: 400 }
      )
    }

    // Get the entry path for the new note
    const entryResult = await client.query(
      'SELECT path FROM items WHERE id = $1 AND deleted_at IS NULL',
      [entryId]
    )

    if (entryResult.rows.length === 0) {
      await client.query('ROLLBACK')
      return NextResponse.json(
        { error: 'Destination entry not found' },
        { status: 404 }
      )
    }

    const entryPath = entryResult.rows[0].path

    // Generate a unique name for the note
    const timestamp = new Date().toISOString().slice(0, 19).replace('T', ' ')
    let noteName = title
    let counter = 0

    // Check for duplicates and generate unique name
    while (true) {
      const nameToCheck = counter === 0 ? noteName : `${noteName} (${counter})`
      const existing = await client.query(
        `SELECT id FROM items
         WHERE parent_id = $1
           AND LOWER(name) = LOWER($2)
           AND deleted_at IS NULL`,
        [entryId, nameToCheck]
      )

      if (existing.rows.length === 0) {
        noteName = nameToCheck
        break
      }

      counter++
      if (counter > 100) {
        noteName = `${title} - ${timestamp}`
        break
      }
    }

    const notePath = `${entryPath}/${noteName}`

    // Create the note item
    const createItemResult = await client.query(
      `INSERT INTO items (
        type, parent_id, path, name, content,
        metadata, position, last_accessed_at,
        created_at, updated_at
      ) VALUES (
        'note', $1, $2, $3, $4,
        $5::jsonb, 0, NOW(),
        NOW(), NOW()
      )
      RETURNING id, path, name, created_at`,
      [
        entryId,
        notePath,
        noteName,
        content,
        JSON.stringify({ quickCapture: true, capturedAt: timestamp }),
      ]
    )

    const newItem = createItemResult.rows[0]

    // Also create a notes table entry if it exists
    try {
      await client.query(
        `INSERT INTO notes (id, title, metadata, created_at, updated_at)
         VALUES ($1, $2, $3, NOW(), NOW())
         ON CONFLICT (id) DO UPDATE SET
           title = EXCLUDED.title,
           metadata = EXCLUDED.metadata,
           updated_at = NOW()`,
        [
          newItem.id,
          noteName,
          JSON.stringify({ quickCapture: true }),
        ]
      )
    } catch {
      // Notes table might not exist or have different schema
      // Continue anyway since item was created
    }

    await client.query('COMMIT')

    return NextResponse.json({
      success: true,
      noteId: newItem.id,
      noteName: newItem.name,
      notePath: newItem.path,
      createdAt: newItem.created_at,
    }, { status: 201 })
  } catch (error) {
    await client.query('ROLLBACK')
    console.error('[dashboard/quick-capture] Error:', error)
    return NextResponse.json(
      { error: 'Failed to create note' },
      { status: 500 }
    )
  } finally {
    client.release()
  }
}
