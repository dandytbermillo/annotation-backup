import { NextRequest, NextResponse } from 'next/server'
import { serverPool } from '@/lib/db/pool'
import { getChatUserId } from '@/app/api/chat/user-id'

/**
 * GET /api/chat/session-state?conversationId=...
 * Fetch session state for a conversation.
 *
 * Returns:
 *   - sessionState: { openCounts, lastAction } or null if not found
 */
export async function GET(request: NextRequest) {
  try {
    const userId = getChatUserId()
    const { searchParams } = new URL(request.url)
    const conversationId = searchParams.get('conversationId')

    if (!conversationId) {
      return NextResponse.json(
        { error: 'conversationId is required' },
        { status: 400 }
      )
    }

    // Fetch session state from dedicated table
    const result = await serverPool.query(
      `SELECT session_state, updated_at
       FROM chat_session_state
       WHERE conversation_id = $1 AND user_id = $2`,
      [conversationId, userId]
    )

    if (result.rows.length === 0) {
      // No session state yet - return null (will be created on first update)
      return NextResponse.json({
        sessionState: null,
        updatedAt: null,
      })
    }

    const row = result.rows[0]
    return NextResponse.json({
      sessionState: row.session_state,
      updatedAt: row.updated_at,
    })
  } catch (error) {
    console.error('[session-state] GET error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch session state' },
      { status: 500 }
    )
  }
}
