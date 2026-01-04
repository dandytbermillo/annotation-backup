/**
 * Widget Permissions API
 * Phase 3.3: Permission Gating + Write APIs
 *
 * GET /api/widgets/permissions?widgetInstanceId=...
 *   Returns persistent permission grants for a widget instance.
 *
 * POST /api/widgets/permissions
 *   Persists a permission grant decision (always/never only).
 */

import { NextRequest, NextResponse } from 'next/server'
import {
  listPermissionGrants,
  upsertPermissionGrant,
} from '@/lib/widgets/permission-store'
import { isValidPermission, type WidgetPermission } from '@/lib/widgets/sandbox-permissions'

// GET /api/widgets/permissions?widgetInstanceId=...
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const widgetInstanceId = searchParams.get('widgetInstanceId')

  if (!widgetInstanceId) {
    return NextResponse.json(
      { error: 'widgetInstanceId is required' },
      { status: 400 }
    )
  }

  // TODO: Get userId from session when auth is implemented
  const userId: string | null = null

  try {
    const grants = await listPermissionGrants(widgetInstanceId, userId)

    return NextResponse.json({
      grants: grants.map(g => ({
        permission: g.permission,
        allowLevel: g.allowLevel,
      })),
    })
  } catch (error) {
    console.error('[api/widgets/permissions] GET error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch permission grants' },
      { status: 500 }
    )
  }
}

// POST /api/widgets/permissions
export async function POST(request: NextRequest) {
  let body: {
    widgetInstanceId?: string
    permission?: string
    allowLevel?: string
  }

  try {
    body = await request.json()
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON body' },
      { status: 400 }
    )
  }

  const { widgetInstanceId, permission, allowLevel } = body

  // Validate required fields
  if (!widgetInstanceId) {
    return NextResponse.json(
      { error: 'widgetInstanceId is required' },
      { status: 400 }
    )
  }

  if (!permission) {
    return NextResponse.json(
      { error: 'permission is required' },
      { status: 400 }
    )
  }

  if (!allowLevel) {
    return NextResponse.json(
      { error: 'allowLevel is required' },
      { status: 400 }
    )
  }

  // Validate permission string
  if (!isValidPermission(permission)) {
    return NextResponse.json(
      { error: `Invalid permission: ${permission}` },
      { status: 400 }
    )
  }

  // Validate allowLevel - only 'always' and 'never' can be persisted
  if (allowLevel !== 'always' && allowLevel !== 'never') {
    return NextResponse.json(
      { error: 'allowLevel must be "always" or "never" for persistence' },
      { status: 400 }
    )
  }

  // TODO: Get userId from session when auth is implemented
  const userId: string | null = null

  try {
    const success = await upsertPermissionGrant(
      widgetInstanceId,
      userId,
      permission as WidgetPermission,
      allowLevel
    )

    if (success) {
      return NextResponse.json({ success: true })
    } else {
      return NextResponse.json(
        { error: 'Failed to persist permission grant' },
        { status: 500 }
      )
    }
  } catch (error) {
    console.error('[api/widgets/permissions] POST error:', error)
    return NextResponse.json(
      { error: 'Failed to persist permission grant' },
      { status: 500 }
    )
  }
}
