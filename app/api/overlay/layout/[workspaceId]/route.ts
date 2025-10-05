import { NextRequest, NextResponse } from 'next/server'
import { Pool } from 'pg'

import {
  OVERLAY_LAYOUT_SCHEMA_VERSION,
  OverlayInspectorState,
  OverlayLayoutEnvelope,
  OverlayLayoutPayload,
  OverlayPopupDescriptor,
} from '@/lib/types/overlay-layout'
import { WorkspaceStore } from '@/lib/workspace/workspace-store'

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/annotation_dev',
})

const MAX_LAYOUT_BYTES = 128 * 1024 // 128 KB cap to avoid runaway payloads
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function coerceNumber(value: unknown): number | null {
  if (typeof value !== 'number') return null
  return Number.isFinite(value) ? value : null
}

function normalizePopups(raw: unknown): OverlayPopupDescriptor[] {
  if (!Array.isArray(raw)) return []

  const popups: OverlayPopupDescriptor[] = []

  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue
    const candidate = entry as Record<string, unknown>

    if (typeof candidate.id !== 'string' || candidate.id.length === 0) continue

    const canvasPosition = candidate.canvasPosition as Record<string, unknown> | undefined
    const x = coerceNumber(canvasPosition?.x)
    const y = coerceNumber(canvasPosition?.y)
    if (x === null || y === null) continue

    const levelRaw = coerceNumber(candidate.level)
    const level = levelRaw === null ? 0 : Math.trunc(levelRaw)

    const popup: OverlayPopupDescriptor = {
      id: candidate.id,
      folderId: typeof candidate.folderId === 'string' ? candidate.folderId : null,
      parentId: typeof candidate.parentId === 'string' ? candidate.parentId : null,
      canvasPosition: { x, y },
      level,
    }

    // Include folderName if present (for display without fetching)
    if (typeof candidate.folderName === 'string' && candidate.folderName.length > 0) {
      popup.folderName = candidate.folderName
    }

    // Include folderColor if present (for inherited colors)
    if (typeof candidate.folderColor === 'string' && candidate.folderColor.length > 0) {
      popup.folderColor = candidate.folderColor
    }

    const heightValue = coerceNumber(candidate.height)
    if (heightValue !== null) {
      popup.height = heightValue
    }

    popups.push(popup)
  }

  return popups
}

function normalizeInspectors(raw: unknown): OverlayInspectorState[] {
  if (!Array.isArray(raw)) return []

  const inspectors: OverlayInspectorState[] = []

  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue
    const candidate = entry as Record<string, unknown>

    if (typeof candidate.type !== 'string' || candidate.type.length === 0) continue
    if (typeof candidate.visible !== 'boolean') continue

    const inspector: OverlayInspectorState = {
      type: candidate.type,
      visible: candidate.visible,
    }

    if (typeof candidate.pane === 'string') {
      inspector.pane = candidate.pane
    }

    inspectors.push(inspector)
  }

  return inspectors
}

function normalizeLayout(
  layout: unknown,
  { useServerTimestamp }: { useServerTimestamp: boolean }
): OverlayLayoutPayload {
  const fallbackTimestamp = new Date().toISOString()

  if (!layout || typeof layout !== 'object') {
    return {
      schemaVersion: OVERLAY_LAYOUT_SCHEMA_VERSION,
      popups: [],
      inspectors: [],
      lastSavedAt: fallbackTimestamp,
    }
  }

  const candidate = layout as Record<string, unknown>
  const schemaVersion =
    typeof candidate.schemaVersion === 'string' && candidate.schemaVersion.length > 0
      ? candidate.schemaVersion
      : OVERLAY_LAYOUT_SCHEMA_VERSION

  const popups = normalizePopups(candidate.popups)
  const inspectors = normalizeInspectors(candidate.inspectors)

  let lastSavedAt = fallbackTimestamp
  if (!useServerTimestamp && typeof candidate.lastSavedAt === 'string') {
    const parsed = new Date(candidate.lastSavedAt)
    if (!Number.isNaN(parsed.getTime())) {
      lastSavedAt = parsed.toISOString()
    }
  } else if (useServerTimestamp) {
    lastSavedAt = fallbackTimestamp
  }

  return {
    schemaVersion,
    popups,
    inspectors,
    lastSavedAt,
  }
}

function buildEnvelope(row: {
  layout: unknown
  version: string
  revision: string
  updated_at: string | Date
}): OverlayLayoutEnvelope {
  const normalizedLayout = normalizeLayout(row.layout, { useServerTimestamp: false })
  return {
    layout: normalizedLayout,
    version: row.version,
    revision: row.revision,
    updatedAt:
      row.updated_at instanceof Date
        ? row.updated_at.toISOString()
        : new Date(row.updated_at).toISOString(),
  }
}

async function resolveWorkspaceId(raw?: string): Promise<string> {
  if (!raw || raw === 'default') {
    return WorkspaceStore.getDefaultWorkspaceId(pool)
  }
  return raw
}

function parseUserId(searchValue: string | null): string | null | 'invalid' {
  if (!searchValue || searchValue.length === 0) return null
  return UUID_REGEX.test(searchValue) ? searchValue : 'invalid'
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  const rawUserId = parseUserId(request.nextUrl.searchParams.get('userId'))
  if (rawUserId === 'invalid') {
    return NextResponse.json({ error: 'Invalid userId' }, { status: 400 })
  }

  try {
    const { workspaceId: rawWorkspaceId } = await params
    const workspaceId = await resolveWorkspaceId(rawWorkspaceId)
    const userId = rawUserId

    const result = await pool.query<{
      layout: unknown
      version: string
      revision: string
      updated_at: string
    }>(
      `SELECT layout, version, revision::text AS revision, updated_at
         FROM overlay_layouts
        WHERE workspace_id = $1
          AND user_id IS NOT DISTINCT FROM $2
        LIMIT 1`,
      [workspaceId, userId]
    )

    if (result.rowCount === 0) {
      return NextResponse.json({ error: 'Layout not found' }, { status: 404 })
    }

    const payload = buildEnvelope(result.rows[0])
    return NextResponse.json(payload)
  } catch (error) {
    console.error('Overlay layout fetch failed', error)
    return NextResponse.json({ error: 'Failed to load overlay layout' }, { status: 500 })
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  const rawUserId = parseUserId(request.nextUrl.searchParams.get('userId'))
  if (rawUserId === 'invalid') {
    return NextResponse.json({ error: 'Invalid userId' }, { status: 400 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Body must be an object' }, { status: 400 })
  }

  const parsedBody = body as Record<string, unknown>
  const bodyRevision = typeof parsedBody.revision === 'string' ? parsedBody.revision : null

  try {
    const { workspaceId: rawWorkspaceId } = await params
    const workspaceId = await resolveWorkspaceId(rawWorkspaceId)
    const userId = rawUserId

    const normalizedLayout = normalizeLayout(parsedBody.layout, { useServerTimestamp: true })
    const version =
      typeof parsedBody.version === 'string' && parsedBody.version.length > 0
        ? parsedBody.version
        : normalizedLayout.schemaVersion

    if (version !== normalizedLayout.schemaVersion) {
      return NextResponse.json(
        { error: 'Version mismatch with layout schemaVersion' },
        { status: 400 }
      )
    }

    const serializedLayout = JSON.stringify(normalizedLayout)
    if (Buffer.byteLength(serializedLayout, 'utf8') > MAX_LAYOUT_BYTES) {
      return NextResponse.json(
        { error: 'Layout payload exceeds allowed size' },
        { status: 413 }
      )
    }

    const client = await pool.connect()
    try {
      await client.query('BEGIN')

      const existing = await client.query<{
        id: string
        layout: unknown
        version: string
        revision: string
        updated_at: string
      }>(
        `SELECT id, layout, version, revision::text AS revision, updated_at
           FROM overlay_layouts
          WHERE workspace_id = $1
            AND user_id IS NOT DISTINCT FROM $2
          FOR UPDATE`,
        [workspaceId, userId]
      )

      if (existing.rowCount && existing.rowCount > 0) {
        const row = existing.rows[0]
        if (!bodyRevision || bodyRevision !== row.revision) {
          await client.query('ROLLBACK')
          const payload = buildEnvelope(row)
          return NextResponse.json(payload, { status: 409 })
        }

        const updated = await client.query<{
          layout: unknown
          version: string
          revision: string
          updated_at: string
        }>(
          `UPDATE overlay_layouts
              SET layout = $1,
                  version = $2,
                  revision = gen_random_uuid(),
                  updated_at = NOW(),
                  user_id = $3
            WHERE id = $4
        RETURNING layout, version, revision::text AS revision, updated_at`,
          [normalizedLayout, version, userId, row.id]
        )

        await client.query('COMMIT')
        const payload = buildEnvelope(updated.rows[0])
        return NextResponse.json(payload)
      }

      const inserted = await client.query<{
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
      const payload = buildEnvelope(inserted.rows[0])
      return NextResponse.json(payload)
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  } catch (error) {
    console.error('Overlay layout save failed', error)
    return NextResponse.json({ error: 'Failed to save overlay layout' }, { status: 500 })
  }
}
