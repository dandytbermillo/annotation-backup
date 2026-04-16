import { NextRequest, NextResponse } from 'next/server'
import { serverPool } from '@/lib/db/pool'
import { resolveNoteWorkspaceUserId } from '@/app/api/note-workspaces/user-id'
import {
  writeSeedRowsForPanel,
  softDeleteSeedRowsForPanel,
  hardDeleteSeedRowsForPanel,
} from '@/lib/chat/routing-log/seed-writer'

/**
 * GET /api/dashboard/panels/[panelId]
 * Get a specific panel
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ panelId: string }> }
) {
  try {
    const userId = resolveNoteWorkspaceUserId(request)
    if (userId === 'invalid') {
      return NextResponse.json({ error: 'Invalid userId' }, { status: 400 })
    }

    const { panelId } = await params

    // Get panel with workspace ownership verification
    const query = `
      SELECT
        wp.id,
        wp.workspace_id,
        wp.panel_type,
        wp.title,
        wp.position_x,
        wp.position_y,
        wp.width,
        wp.height,
        wp.z_index,
        wp.config,
        wp.badge,
        wp.instance_label,
        wp.duplicate_family,
        wp.is_visible,
        wp.deleted_at,
        wp.created_at,
        wp.updated_at
      FROM workspace_panels wp
      JOIN note_workspaces nw ON wp.workspace_id = nw.id
      WHERE wp.id = $1 AND nw.user_id = $2
    `

    const result = await serverPool.query(query, [panelId, userId])

    if (result.rows.length === 0) {
      return NextResponse.json({ error: 'Panel not found' }, { status: 404 })
    }

    const row = result.rows[0]
    const panel = {
      id: row.id,
      workspaceId: row.workspace_id,
      panelType: row.panel_type,
      title: row.title,
      positionX: row.position_x,
      positionY: row.position_y,
      width: row.width,
      height: row.height,
      zIndex: row.z_index,
      config: row.config || {},
      badge: row.badge || null,
      instanceLabel: row.instance_label || null,
      duplicateFamily: row.duplicate_family || null,
      isVisible: row.is_visible,
      deletedAt: row.deleted_at || null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }

    return NextResponse.json({ panel })
  } catch (error) {
    console.error('[dashboard/panels/[panelId]] GET Error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch panel' },
      { status: 500 }
    )
  }
}

/**
 * PATCH /api/dashboard/panels/[panelId]
 * Update a panel's properties
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ panelId: string }> }
) {
  try {
    const userId = resolveNoteWorkspaceUserId(request)
    if (userId === 'invalid') {
      return NextResponse.json({ error: 'Invalid userId' }, { status: 400 })
    }

    const { panelId } = await params
    const body = await request.json()

    // Verify panel belongs to user's workspace
    const ownershipCheck = await serverPool.query(
      `SELECT wp.id FROM workspace_panels wp
       JOIN note_workspaces nw ON wp.workspace_id = nw.id
       WHERE wp.id = $1 AND nw.user_id = $2`,
      [panelId, userId]
    )

    if (ownershipCheck.rows.length === 0) {
      return NextResponse.json({ error: 'Panel not found' }, { status: 404 })
    }

    // Build update query dynamically
    const updates: string[] = []
    const values: any[] = []
    let paramIndex = 1

    const allowedFields = [
      { key: 'title', column: 'title' },
      { key: 'positionX', column: 'position_x' },
      { key: 'positionY', column: 'position_y' },
      { key: 'width', column: 'width' },
      { key: 'height', column: 'height' },
      { key: 'zIndex', column: 'z_index' },
      { key: 'isVisible', column: 'is_visible' },
    ]

    for (const field of allowedFields) {
      if (body[field.key] !== undefined) {
        updates.push(`${field.column} = $${paramIndex}`)
        values.push(body[field.key])
        paramIndex++
      }
    }

    // Handle config update (merge with existing)
    if (body.config !== undefined) {
      updates.push(`config = config || $${paramIndex}::jsonb`)
      values.push(JSON.stringify(body.config))
      paramIndex++
    }

    // Handle restore action - clears deleted_at and makes panel visible
    if (body.restore === true) {
      updates.push(`deleted_at = NULL`)
      updates.push(`is_visible = true`)
    }

    if (updates.length === 0) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 })
    }

    // Add panel ID to values
    values.push(panelId)

    const query = `
      UPDATE workspace_panels
      SET ${updates.join(', ')}, updated_at = NOW()
      WHERE id = $${paramIndex}
      RETURNING *
    `

    const result = await serverPool.query(query, values)
    const row = result.rows[0]

    // Cascade soft-delete stale learned open_panel rows on title rename.
    // Narrow scope per the review: only learned rows (routing_dispatcher),
    // only rows where slots_json.panelId matches this panel, only rows whose
    // stored panelTitle differs from the new title. Curated seeds have no
    // panelId/panelTitle in slots and are untouched. Best-effort — a failure
    // here must not roll back the rename itself.
    if (body.title !== undefined && typeof row?.title === 'string') {
      try {
        const cascadeResult = await serverPool.query(
          `UPDATE chat_routing_memory_index
             SET is_deleted = true, updated_at = NOW()
           WHERE is_deleted = false
             AND intent_id = 'open_panel'
             AND scope_source = 'routing_dispatcher'
             AND slots_json->>'panelId' = $1
             AND slots_json->>'panelTitle' IS DISTINCT FROM $2
           RETURNING id`,
          [panelId, row.title]
        )
        if (cascadeResult.rowCount && cascadeResult.rowCount > 0) {
          console.log(
            `[dashboard/panels/${panelId}] Cascade soft-deleted ${cascadeResult.rowCount} stale learned open_panel row(s) after rename to "${row.title}"`
          )
        }
      } catch (cascadeError) {
        console.error(
          `[dashboard/panels/${panelId}] Cascade soft-delete failed (rename already committed):`,
          cascadeError
        )
      }

      // Fix 3 Part A: rename lifecycle for widget_preseed rows. Soft-delete
      // the old title's preseeds and insert fresh ones with the new title.
      // Scope is strictly 'widget_preseed' — the learned-row cascade above
      // handles 'routing_dispatcher' rows; curated seeds are untouched.
      try {
        const softDeleted = await softDeleteSeedRowsForPanel(panelId)
        const seedResult = await writeSeedRowsForPanel({
          panelId: row.id,
          userId,
          title: row.title,
          familyId: row.duplicate_family ?? null,
          instanceLabel: row.instance_label ?? null,
        })
        console.log(
          `[dashboard/panels/${panelId}] Preseed rename cascade: soft-deleted ${softDeleted}, inserted ${seedResult.succeeded}/${seedResult.succeeded + seedResult.failed} for "${row.title}"`
        )
      } catch (preseedErr) {
        console.error(
          `[dashboard/panels/${panelId}] Preseed rename cascade failed (rename already committed):`,
          preseedErr
        )
      }
    }

    // Fix 3 Part A: restore lifecycle for widget_preseed rows. On restore,
    // insert a fresh active seed set; prior soft-deleted rows remain soft-
    // deleted (partial unique index allows coexistence) and fresh rows win
    // at retrieval via `is_deleted = false` filter.
    if (body.restore === true && typeof row?.title === 'string') {
      try {
        const seedResult = await writeSeedRowsForPanel({
          panelId: row.id,
          userId,
          title: row.title,
          familyId: row.duplicate_family ?? null,
          instanceLabel: row.instance_label ?? null,
        })
        console.log(
          `[dashboard/panels/${panelId}] Preseed restore: inserted ${seedResult.succeeded}/${seedResult.succeeded + seedResult.failed} for "${row.title}"`
        )
      } catch (restoreErr) {
        console.error(
          `[dashboard/panels/${panelId}] Preseed restore failed (restore already committed):`,
          restoreErr
        )
      }
    }

    const panel = {
      id: row.id,
      workspaceId: row.workspace_id,
      panelType: row.panel_type,
      title: row.title,
      positionX: row.position_x,
      positionY: row.position_y,
      width: row.width,
      height: row.height,
      zIndex: row.z_index,
      config: row.config || {},
      badge: row.badge || null,
      instanceLabel: row.instance_label || null,
      duplicateFamily: row.duplicate_family || null,
      isVisible: row.is_visible,
      deletedAt: row.deleted_at || null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }

    return NextResponse.json({ panel })
  } catch (error) {
    console.error('[dashboard/panels/[panelId]] PATCH Error:', error)
    return NextResponse.json(
      { error: 'Failed to update panel' },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/dashboard/panels/[panelId]
 * Soft delete a panel (move to trash) or permanently delete
 *
 * Query params:
 * - permanent=true: Permanently delete (for purging trash)
 *
 * Default behavior: Soft delete (set deleted_at = NOW())
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ panelId: string }> }
) {
  try {
    const userId = resolveNoteWorkspaceUserId(request)
    if (userId === 'invalid') {
      return NextResponse.json({ error: 'Invalid userId' }, { status: 400 })
    }

    const { panelId } = await params
    const permanent = request.nextUrl.searchParams.get('permanent') === 'true'

    if (permanent) {
      // Permanent delete - actually remove from database
      const result = await serverPool.query(
        `DELETE FROM workspace_panels wp
         USING note_workspaces nw
         WHERE wp.workspace_id = nw.id
           AND wp.id = $1
           AND nw.user_id = $2
         RETURNING wp.id`,
        [panelId, userId]
      )

      if (result.rows.length === 0) {
        return NextResponse.json({ error: 'Panel not found' }, { status: 404 })
      }

      // Fix 3 Part A: hard-delete widget_preseed rows on permanent panel delete.
      // Best-effort — failure must not fail the delete response.
      try {
        const hardDeleted = await hardDeleteSeedRowsForPanel(panelId)
        if (hardDeleted > 0) {
          console.log(`[dashboard/panels/${panelId}] Preseed hard-delete: ${hardDeleted} rows`)
        }
      } catch (preseedErr) {
        console.error(
          `[dashboard/panels/${panelId}] Preseed hard-delete failed (permanent delete already committed):`,
          preseedErr
        )
      }

      return NextResponse.json({ success: true, deletedId: panelId, permanent: true })
    } else {
      // Soft delete - set deleted_at and hide panel
      const result = await serverPool.query(
        `UPDATE workspace_panels wp
         SET deleted_at = NOW(), is_visible = false, updated_at = NOW()
         FROM note_workspaces nw
         WHERE wp.workspace_id = nw.id
           AND wp.id = $1
           AND nw.user_id = $2
         RETURNING wp.id, wp.deleted_at`,
        [panelId, userId]
      )

      if (result.rows.length === 0) {
        return NextResponse.json({ error: 'Panel not found' }, { status: 404 })
      }

      // Fix 3 Part A: soft-delete widget_preseed rows on panel soft-delete.
      // On restore, the PATCH handler writes fresh active rows; these stay
      // soft-deleted for audit history.
      try {
        const softDeleted = await softDeleteSeedRowsForPanel(panelId)
        if (softDeleted > 0) {
          console.log(`[dashboard/panels/${panelId}] Preseed soft-delete: ${softDeleted} rows`)
        }
      } catch (preseedErr) {
        console.error(
          `[dashboard/panels/${panelId}] Preseed soft-delete failed (soft-delete already committed):`,
          preseedErr
        )
      }

      return NextResponse.json({
        success: true,
        deletedId: panelId,
        permanent: false,
        deletedAt: result.rows[0].deleted_at
      })
    }
  } catch (error) {
    console.error('[dashboard/panels/[panelId]] DELETE Error:', error)
    return NextResponse.json(
      { error: 'Failed to delete panel' },
      { status: 500 }
    )
  }
}
