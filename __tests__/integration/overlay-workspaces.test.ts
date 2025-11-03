import { Pool } from 'pg'
import {
  POST as overlayWorkspacesPost,
  GET as overlayWorkspacesGet,
  __testing__closeOverlayWorkspacePool,
} from '@/app/api/overlay/workspaces/route'
import { NextRequest } from 'next/server'

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/annotation_dev',
})

const TEST_NAME_PREFIX = 'Test Overlay Workspace'

async function cleanupTestWorkspaces() {
  const client = await pool.connect()
  try {
    await client.query(
      `DELETE FROM overlay_layouts
        WHERE workspace_id IN (
          SELECT id FROM workspaces WHERE name LIKE $1
        )`,
      [`${TEST_NAME_PREFIX}%`]
    )

    await client.query('DELETE FROM workspaces WHERE name LIKE $1', [`${TEST_NAME_PREFIX}%`])
  } finally {
    client.release()
  }
}

function buildLayoutPayload() {
  const now = new Date().toISOString()
  return {
    schemaVersion: '2.0.0',
    popups: [
      {
        id: `popup-${Date.now()}`,
        folderId: 'test-folder-id',
        parentId: null,
        canvasPosition: { x: 160, y: 240 },
        level: 0,
      },
    ],
    inspectors: [],
    lastSavedAt: now,
  }
}

describe('/api/overlay/workspaces', () => {
  beforeEach(async () => {
    await cleanupTestWorkspaces()
  })

  afterAll(async () => {
    await cleanupTestWorkspaces()
    await pool.end()
    await __testing__closeOverlayWorkspacePool()
  })

  it('returns at least the default workspace entry', async () => {
    const response = await overlayWorkspacesGet()
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(Array.isArray(payload.workspaces)).toBe(true)
    expect(payload.workspaces.length).toBeGreaterThan(0)

    const names = payload.workspaces.map((ws: any) => ws.name)
    expect(names.some((name: string) => typeof name === 'string' && name.length > 0)).toBe(true)
  })

  it('creates and lists a new overlay workspace with snapshot metadata', async () => {
    const layout = buildLayoutPayload()
    const request = new NextRequest('http://localhost:3000/api/overlay/workspaces', {
      method: 'POST',
      body: JSON.stringify({
        layout,
        version: '2.0.0',
        nameHint: `${TEST_NAME_PREFIX} ${Date.now()}`,
      }),
      headers: { 'Content-Type': 'application/json' },
    })

    const postResponse = await overlayWorkspacesPost(request)
    const postPayload = await postResponse.json()

    expect(postResponse.status).toBe(200)
    expect(postPayload.workspace).toBeDefined()
    expect(typeof postPayload.workspace.id).toBe('string')
    expect(postPayload.workspace.popupCount).toBe(1)
    expect(postPayload.envelope.layout.popups).toHaveLength(1)

    const fetchResponse = await overlayWorkspacesGet()
    const listPayload = await fetchResponse.json()

    expect(fetchResponse.status).toBe(200)
    const created = listPayload.workspaces.find(
      (workspace: any) => workspace.id === postPayload.workspace.id
    )
    expect(created).toBeDefined()
    expect(created.popupCount).toBe(1)
  })
})
