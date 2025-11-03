import { NextRequest, NextResponse } from 'next/server'
import { Pool } from 'pg'

import { WorkspaceStore } from '@/lib/workspace/workspace-store'

import {
  MAX_LAYOUT_BYTES,
  buildEnvelope,
  normalizeLayout,
  parseUserId,
} from '../shared'

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/annotation_dev',
})

async function resolveWorkspaceId(raw?: string): Promise<string> {
  if (!raw || raw === 'default') {
    return WorkspaceStore.getDefaultWorkspaceId(pool)
  }
  return raw
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
