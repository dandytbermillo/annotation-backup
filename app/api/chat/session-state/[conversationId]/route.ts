import { NextRequest, NextResponse } from 'next/server'
import { serverPool } from '@/lib/db/pool'
import { getChatUserId } from '@/app/api/chat/user-id'

/**
 * PATCH /api/chat/session-state/[conversationId]
 * Update session state for a conversation.
 * Uses upsert with shallow merge (new keys override, existing keys preserved).
 *
 * Body:
 *   - sessionState: { openCounts?, lastAction?, lastQuickLinksBadge? }
 *
 * Returns:
 *   - success: boolean
 *   - sessionState: the merged session state
 *   - updatedAt: timestamp
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
    const { sessionState } = body

    if (sessionState === undefined) {
      return NextResponse.json(
        { error: 'sessionState is required' },
        { status: 400 }
      )
    }

    // Validate sessionState structure
    if (sessionState !== null && typeof sessionState !== 'object') {
      return NextResponse.json(
        { error: 'sessionState must be an object or null' },
        { status: 400 }
      )
    }

    // Upsert: insert if not exists, merge if exists
    // Uses jsonb || operator for shallow merge (new keys override, existing keys preserved)
    const result = await serverPool.query(
      `INSERT INTO chat_session_state (conversation_id, user_id, session_state, updated_at)
       VALUES ($1, $2, $3::jsonb, NOW())
       ON CONFLICT (conversation_id, user_id)
       DO UPDATE SET
         session_state = COALESCE(chat_session_state.session_state, '{}'::jsonb) || $3::jsonb,
         updated_at = NOW()
       RETURNING session_state, updated_at`,
      [conversationId, userId, sessionState ? JSON.stringify(sessionState) : '{}']
    )

    const row = result.rows[0]
    return NextResponse.json({
      success: true,
      sessionState: row.session_state,
      updatedAt: row.updated_at,
    })
  } catch (error) {
    console.error('[session-state] PATCH error:', error)
    return NextResponse.json(
      { error: 'Failed to update session state' },
      { status: 500 }
    )
  }
}
