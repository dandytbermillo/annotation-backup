/**
 * POST /api/widgets/install-file
 *
 * Install a widget from a file upload.
 * Phase 2.5 of Widget Manager implementation.
 *
 * Accepts multipart/form-data with a 'file' field containing a JSON manifest.
 */

import { NextRequest, NextResponse } from 'next/server'
import { resolveNoteWorkspaceUserId } from '@/app/api/note-workspaces/user-id'
import { installWidgetFromFile } from '@/lib/widgets/widget-store'

// Max file size: 100KB (manifests should be small)
const MAX_FILE_SIZE = 100 * 1024

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

    // Parse multipart form data
    const formData = await request.formData()
    const file = formData.get('file')

    if (!file || !(file instanceof File)) {
      return NextResponse.json(
        { success: false, error: { code: 'INVALID_REQUEST', message: 'File is required' } },
        { status: 400 }
      )
    }

    // Validate file type
    if (!file.name.endsWith('.json')) {
      return NextResponse.json(
        { success: false, error: { code: 'INVALID_REQUEST', message: 'File must be a .json file' } },
        { status: 400 }
      )
    }

    // Validate file size
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { success: false, error: { code: 'INVALID_REQUEST', message: 'File too large (max 100KB)' } },
        { status: 400 }
      )
    }

    // Read file content
    const fileContent = await file.text()

    // Install widget
    const result = await installWidgetFromFile(
      fileContent,
      file.name,
      userId === 'global' ? null : userId
    )

    if (!result.success) {
      // Map error codes to HTTP status
      const statusMap: Record<string, number> = {
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
      message: `Widget "${result.widget.name}" installed from file`,
      widget: result.widget,
    })
  } catch (error) {
    console.error('[api/widgets/install-file] Error:', error)
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      { status: 500 }
    )
  }
}
