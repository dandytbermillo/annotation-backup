import { NextRequest, NextResponse } from 'next/server'

import {
  MAX_LAYOUT_BYTES,
  buildEnvelope,
  normalizeLayout,
  parseUserId,
} from '../layout/shared'

import { closeWorkspacePool, getWorkspacePool } from './_pool'

const pool = getWorkspacePool()

interface WorkspaceRow {
  id: string
  name: string
  is_default: boolean
  updated_at: string | Date
  layout: unknown
  version: string | null
  revision: string | null
  layout_updated_at: string | Date | null
}

function derivePopupCount(layout: unknown): number {
  const normalized = normalizeLayout(layout, { useServerTimestamp: false })
  return normalized.popups.length
}

function deriveUpdatedAt(row: WorkspaceRow): string {
  const source =
    row.layout_updated_at instanceof Date
      ? row.layout_updated_at
      : row.layout_updated_at
      ? new Date(row.layout_updated_at)
      : row.updated_at instanceof Date
      ? row.updated_at
      : new Date(row.updated_at)

  return source.toISOString()
}

export async function GET() {
  try {
    const result = await pool.query<WorkspaceRow>(
      `SELECT w.id,
              w.name,
              w.is_default,
              w.updated_at,
              l.layout,
              l.version,
              l.revision::text AS revision,
              l.updated_at AS layout_updated_at
         FROM workspaces w
         LEFT JOIN overlay_layouts l
           ON l.workspace_id = w.id
          AND l.user_id IS NULL
        WHERE l.workspace_id IS NOT NULL
           OR w.is_default = true
        ORDER BY COALESCE(l.updated_at, w.updated_at) DESC`
    )

    const workspaces = result.rows.map(row => ({
      id: row.id,
      name: row.name,
      isDefault: row.is_default,
      updatedAt: deriveUpdatedAt(row),
      popupCount: row.layout ? derivePopupCount(row.layout) : 0,
    }))

    const nextIndexResult = await pool.query<{ next_index: number }>(
      `SELECT COALESCE(MAX(
                CASE
                  WHEN name ~ '^Workspace ([0-9]+)$'
                  THEN (regexp_replace(name, '^Workspace ', '')::int)
                  ELSE NULL
                END
              ), 0) + 1 AS next_index
         FROM workspaces`
    )
    const nextIndex = nextIndexResult.rows[0]?.next_index ?? 1

    return NextResponse.json({
      workspaces,
      nextWorkspaceName: `Workspace ${nextIndex}`,
    })
  } catch (error) {
    console.error('Overlay workspace list failed', error)
    return NextResponse.json({ error: 'Failed to list overlay workspaces' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const rawUserId = parseUserId(request.nextUrl.searchParams.get('userId'))
  if (rawUserId === 'invalid') {
    return NextResponse.json({ error: 'Invalid userId' }, { status: 400 })
  }

  const userId = rawUserId

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Body must be an object' }, { status: 400 })
  }

  const payload = body as Record<string, unknown>
  const nameHint =
    typeof payload.nameHint === 'string' && payload.nameHint.trim().length > 0
      ? payload.nameHint.trim()
      : null

  const normalizedLayout = normalizeLayout(payload.layout, { useServerTimestamp: true })
  const version =
    typeof payload.version === 'string' && payload.version.length > 0
      ? payload.version
      : normalizedLayout.schemaVersion

  if (version !== normalizedLayout.schemaVersion) {
    return NextResponse.json(
      { error: 'Version mismatch with layout schemaVersion' },
      { status: 400 }
    )
  }

  const serializedLayout = JSON.stringify(normalizedLayout)
  if (Buffer.byteLength(serializedLayout, 'utf8') > MAX_LAYOUT_BYTES) {
    return NextResponse.json({ error: 'Layout payload exceeds allowed size' }, { status: 413 })
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const nextIndexResult = await client.query<{ next_index: number }>(
      `SELECT COALESCE(MAX(
                CASE
                  WHEN name ~ '^Workspace ([0-9]+)$'
                  THEN (regexp_replace(name, '^Workspace ', '')::int)
                  ELSE NULL
                END
              ), 0) + 1 AS next_index
         FROM workspaces`
    )

    const nextIndex = nextIndexResult.rows[0]?.next_index ?? 1
    const workspaceName = nameHint ?? `Workspace ${nextIndex}`

    const insertedWorkspace = await client.query<{ id: string; name: string; updated_at: Date }>(
      `INSERT INTO workspaces (name, is_default)
       VALUES ($1, false)
    RETURNING id, name, updated_at`,
      [workspaceName]
    )

    const workspaceRecord = insertedWorkspace.rows[0]
    const workspaceId = workspaceRecord.id

    const layoutInsert = await client.query<{
      layout: unknown
      version: string
      revision: string
      updated_at: string
    }>(
      `INSERT INTO overlay_layouts (workspace_id, user_id, layout, version)
       VALUES ($1, $2, $3, $4)
    RETURNING layout, version, revision::text AS revision, updated_at`,
      [workspaceId, userId, normalizedLayout, version]
    )

    await client.query('COMMIT')

    const envelope = buildEnvelope(layoutInsert.rows[0])
    const workspaceUpdatedAt = workspaceRecord.updated_at instanceof Date
      ? workspaceRecord.updated_at.toISOString()
      : new Date(workspaceRecord.updated_at).toISOString()

    const workspaceSummary = {
      id: workspaceId,
      name: workspaceRecord.name,
      isDefault: false,
      updatedAt: envelope.layout.lastSavedAt ?? workspaceUpdatedAt,
      popupCount: envelope.layout.popups.length,
    }

    return NextResponse.json({
      workspace: workspaceSummary,
      envelope,
    })
  } catch (error) {
    await client.query('ROLLBACK')
    console.error('Overlay workspace creation failed', error)
    return NextResponse.json({ error: 'Failed to create overlay workspace' }, { status: 500 })
  } finally {
    client.release()
  }
}

export async function __testing__closeOverlayWorkspacePool() {
  await closeWorkspacePool()
}
