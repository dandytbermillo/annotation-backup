import { NextRequest, NextResponse } from 'next/server'

import { parseUserId } from '../../layout/shared'
import { getWorkspacePool } from '../_pool'

const pool = getWorkspacePool()

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  const rawUserId = parseUserId(request.nextUrl.searchParams.get('userId'))
  if (rawUserId === 'invalid') {
    return NextResponse.json({ error: 'Invalid userId' }, { status: 400 })
  }

  const { workspaceId } = await params
  if (!workspaceId) {
    return NextResponse.json({ error: 'workspaceId is required' }, { status: 400 })
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const workspaceResult = await client.query<{ is_default: boolean; name: string }>(
      `SELECT is_default, name
         FROM workspaces
        WHERE id = $1
        LIMIT 1`,
      [workspaceId]
    )

    if (workspaceResult.rowCount === 0) {
      await client.query('ROLLBACK')
      return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
    }

    if (workspaceResult.rows[0].is_default) {
      await client.query('ROLLBACK')
      return NextResponse.json(
        { error: 'Default workspace cannot be deleted' },
        { status: 400 }
      )
    }

    await client.query('DELETE FROM workspaces WHERE id = $1', [workspaceId])
    await client.query('COMMIT')

    return NextResponse.json({ ok: true })
  } catch (error) {
    await client.query('ROLLBACK')
    console.error('Overlay workspace delete failed', error)
    return NextResponse.json({ error: 'Failed to delete workspace' }, { status: 500 })
  } finally {
    client.release()
  }
}
