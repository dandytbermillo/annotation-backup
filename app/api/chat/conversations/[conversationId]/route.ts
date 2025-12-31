import { NextRequest, NextResponse } from 'next/server'
import { serverPool } from '@/lib/db/pool'
import { getChatUserId } from '@/app/api/chat/user-id'

/**
 * PATCH /api/chat/conversations/[conversationId]
 * Update conversation metadata (currently: last_action).
 *
 * Body:
 *   - lastAction: { type, workspaceId?, workspaceName?, fromName?, toName?, timestamp }
 *
 * Returns:
 *   - success: boolean
 *   - conversation: { id, lastAction, updatedAt }
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ conversationId: string }> }
) {
  try {
    const userId = getChatUserId()
    const { conversationId } = await params

    if (!conversationId) {
      return NextResponse.json(
        { error: 'conversationId is required' },
        { status: 400 }
      )
    }

    const body = await request.json()
    const { lastAction } = body

    // Validate lastAction structure if provided
    if (lastAction !== undefined && lastAction !== null) {
      if (typeof lastAction !== 'object') {
        return NextResponse.json(
          { error: 'lastAction must be an object' },
          { status: 400 }
        )
      }
      // Validate required fields
      if (!lastAction.type || !lastAction.timestamp) {
        return NextResponse.json(
          { error: 'lastAction requires type and timestamp' },
          { status: 400 }
        )
      }
    }

    // Update last_action
    const query = `
      UPDATE chat_conversations
      SET last_action = $1, updated_at = NOW()
      WHERE id = $2 AND user_id = $3
      RETURNING id, last_action, updated_at
    `
    const result = await serverPool.query(query, [
      lastAction ? JSON.stringify(lastAction) : null,
      conversationId,
      userId,
    ])

    if (result.rows.length === 0) {
      return NextResponse.json(
        { error: 'Conversation not found' },
        { status: 404 }
      )
    }

    const row = result.rows[0]
    return NextResponse.json({
      success: true,
      conversation: {
        id: row.id,
        lastAction: row.last_action,
        updatedAt: row.updated_at,
      },
    })
  } catch (error) {
    console.error('[chat/conversations/[id]] PATCH error:', error)
    return NextResponse.json(
      { error: 'Failed to update conversation' },
      { status: 500 }
    )
  }
}
