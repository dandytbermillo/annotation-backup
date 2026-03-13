/**
 * Stage 6 Content Extension: inspect_note_content — API Route (Slice 6x.2)
 *
 * Server-side handler that fetches note content from document_saves,
 * resolves item metadata from the items table, and returns bounded
 * content suitable for the client-side content handler to process
 * into snippets.
 *
 * Access model: workspace-scoped. The query filters by the current
 * workspace ID (from WorkspaceStore). Items outside the workspace
 * return 'workspace_mismatch'. Deleted items return 'item_deleted'.
 *
 * This route does NOT produce snippets — it returns raw text + metadata.
 * Snippet shaping is done client-side in stage6-content-handlers.ts so
 * extraction logic can be unit-tested without database dependencies.
 *
 * Query logic: delegated to queryNoteContent() in stage6-content-query.ts
 * (shared with stage6-loop/route.ts).
 */

import { NextResponse } from 'next/server'
import { serverPool } from '@/lib/db/pool'
import { withWorkspaceClient } from '@/lib/workspace/workspace-store'
import { queryNoteContent } from '@/lib/chat/stage6-content-query'

export const dynamic = 'force-dynamic'

interface InspectNoteContentBody {
  itemId: string
}

export async function POST(request: Request) {
  try {
    const body: InspectNoteContentBody = await request.json()
    const { itemId } = body

    if (!itemId || typeof itemId !== 'string') {
      return NextResponse.json(
        { success: false, error: 'itemId is required' },
        { status: 400 },
      )
    }

    return await withWorkspaceClient(serverPool, async (client, workspaceId) => {
      const result = await queryNoteContent(client, workspaceId, itemId)

      if (!result.success) {
        return NextResponse.json({
          success: false,
          error: result.error,
          data: null,
        })
      }

      return NextResponse.json({
        success: true,
        data: result.data,
      })
    })
  } catch (error) {
    console.error('[inspect-note-content] Error:', error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 },
    )
  }
}
