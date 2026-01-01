/**
 * Quick Links Panel - Add Link
 *
 * POST /api/panels/quick-links/[badge]/add
 * Adds a new link to the Quick Links panel.
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
    const url = reqParams?.url
    const name = reqParams?.name

    // For now, return a message guiding the user to use the UI
    // Full implementation would require TipTap content manipulation
    return NextResponse.json({
      success: false,
      message: url
        ? `To add "${name || url}" to Quick Links ${badge.toUpperCase()}, please use the Quick Links panel directly.`
        : `To add links to Quick Links ${badge.toUpperCase()}, please open the panel and add them there.`,
    })

  } catch (error) {
    console.error('[POST /api/panels/quick-links/[badge]/add] Error:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to add link' },
      { status: 500 }
    )
  }
}
