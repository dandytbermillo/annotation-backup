/**
 * Quick Links Panel - Remove Link
 *
 * POST /api/panels/quick-links/[badge]/remove
 * Removes a link from the Quick Links panel.
 *
 * NOTE: This is a stub implementation. Full implementation requires
 * TipTap content manipulation which should be done client-side.
 */

import { NextRequest, NextResponse } from 'next/server'
import { resolveNoteWorkspaceUserId } from '@/app/api/note-workspaces/user-id'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ badge: string }> }
) {
  try {
    const userId = resolveNoteWorkspaceUserId(request)
    if (userId === 'invalid') {
      return NextResponse.json({ error: 'Invalid user ID' }, { status: 400 })
    }
    // userId validated but not used in stub - will be used in full implementation
    void userId

    const { badge } = await params
    const body = await request.json()
    const { params: reqParams } = body
    const name = reqParams?.name
    const position = reqParams?.position

    // For now, return a message guiding the user to use the UI
    // Full implementation would require TipTap content manipulation
    return NextResponse.json({
      success: false,
      message: name || position
        ? `To remove ${name ? `"${name}"` : `item ${position}`} from Quick Links ${badge.toUpperCase()}, please use the Quick Links panel directly.`
        : `To remove links from Quick Links ${badge.toUpperCase()}, please open the panel and remove them there.`,
    })

  } catch (error) {
    console.error('[POST /api/panels/quick-links/[badge]/remove] Error:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to remove link' },
      { status: 500 }
    )
  }
}
