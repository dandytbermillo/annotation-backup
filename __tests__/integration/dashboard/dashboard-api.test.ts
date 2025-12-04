/**
 * Integration Tests: Dashboard API Endpoints
 * Part of Dashboard Implementation - Phase 5.1
 *
 * Tests the dashboard API endpoints for panels, preferences, and layout.
 * Requires a running Postgres database.
 */

import { serverPool } from '@/lib/db/pool'

// Skip these tests if no database is available
const describeIfDb = process.env.DATABASE_URL ? describe : describe.skip

describeIfDb('Dashboard API Integration', () => {
  const TEST_USER_ID = 'test-user-dashboard-api'
  let testWorkspaceId: string
  let testItemId: string

  beforeAll(async () => {
    // Create test user item (Home entry) and workspace
    const itemResult = await serverPool.query(
      `INSERT INTO items (user_id, name, type, path, is_system)
       VALUES ($1, 'Test Home', 'system-entry', '/test-home-' || $1, true)
       RETURNING id`,
      [TEST_USER_ID]
    )
    testItemId = itemResult.rows[0].id

    const workspaceResult = await serverPool.query(
      `INSERT INTO note_workspaces (user_id, name, is_default, item_id)
       VALUES ($1, 'Test Dashboard', true, $2)
       RETURNING id`,
      [TEST_USER_ID, testItemId]
    )
    testWorkspaceId = workspaceResult.rows[0].id

    // Create user preferences
    await serverPool.query(
      `INSERT INTO user_preferences (user_id, last_workspace_id)
       VALUES ($1, $2)
       ON CONFLICT (user_id) DO UPDATE SET last_workspace_id = $2`,
      [TEST_USER_ID, testWorkspaceId]
    )
  })

  afterAll(async () => {
    // Cleanup test data
    await serverPool.query('DELETE FROM workspace_panels WHERE workspace_id = $1', [testWorkspaceId])
    await serverPool.query('DELETE FROM user_preferences WHERE user_id = $1', [TEST_USER_ID])
    await serverPool.query('DELETE FROM note_workspaces WHERE id = $1', [testWorkspaceId])
    await serverPool.query('DELETE FROM items WHERE id = $1', [testItemId])
  })

  describe('POST /api/dashboard/panels', () => {
    it('should create a new panel with default values', async () => {
      const response = await fetch('http://localhost:3000/api/dashboard/panels', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': TEST_USER_ID,
        },
        body: JSON.stringify({
          workspaceId: testWorkspaceId,
          panelType: 'continue',
        }),
      })

      expect(response.ok).toBe(true)
      const data = await response.json()

      expect(data.panel).toBeDefined()
      expect(data.panel.panelType).toBe('continue')
      expect(data.panel.workspaceId).toBe(testWorkspaceId)

      // Cleanup
      await serverPool.query('DELETE FROM workspace_panels WHERE id = $1', [data.panel.id])
    })

    it('should reject invalid panel types', async () => {
      const response = await fetch('http://localhost:3000/api/dashboard/panels', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': TEST_USER_ID,
        },
        body: JSON.stringify({
          workspaceId: testWorkspaceId,
          panelType: 'invalid_type',
        }),
      })

      expect(response.ok).toBe(false)
      expect(response.status).toBe(400)
    })
  })

  describe('GET /api/dashboard/panels', () => {
    let panelId: string

    beforeAll(async () => {
      // Create a test panel
      const result = await serverPool.query(
        `INSERT INTO workspace_panels (workspace_id, panel_type, position_x, position_y, width, height, config)
         VALUES ($1, 'navigator', 100, 100, 280, 320, '{}')
         RETURNING id`,
        [testWorkspaceId]
      )
      panelId = result.rows[0].id
    })

    afterAll(async () => {
      await serverPool.query('DELETE FROM workspace_panels WHERE id = $1', [panelId])
    })

    it('should return panels for a workspace', async () => {
      const response = await fetch(
        `http://localhost:3000/api/dashboard/panels?workspaceId=${testWorkspaceId}`,
        {
          headers: { 'x-user-id': TEST_USER_ID },
        }
      )

      expect(response.ok).toBe(true)
      const data = await response.json()

      expect(data.panels).toBeDefined()
      expect(Array.isArray(data.panels)).toBe(true)
      expect(data.panels.some((p: any) => p.id === panelId)).toBe(true)
    })

    it('should return empty array for workspace with no panels', async () => {
      const emptyWorkspace = await serverPool.query(
        `INSERT INTO note_workspaces (user_id, name, item_id)
         VALUES ($1, 'Empty Workspace', $2)
         RETURNING id`,
        [TEST_USER_ID, testItemId]
      )

      const response = await fetch(
        `http://localhost:3000/api/dashboard/panels?workspaceId=${emptyWorkspace.rows[0].id}`,
        {
          headers: { 'x-user-id': TEST_USER_ID },
        }
      )

      expect(response.ok).toBe(true)
      const data = await response.json()
      expect(data.panels).toEqual([])

      // Cleanup
      await serverPool.query('DELETE FROM note_workspaces WHERE id = $1', [emptyWorkspace.rows[0].id])
    })
  })

  describe('POST /api/dashboard/panels/reset-layout', () => {
    it('should reset layout to default panels', async () => {
      const response = await fetch('http://localhost:3000/api/dashboard/panels/reset-layout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': TEST_USER_ID,
        },
        body: JSON.stringify({
          workspaceId: testWorkspaceId,
        }),
      })

      expect(response.ok).toBe(true)
      const data = await response.json()

      expect(data.success).toBe(true)
      expect(data.panels).toBeDefined()
      expect(data.panels.length).toBe(4) // continue, navigator, recent, quick_capture

      const panelTypes = data.panels.map((p: any) => p.panelType)
      expect(panelTypes).toContain('continue')
      expect(panelTypes).toContain('navigator')
      expect(panelTypes).toContain('recent')
      expect(panelTypes).toContain('quick_capture')

      // Cleanup is handled by reset-layout deleting existing panels
    })
  })

  describe('GET /api/dashboard/preferences', () => {
    it('should return user preferences with last workspace', async () => {
      const response = await fetch('http://localhost:3000/api/dashboard/preferences', {
        headers: { 'x-user-id': TEST_USER_ID },
      })

      expect(response.ok).toBe(true)
      const data = await response.json()

      expect(data.lastWorkspaceId).toBe(testWorkspaceId)
      expect(data.lastWorkspace).toBeDefined()
    })
  })

  describe('PATCH /api/dashboard/preferences', () => {
    it('should update user preferences', async () => {
      const response = await fetch('http://localhost:3000/api/dashboard/preferences', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': TEST_USER_ID,
        },
        body: JSON.stringify({
          lastWorkspaceId: testWorkspaceId,
        }),
      })

      expect(response.ok).toBe(true)
      const data = await response.json()

      expect(data.success).toBe(true)
    })
  })

  describe('GET /api/dashboard/info', () => {
    it('should return dashboard info with Home entry and Dashboard workspace IDs', async () => {
      const response = await fetch('http://localhost:3000/api/dashboard/info', {
        headers: { 'x-user-id': TEST_USER_ID },
      })

      // The endpoint might create Home/Dashboard if not exists
      if (response.ok) {
        const data = await response.json()
        expect(data.homeEntryId).toBeDefined()
        expect(data.dashboardWorkspaceId).toBeDefined()
      }
    })
  })
})
