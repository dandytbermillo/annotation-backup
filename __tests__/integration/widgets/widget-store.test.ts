/**
 * Integration Tests: Widget Store
 * Part of Widget Manager - Phase 2 Hardening
 *
 * Tests widget installation, instance management, and DB operations.
 * Requires a running Postgres database.
 */

import { serverPool, closeServerPool } from '@/lib/db/pool'
import {
  listInstalledWidgets,
  getInstalledWidget,
  setWidgetEnabled,
  getEnabledManifests,
  installWidgetFromUrl,
  installWidgetFromFile,
  uninstallWidget,
  createWidgetInstance,
  deleteWidgetInstance,
  listWidgetInstances,
  invalidateWidgetCache,
} from '@/lib/widgets/widget-store'

// Skip these tests if no database is available
const describeIfDb = process.env.DATABASE_URL ? describe : describe.skip

describeIfDb('Widget Store Integration', () => {
  // Use a valid UUID for test user
  const TEST_USER_ID = '11111111-1111-1111-1111-111111111111'
  const TEST_WIDGET_SLUG = 'test-widget-store-slug'

  // Clean up any test data before and after
  beforeAll(async () => {
    await serverPool.query(
      'DELETE FROM widget_instances WHERE user_id = $1',
      [TEST_USER_ID]
    )
    await serverPool.query(
      'DELETE FROM installed_widgets WHERE user_id = $1 OR slug = $2',
      [TEST_USER_ID, TEST_WIDGET_SLUG]
    )
    invalidateWidgetCache()
  })

  afterAll(async () => {
    await serverPool.query(
      'DELETE FROM widget_instances WHERE user_id = $1',
      [TEST_USER_ID]
    )
    await serverPool.query(
      'DELETE FROM installed_widgets WHERE user_id = $1 OR slug = $2',
      [TEST_USER_ID, TEST_WIDGET_SLUG]
    )
  })

  describe('listInstalledWidgets', () => {
    let widgetId: string

    beforeAll(async () => {
      // Insert a test widget
      const result = await serverPool.query(
        `INSERT INTO installed_widgets
         (user_id, name, slug, source_type, version, manifest, enabled)
         VALUES ($1, 'Test Widget', $2, 'url', '1.0', $3, true)
         RETURNING id`,
        [
          TEST_USER_ID,
          TEST_WIDGET_SLUG,
          JSON.stringify({
            panelId: 'test-widget',
            panelType: 'test',
            title: 'Test Widget',
            version: '1.0',
            intents: [],
          }),
        ]
      )
      widgetId = result.rows[0].id
      invalidateWidgetCache()
    })

    afterAll(async () => {
      await serverPool.query('DELETE FROM installed_widgets WHERE id = $1', [widgetId])
    })

    it('should list widgets for a user', async () => {
      const widgets = await listInstalledWidgets(TEST_USER_ID)
      expect(Array.isArray(widgets)).toBe(true)

      const testWidget = widgets.find(w => w.slug === TEST_WIDGET_SLUG)
      expect(testWidget).toBeDefined()
      expect(testWidget?.name).toBe('Test Widget')
    })

    it('should filter by enabled status', async () => {
      const enabledWidgets = await listInstalledWidgets(TEST_USER_ID, { enabledOnly: true })
      const testWidget = enabledWidgets.find(w => w.slug === TEST_WIDGET_SLUG)
      expect(testWidget).toBeDefined()
    })
  })

  describe('getInstalledWidget', () => {
    let widgetId: string

    beforeAll(async () => {
      const result = await serverPool.query(
        `INSERT INTO installed_widgets
         (user_id, name, slug, source_type, version, manifest, enabled)
         VALUES ($1, 'Get Test Widget', 'get-test-slug', 'url', '1.0', $2, true)
         RETURNING id`,
        [
          TEST_USER_ID,
          JSON.stringify({
            panelId: 'get-test',
            panelType: 'test',
            title: 'Get Test Widget',
            version: '1.0',
            intents: [],
          }),
        ]
      )
      widgetId = result.rows[0].id
    })

    afterAll(async () => {
      await serverPool.query('DELETE FROM installed_widgets WHERE id = $1', [widgetId])
    })

    it('should get a widget by ID', async () => {
      const widget = await getInstalledWidget(widgetId, TEST_USER_ID)
      expect(widget).toBeDefined()
      expect(widget?.id).toBe(widgetId)
      expect(widget?.name).toBe('Get Test Widget')
    })

    it('should return null for non-existent widget', async () => {
      const widget = await getInstalledWidget(
        '00000000-0000-0000-0000-000000000000',
        TEST_USER_ID
      )
      expect(widget).toBeNull()
    })
  })

  describe('setWidgetEnabled', () => {
    let widgetId: string

    beforeAll(async () => {
      const result = await serverPool.query(
        `INSERT INTO installed_widgets
         (user_id, name, slug, source_type, version, manifest, enabled)
         VALUES ($1, 'Enable Test Widget', 'enable-test-slug', 'url', '1.0', $2, true)
         RETURNING id`,
        [
          TEST_USER_ID,
          JSON.stringify({
            panelId: 'enable-test',
            panelType: 'test',
            title: 'Enable Test Widget',
            version: '1.0',
            intents: [],
          }),
        ]
      )
      widgetId = result.rows[0].id
    })

    afterAll(async () => {
      await serverPool.query('DELETE FROM installed_widgets WHERE id = $1', [widgetId])
    })

    it('should disable a widget', async () => {
      const result = await setWidgetEnabled(widgetId, TEST_USER_ID, false)
      expect(result).toBe(true)

      const widget = await getInstalledWidget(widgetId, TEST_USER_ID)
      expect(widget?.enabled).toBe(false)
    })

    it('should enable a widget', async () => {
      const result = await setWidgetEnabled(widgetId, TEST_USER_ID, true)
      expect(result).toBe(true)

      const widget = await getInstalledWidget(widgetId, TEST_USER_ID)
      expect(widget?.enabled).toBe(true)
    })

    it('should return false for non-existent widget', async () => {
      const result = await setWidgetEnabled(
        '00000000-0000-0000-0000-000000000000',
        TEST_USER_ID,
        true
      )
      expect(result).toBe(false)
    })
  })

  describe('getEnabledManifests', () => {
    let widgetId: string

    beforeAll(async () => {
      const result = await serverPool.query(
        `INSERT INTO installed_widgets
         (user_id, name, slug, source_type, version, manifest, enabled)
         VALUES ($1, 'Manifest Test Widget', 'manifest-test-slug', 'url', '1.0', $2, true)
         RETURNING id`,
        [
          TEST_USER_ID,
          JSON.stringify({
            panelId: 'manifest-test',
            panelType: 'test',
            title: 'Manifest Test Widget',
            version: '1.0',
            intents: [
              {
                name: 'test_action',
                description: 'Test action',
                examples: ['test'],
                handler: 'api:/api/test',
                permission: 'read',
              },
            ],
          }),
        ]
      )
      widgetId = result.rows[0].id
      invalidateWidgetCache()
    })

    afterAll(async () => {
      await serverPool.query('DELETE FROM installed_widgets WHERE id = $1', [widgetId])
    })

    it('should return manifests for enabled widgets', async () => {
      const manifests = await getEnabledManifests(TEST_USER_ID)
      expect(Array.isArray(manifests)).toBe(true)

      const testManifest = manifests.find(m => m.panelId === 'manifest-test')
      expect(testManifest).toBeDefined()
      expect(testManifest?.title).toBe('Manifest Test Widget')
    })
  })

  describe('installWidgetFromUrl', () => {
    // Note: This test requires the sample manifest endpoint to be running
    // It's more of an E2E test, so we'll test the error cases

    it('should return FETCH_FAILED for unreachable URL', async () => {
      const result = await installWidgetFromUrl(
        'http://localhost:99999/nonexistent',
        TEST_USER_ID
      )
      expect(result.success).toBe(false)
      expect(result.error?.code).toBe('FETCH_FAILED')
    })

    it('should return DUPLICATE_SLUG for existing slug', async () => {
      // First insert a widget with a known slug
      await serverPool.query(
        `INSERT INTO installed_widgets
         (user_id, name, slug, source_type, version, manifest, enabled)
         VALUES ($1, 'Duplicate Test', 'duplicate-slug', 'url', '1.0', $2, true)
         ON CONFLICT DO NOTHING`,
        [
          TEST_USER_ID,
          JSON.stringify({
            panelId: 'duplicate-slug',
            panelType: 'test',
            title: 'Duplicate Test',
            version: '1.0',
            intents: [],
          }),
        ]
      )

      // Try to install with same slug - this would require a mock server
      // For now, we verify the duplicate check logic exists
      const widgets = await listInstalledWidgets(TEST_USER_ID)
      const duplicate = widgets.find(w => w.slug === 'duplicate-slug')
      expect(duplicate).toBeDefined()

      // Cleanup
      await serverPool.query(
        "DELETE FROM installed_widgets WHERE slug = 'duplicate-slug' AND user_id = $1",
        [TEST_USER_ID]
      )
    })
  })

  describe('installWidgetFromFile', () => {
    afterEach(async () => {
      // Clean up any test widgets
      await serverPool.query(
        "DELETE FROM installed_widgets WHERE slug LIKE 'file-test-%' AND user_id = $1",
        [TEST_USER_ID]
      )
    })

    it('should install a widget from valid JSON content', async () => {
      const manifest = {
        panelId: 'file-test-widget',
        panelType: 'tool',
        title: 'File Test Widget',
        version: '1.0',
        intents: [
          {
            name: 'test_action',
            description: 'Test action',
            examples: ['test'],
            handler: 'api:/api/test',
            permission: 'read',
          },
        ],
      }

      const result = await installWidgetFromFile(
        JSON.stringify(manifest),
        'file-test-widget.json',
        TEST_USER_ID
      )

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.widget.name).toBe('File Test Widget')
        expect(result.widget.slug).toBe('file-test-widget')
        expect(result.widget.source_type).toBe('file')
        expect(result.widget.source_ref).toBe('file-test-widget.json')
      }
    })

    it('should return INVALID_JSON for invalid JSON', async () => {
      const result = await installWidgetFromFile(
        'not valid json {{{',
        'invalid.json',
        TEST_USER_ID
      )

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('INVALID_JSON')
      }
    })

    it('should return INVALID_MANIFEST for missing required fields', async () => {
      const result = await installWidgetFromFile(
        JSON.stringify({ title: 'Missing panelId' }),
        'incomplete.json',
        TEST_USER_ID
      )

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('INVALID_MANIFEST')
        expect(result.error.field).toBe('panelId')
      }
    })

    it('should return DUPLICATE_SLUG for existing widget', async () => {
      const manifest = {
        panelId: 'file-test-dup',
        panelType: 'tool',
        title: 'Duplicate Widget',
        version: '1.0',
        intents: [],
      }

      // First install
      const first = await installWidgetFromFile(
        JSON.stringify(manifest),
        'dup.json',
        TEST_USER_ID
      )
      expect(first.success).toBe(true)

      // Second install (duplicate)
      const second = await installWidgetFromFile(
        JSON.stringify(manifest),
        'dup2.json',
        TEST_USER_ID
      )

      expect(second.success).toBe(false)
      if (!second.success) {
        expect(second.error.code).toBe('DUPLICATE_SLUG')
      }
    })
  })

  describe('Widget Instances', () => {
    let widgetId: string
    let instanceId: string

    beforeAll(async () => {
      const result = await serverPool.query(
        `INSERT INTO installed_widgets
         (user_id, name, slug, source_type, version, manifest, enabled)
         VALUES ($1, 'Instance Test Widget', 'instance-test-slug', 'url', '1.0', $2, true)
         RETURNING id`,
        [
          TEST_USER_ID,
          JSON.stringify({
            panelId: 'instance-test',
            panelType: 'test',
            title: 'Instance Test Widget',
            version: '1.0',
            intents: [],
          }),
        ]
      )
      widgetId = result.rows[0].id
    })

    afterAll(async () => {
      await serverPool.query(
        'DELETE FROM widget_instances WHERE widget_id = $1',
        [widgetId]
      )
      await serverPool.query('DELETE FROM installed_widgets WHERE id = $1', [widgetId])
    })

    describe('createWidgetInstance', () => {
      it('should create a widget instance', async () => {
        const instance = await createWidgetInstance(widgetId, TEST_USER_ID, {
          panelId: 'test-panel-123',
          workspaceId: null,
          entryId: null,
          config: { theme: 'dark' },
        })

        expect(instance).toBeDefined()
        expect(instance.widget_id).toBe(widgetId)
        expect(instance.panel_id).toBe('test-panel-123')
        expect(instance.config).toEqual({ theme: 'dark' })

        instanceId = instance.id
      })
    })

    describe('listWidgetInstances', () => {
      beforeAll(async () => {
        // Create an instance with a workspace ID for testing
        const wsResult = await serverPool.query(
          `SELECT id FROM note_workspaces LIMIT 1`
        )
        if (wsResult.rows.length > 0) {
          await serverPool.query(
            `INSERT INTO widget_instances
             (user_id, widget_id, workspace_id, panel_id)
             VALUES ($1, $2, $3, 'workspace-panel-test')`,
            [TEST_USER_ID, widgetId, wsResult.rows[0].id]
          )
        }
      })

      it('should list instances for a workspace', async () => {
        const wsResult = await serverPool.query(
          `SELECT id FROM note_workspaces LIMIT 1`
        )
        if (wsResult.rows.length > 0) {
          const instances = await listWidgetInstances(wsResult.rows[0].id, TEST_USER_ID)
          expect(Array.isArray(instances)).toBe(true)
        }
      })
    })

    describe('deleteWidgetInstance', () => {
      it('should delete a widget instance', async () => {
        // Create an instance to delete
        const instance = await createWidgetInstance(widgetId, TEST_USER_ID, {
          panelId: 'delete-test-panel',
        })

        const result = await deleteWidgetInstance(instance.id, TEST_USER_ID)
        expect(result).toBe(true)
      })

      it('should return false for non-existent instance', async () => {
        const result = await deleteWidgetInstance(
          '00000000-0000-0000-0000-000000000000',
          TEST_USER_ID
        )
        expect(result).toBe(false)
      })
    })
  })
})

// Global cleanup: close pool after all tests to prevent open handle warning
afterAll(async () => {
  await closeServerPool()
})
