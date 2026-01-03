/**
 * POST /api/widgets/install
 *
 * Install a widget from a URL.
 * Phase 2 of Widget Manager implementation.
 */

import { NextRequest, NextResponse } from 'next/server'
import { resolveNoteWorkspaceUserId } from '@/app/api/note-workspaces/user-id'
import { installWidgetFromUrl, type InstallRequest } from '@/lib/widgets/widget-store'

export async function POST(request: NextRequest) {
  try {
    // Get user ID
    const userId = resolveNoteWorkspaceUserId(request)
    if (userId === 'invalid') {
      return NextResponse.json(
        { success: false, error: { code: 'AUTH_ERROR', message: 'Invalid userId' } },
        { status: 400 }
      )
    }

    // Parse request body
    const body = await request.json() as Partial<InstallRequest>

    if (!body.url || typeof body.url !== 'string') {
      return NextResponse.json(
        { success: false, error: { code: 'INVALID_REQUEST', message: 'URL is required' } },
        { status: 400 }
      )
    }

    // Validate URL format
    try {
      new URL(body.url)
    } catch {
      return NextResponse.json(
        { success: false, error: { code: 'INVALID_REQUEST', message: 'Invalid URL format' } },
        { status: 400 }
      )
    }

    // Install widget
    const result = await installWidgetFromUrl(body.url, userId === 'global' ? null : userId)

    if (!result.success) {
      // Map error codes to HTTP status
      const statusMap: Record<string, number> = {
        FETCH_FAILED: 502,
        INVALID_JSON: 422,
        INVALID_MANIFEST: 422,
        DUPLICATE_SLUG: 409,
        DB_ERROR: 500,
      }
      const status = statusMap[result.error.code] || 500

      return NextResponse.json(
        { success: false, error: result.error },
        { status }
      )
    }

    return NextResponse.json({
      success: true,
      message: `Widget "${result.widget.name}" installed successfully`,
      widget: result.widget,
    })
  } catch (error) {
    console.error('[api/widgets/install] Error:', error)
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      { status: 500 }
    )
  }
}
