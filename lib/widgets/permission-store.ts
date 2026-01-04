/**
 * Permission Store
 * Server-side database access for widget permission grants.
 * Phase 3.3: Permission Gating + Write APIs
 *
 * NOTE: This file is server-only. Import it only in API routes or server components.
 */

import { serverPool } from '@/lib/db/pool'
import type { WidgetPermission, AllowLevel } from './sandbox-permissions'

// ============================================================================
// Types
// ============================================================================

export interface PermissionGrantRow {
  id: string
  widget_instance_id: string
  user_id: string | null
  permission: WidgetPermission
  allow_level: AllowLevel
  granted_at: string
  expires_at: string | null
  updated_at: string
}

export interface PermissionGrantDTO {
  permission: WidgetPermission
  allowLevel: AllowLevel
  grantedAt: string
  expiresAt: string | null
}

// ============================================================================
// Permission Grant Functions
// ============================================================================

/**
 * List all permission grants for a widget instance
 */
export async function listPermissionGrants(
  widgetInstanceId: string,
  userId: string | null
): Promise<PermissionGrantDTO[]> {
  try {
    const result = await serverPool.query(
      `SELECT permission, allow_level, granted_at, expires_at
       FROM widget_permission_grants
       WHERE widget_instance_id = $1
         AND (user_id = $2 OR ($2 IS NULL AND user_id IS NULL))
       ORDER BY granted_at ASC`,
      [widgetInstanceId, userId]
    )

    return result.rows.map(row => ({
      permission: row.permission as WidgetPermission,
      allowLevel: row.allow_level as AllowLevel,
      grantedAt: row.granted_at,
      expiresAt: row.expires_at,
    }))
  } catch (error) {
    console.error('[permission-store] listPermissionGrants error:', error)
    throw error
  }
}

/**
 * Upsert a permission grant (insert or update)
 * Only persists 'always' and 'never' decisions.
 * 'once' grants are session-only and should not be stored in DB.
 */
export async function upsertPermissionGrant(
  widgetInstanceId: string,
  userId: string | null,
  permission: WidgetPermission,
  allowLevel: 'always' | 'never'
): Promise<boolean> {
  // Validate: only persist 'always' or 'never'
  if (allowLevel !== 'always' && allowLevel !== 'never') {
    console.warn('[permission-store] upsertPermissionGrant: only always/never can be persisted')
    return false
  }

  try {
    await serverPool.query(
      `INSERT INTO widget_permission_grants
       (widget_instance_id, user_id, permission, allow_level, granted_at, updated_at)
       VALUES ($1, $2, $3, $4, now(), now())
       ON CONFLICT (widget_instance_id, user_id, permission)
       DO UPDATE SET
         allow_level = EXCLUDED.allow_level,
         granted_at = now(),
         updated_at = now(),
         expires_at = NULL`,
      [widgetInstanceId, userId, permission, allowLevel]
    )

    return true
  } catch (error) {
    console.error('[permission-store] upsertPermissionGrant error:', error)
    throw error
  }
}

/**
 * Delete a specific permission grant
 */
export async function deletePermissionGrant(
  widgetInstanceId: string,
  userId: string | null,
  permission: WidgetPermission
): Promise<boolean> {
  try {
    const result = await serverPool.query(
      `DELETE FROM widget_permission_grants
       WHERE widget_instance_id = $1
         AND (user_id = $2 OR ($2 IS NULL AND user_id IS NULL))
         AND permission = $3
       RETURNING id`,
      [widgetInstanceId, userId, permission]
    )

    return result.rows.length > 0
  } catch (error) {
    console.error('[permission-store] deletePermissionGrant error:', error)
    throw error
  }
}

/**
 * Delete all permission grants for a widget instance
 * Called when widget instance is removed
 */
export async function deleteAllPermissionGrants(
  widgetInstanceId: string,
  userId: string | null
): Promise<number> {
  try {
    const result = await serverPool.query(
      `DELETE FROM widget_permission_grants
       WHERE widget_instance_id = $1
         AND (user_id = $2 OR ($2 IS NULL AND user_id IS NULL))`,
      [widgetInstanceId, userId]
    )

    return result.rowCount ?? 0
  } catch (error) {
    console.error('[permission-store] deleteAllPermissionGrants error:', error)
    throw error
  }
}

/**
 * Check if a specific permission is granted (for server-side validation)
 * Returns the allow level if found, null otherwise
 */
export async function getPermissionGrant(
  widgetInstanceId: string,
  userId: string | null,
  permission: WidgetPermission
): Promise<AllowLevel | null> {
  try {
    const result = await serverPool.query(
      `SELECT allow_level
       FROM widget_permission_grants
       WHERE widget_instance_id = $1
         AND (user_id = $2 OR ($2 IS NULL AND user_id IS NULL))
         AND permission = $3`,
      [widgetInstanceId, userId, permission]
    )

    if (result.rows.length === 0) {
      return null
    }

    return result.rows[0].allow_level as AllowLevel
  } catch (error) {
    console.error('[permission-store] getPermissionGrant error:', error)
    throw error
  }
}
