import { NextRequest, NextResponse } from 'next/server'
import { serverPool } from '@/lib/db/pool'
import { getChatUserId } from '@/app/api/chat/user-id'

/**
 * POST /api/chat/conversations
 * Get or create the active conversation for a given scope.
 *
 * Body:
 *   - scope: 'global' | 'entry' | 'workspace' (default: 'global')
 *   - entryId: string (required if scope is 'entry' or 'workspace')
 *   - workspaceId: string (required if scope is 'workspace')
 *
 * Returns:
 *   - conversation: { id, scope, summary, createdAt, updatedAt }
 */
export async function POST(request: NextRequest) {
  try {
    // v1: Single-user, always use server-side constant
    const userId = getChatUserId()

    const body = await request.json()
    const { scope = 'global', entryId, workspaceId } = body

    // Validate scope
    if (!['global', 'entry', 'workspace'].includes(scope)) {
      return NextResponse.json(
        { error: 'Invalid scope. Must be global, entry, or workspace.' },
        { status: 400 }
      )
    }

    // Validate required IDs for non-global scopes
    if (scope === 'entry' && !entryId) {
      return NextResponse.json(
        { error: 'entryId is required for entry scope' },
        { status: 400 }
      )
    }
    if (scope === 'workspace' && !workspaceId) {
      return NextResponse.json(
        { error: 'workspaceId is required for workspace scope' },
        { status: 400 }
      )
    }

    // Try to find existing conversation
    let query: string
    let params: (string | null)[]

    if (scope === 'global') {
      query = `
        SELECT id, scope, summary, last_action, session_state, created_at, updated_at
        FROM chat_conversations
        WHERE user_id = $1 AND scope = 'global' AND entry_id IS NULL AND workspace_id IS NULL
      `
      params = [userId]
    } else if (scope === 'entry') {
      query = `
        SELECT id, scope, summary, last_action, session_state, created_at, updated_at
        FROM chat_conversations
        WHERE user_id = $1 AND scope = 'entry' AND entry_id = $2 AND workspace_id IS NULL
      `
      params = [userId, entryId]
    } else {
      query = `
        SELECT id, scope, summary, last_action, session_state, created_at, updated_at
        FROM chat_conversations
        WHERE user_id = $1 AND scope = 'workspace' AND workspace_id = $2
      `
      params = [userId, workspaceId]
    }

    const existingResult = await serverPool.query(query, params)

    if (existingResult.rows.length > 0) {
      const row = existingResult.rows[0]
      return NextResponse.json({
        conversation: {
          id: row.id,
          scope: row.scope,
          summary: row.summary,
          lastAction: row.last_action,
          sessionState: row.session_state,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        },
      })
    }

    // Create new conversation
    let insertQuery: string
    let insertParams: (string | null)[]

    if (scope === 'global') {
      insertQuery = `
        INSERT INTO chat_conversations (user_id, scope, entry_id, workspace_id)
        VALUES ($1, 'global', NULL, NULL)
        RETURNING id, scope, summary, last_action, session_state, created_at, updated_at
      `
      insertParams = [userId]
    } else if (scope === 'entry') {
      insertQuery = `
        INSERT INTO chat_conversations (user_id, scope, entry_id, workspace_id)
        VALUES ($1, 'entry', $2, NULL)
        RETURNING id, scope, summary, last_action, session_state, created_at, updated_at
      `
      insertParams = [userId, entryId]
    } else {
      insertQuery = `
        INSERT INTO chat_conversations (user_id, scope, entry_id, workspace_id)
        VALUES ($1, 'workspace', $2, $3)
        RETURNING id, scope, summary, last_action, session_state, created_at, updated_at
      `
      insertParams = [userId, entryId, workspaceId]
    }

    const insertResult = await serverPool.query(insertQuery, insertParams)
    const row = insertResult.rows[0]

    return NextResponse.json({
      conversation: {
        id: row.id,
        scope: row.scope,
        summary: row.summary,
        lastAction: row.last_action,
        sessionState: row.session_state,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      },
    })
  } catch (error) {
    console.error('[chat/conversations] Error:', error)
    return NextResponse.json(
      { error: 'Failed to get or create conversation' },
      { status: 500 }
    )
  }
}
