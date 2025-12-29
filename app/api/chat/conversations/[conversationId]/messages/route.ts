import { NextRequest, NextResponse } from 'next/server'
import { serverPool } from '@/lib/db/pool'
import { getChatUserId } from '@/app/api/chat/user-id'

const MAX_LIMIT = 50
const DEFAULT_LIMIT = 30

/**
 * GET /api/chat/conversations/[conversationId]/messages
 * Paginate messages for a conversation, newest first.
 *
 * Query params:
 *   - cursor: string (format: "ISO_TIMESTAMP,UUID" - created_at,id of last message)
 *   - limit: number (default 30, max 50)
 *
 * Returns:
 *   - messages: array of { id, role, content, metadata, createdAt }
 *   - nextCursor: string | null (for pagination)
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ conversationId: string }> }
) {
  try {
    // v1: Single-user, always use server-side constant
    const userId = getChatUserId()

    const { conversationId } = await params
    const { searchParams } = new URL(request.url)
    const cursor = searchParams.get('cursor')
    const limitParam = searchParams.get('limit')
    const limit = Math.min(
      parseInt(limitParam || String(DEFAULT_LIMIT), 10) || DEFAULT_LIMIT,
      MAX_LIMIT
    )

    // Verify conversation exists and belongs to user
    const convResult = await serverPool.query(
      `SELECT id FROM chat_conversations WHERE id = $1 AND user_id = $2`,
      [conversationId, userId]
    )

    if (convResult.rows.length === 0) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
    }

    // Build query with cursor-based pagination
    let query: string
    let queryParams: (string | number)[]

    if (cursor) {
      // Parse cursor: "ISO_TIMESTAMP,UUID"
      const [cursorTimestamp, cursorId] = cursor.split(',')
      if (!cursorTimestamp || !cursorId) {
        return NextResponse.json({ error: 'Invalid cursor format' }, { status: 400 })
      }

      // Get messages older than cursor (for "load older" pagination)
      query = `
        SELECT id, role, content, metadata, created_at
        FROM chat_messages
        WHERE conversation_id = $1
          AND (created_at, id) < ($2::timestamptz, $3::uuid)
        ORDER BY created_at DESC, id DESC
        LIMIT $4
      `
      queryParams = [conversationId, cursorTimestamp, cursorId, limit + 1]
    } else {
      // Get most recent messages
      query = `
        SELECT id, role, content, metadata, created_at
        FROM chat_messages
        WHERE conversation_id = $1
        ORDER BY created_at DESC, id DESC
        LIMIT $2
      `
      queryParams = [conversationId, limit + 1]
    }

    const result = await serverPool.query(query, queryParams)
    const rows = result.rows

    // Determine if there are more messages
    const hasMore = rows.length > limit
    const messages = rows.slice(0, limit).map((row) => ({
      id: row.id,
      role: row.role,
      content: row.content,
      metadata: row.metadata,
      createdAt: row.created_at,
    }))

    // Build next cursor from the oldest message in this batch
    let nextCursor: string | null = null
    if (hasMore && messages.length > 0) {
      const oldest = messages[messages.length - 1]
      nextCursor = `${oldest.createdAt.toISOString()},${oldest.id}`
    }

    // Reverse to return chronological order (oldest first in the batch)
    // This makes it easier for the client to render in order
    messages.reverse()

    return NextResponse.json({
      messages,
      nextCursor,
    })
  } catch (error) {
    console.error('[chat/messages GET] Error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch messages' },
      { status: 500 }
    )
  }
}

/**
 * POST /api/chat/conversations/[conversationId]/messages
 * Append a message to the conversation.
 *
 * Body:
 *   - role: 'user' | 'assistant' | 'system'
 *   - content: string
 *   - metadata: object (optional)
 *
 * Returns:
 *   - message: { id, role, content, metadata, createdAt }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ conversationId: string }> }
) {
  try {
    // v1: Single-user, always use server-side constant
    const userId = getChatUserId()

    const { conversationId } = await params
    const body = await request.json()
    const { role, content, metadata } = body

    // Validate required fields
    if (!role || !['user', 'assistant', 'system'].includes(role)) {
      return NextResponse.json(
        { error: 'Invalid role. Must be user, assistant, or system.' },
        { status: 400 }
      )
    }

    if (!content || typeof content !== 'string' || content.trim().length === 0) {
      return NextResponse.json(
        { error: 'Content is required' },
        { status: 400 }
      )
    }

    // Verify conversation exists and belongs to user
    const convResult = await serverPool.query(
      `SELECT id FROM chat_conversations WHERE id = $1 AND user_id = $2`,
      [conversationId, userId]
    )

    if (convResult.rows.length === 0) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
    }

    // Insert message
    const insertResult = await serverPool.query(
      `
      INSERT INTO chat_messages (conversation_id, role, content, metadata)
      VALUES ($1, $2, $3, $4)
      RETURNING id, role, content, metadata, created_at
      `,
      [conversationId, role, content.trim(), metadata ? JSON.stringify(metadata) : null]
    )

    const row = insertResult.rows[0]

    // Update conversation's updated_at
    await serverPool.query(
      `UPDATE chat_conversations SET updated_at = now() WHERE id = $1`,
      [conversationId]
    )

    return NextResponse.json({
      message: {
        id: row.id,
        role: row.role,
        content: row.content,
        metadata: row.metadata,
        createdAt: row.created_at,
      },
    })
  } catch (error) {
    console.error('[chat/messages POST] Error:', error)
    return NextResponse.json(
      { error: 'Failed to create message' },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/chat/conversations/[conversationId]/messages
 * Delete all messages in a conversation and reset summary.
 *
 * Returns:
 *   - deleted: number (count of deleted messages)
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ conversationId: string }> }
) {
  try {
    // v1: Single-user, always use server-side constant
    const userId = getChatUserId()

    const { conversationId } = await params

    // Verify conversation exists and belongs to user
    const convResult = await serverPool.query(
      `SELECT id FROM chat_conversations WHERE id = $1 AND user_id = $2`,
      [conversationId, userId]
    )

    if (convResult.rows.length === 0) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
    }

    // Delete all messages
    const deleteResult = await serverPool.query(
      `DELETE FROM chat_messages WHERE conversation_id = $1`,
      [conversationId]
    )

    // Reset conversation summary
    await serverPool.query(
      `UPDATE chat_conversations SET summary = NULL, summary_until_message_id = NULL, updated_at = now() WHERE id = $1`,
      [conversationId]
    )

    return NextResponse.json({
      deleted: deleteResult.rowCount || 0,
    })
  } catch (error) {
    console.error('[chat/messages DELETE] Error:', error)
    return NextResponse.json(
      { error: 'Failed to delete messages' },
      { status: 500 }
    )
  }
}
