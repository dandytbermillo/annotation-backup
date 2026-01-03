/**
 * Widget Store
 * Server-side database access for installed widgets and widget instances.
 * Reference: docs/proposal/chat-navigation/plan/panels/widget_manager/widget-manager-plan.md
 *
 * NOTE: This file is server-only. Import it only in API routes or server components.
 */

import { serverPool } from '@/lib/db/pool'
import type { PanelChatManifest } from '@/lib/panels/panel-manifest'
import { validateManifest } from '@/lib/panels/panel-manifest'

// ============================================================================
// Types
// ============================================================================

export type WidgetSourceType = 'url' | 'file' | 'store' | 'builtin'

export interface InstalledWidget {
  id: string
  user_id: string | null
  name: string
  slug: string
  source_type: WidgetSourceType
  source_ref: string | null
  version: string
  manifest: PanelChatManifest
  enabled: boolean
  created_at: string
  updated_at: string
}

export interface WidgetInstance {
  id: string
  user_id: string | null
  widget_id: string
  entry_id: string | null
  workspace_id: string | null
  panel_id: string
  config: Record<string, unknown> | null
  created_at: string
  updated_at: string
}

// Install Pipeline Types (Phase 2)
export interface InstallRequest {
  url: string
}

export type InstallErrorCode =
  | 'FETCH_FAILED'
  | 'INVALID_JSON'
  | 'INVALID_MANIFEST'
  | 'DUPLICATE_SLUG'
  | 'DB_ERROR'

export interface InstallError {
  code: InstallErrorCode
  message: string
  field?: string // For validation errors
}

export type InstallResult =
  | { success: true; widget: InstalledWidget }
  | { success: false; error: InstallError }

// ============================================================================
// Cache
// ============================================================================

// In-memory cache for widget manifests (server-side)
let manifestCache: {
  data: InstalledWidget[] | null
  timestamp: number
  userId: string | null
} = {
  data: null,
  timestamp: 0,
  userId: null,
}

const CACHE_TTL = 5 * 60 * 1000 // 5 minutes (per plan)

/**
 * Invalidate the manifest cache
 * Called on: install, uninstall, enable, disable
 */
export function invalidateWidgetCache(): void {
  manifestCache = {
    data: null,
    timestamp: 0,
    userId: null,
  }
}

// ============================================================================
// Installed Widgets
// ============================================================================

/**
 * List all installed widgets for a user
 */
export async function listInstalledWidgets(
  userId: string | null,
  options?: { enabledOnly?: boolean; forceRefresh?: boolean }
): Promise<InstalledWidget[]> {
  const now = Date.now()
  const cacheKey = userId || 'global'

  // Check cache (only for enabled-only queries)
  if (
    options?.enabledOnly &&
    !options?.forceRefresh &&
    manifestCache.data &&
    now - manifestCache.timestamp < CACHE_TTL &&
    manifestCache.userId === cacheKey
  ) {
    return manifestCache.data.filter(w => w.enabled)
  }

  try {
    let query = `
      SELECT id, user_id, name, slug, source_type, source_ref, version,
             manifest, enabled, created_at, updated_at
      FROM installed_widgets
      WHERE (user_id = $1 OR user_id IS NULL)
    `
    const params: (string | null)[] = [userId]

    if (options?.enabledOnly) {
      query += ` AND enabled = true`
    }

    query += ` ORDER BY created_at ASC`

    const result = await serverPool.query(query, params)

    const widgets: InstalledWidget[] = result.rows.map(row => ({
      id: row.id,
      user_id: row.user_id,
      name: row.name,
      slug: row.slug,
      source_type: row.source_type,
      source_ref: row.source_ref,
      version: row.version,
      manifest: row.manifest as PanelChatManifest,
      enabled: row.enabled,
      created_at: row.created_at,
      updated_at: row.updated_at,
    }))

    // Update cache
    if (options?.enabledOnly) {
      manifestCache = {
        data: widgets,
        timestamp: now,
        userId: cacheKey,
      }
    }

    return widgets
  } catch (error) {
    console.error('[widget-store] listInstalledWidgets error:', error)
    throw error
  }
}

/**
 * Get a single installed widget by ID
 */
export async function getInstalledWidget(
  widgetId: string,
  userId: string | null
): Promise<InstalledWidget | null> {
  try {
    const result = await serverPool.query(
      `SELECT id, user_id, name, slug, source_type, source_ref, version,
              manifest, enabled, created_at, updated_at
       FROM installed_widgets
       WHERE id = $1 AND (user_id = $2 OR user_id IS NULL)`,
      [widgetId, userId]
    )

    if (result.rows.length === 0) {
      return null
    }

    const row = result.rows[0]
    return {
      id: row.id,
      user_id: row.user_id,
      name: row.name,
      slug: row.slug,
      source_type: row.source_type,
      source_ref: row.source_ref,
      version: row.version,
      manifest: row.manifest as PanelChatManifest,
      enabled: row.enabled,
      created_at: row.created_at,
      updated_at: row.updated_at,
    }
  } catch (error) {
    console.error('[widget-store] getInstalledWidget error:', error)
    throw error
  }
}

/**
 * Enable or disable a widget
 */
export async function setWidgetEnabled(
  widgetId: string,
  userId: string | null,
  enabled: boolean
): Promise<boolean> {
  try {
    const result = await serverPool.query(
      `UPDATE installed_widgets
       SET enabled = $1, updated_at = now()
       WHERE id = $2 AND (user_id = $3 OR user_id IS NULL)
       RETURNING id`,
      [enabled, widgetId, userId]
    )

    // Invalidate cache on state change
    invalidateWidgetCache()

    return result.rows.length > 0
  } catch (error) {
    console.error('[widget-store] setWidgetEnabled error:', error)
    throw error
  }
}

/**
 * Get all enabled widget manifests for chat prompt injection
 * This is the key function for server-side manifest loading
 */
export async function getEnabledManifests(
  userId: string | null
): Promise<PanelChatManifest[]> {
  const widgets = await listInstalledWidgets(userId, { enabledOnly: true })
  return widgets.map(w => w.manifest)
}

// ============================================================================
// Install Pipeline (Phase 2 + Phase 2.5)
// ============================================================================

/**
 * Helper: Validate manifest and provide specific field feedback
 */
function getManifestValidationError(manifestJson: unknown): InstallError | null {
  if (!validateManifest(manifestJson)) {
    const m = manifestJson as Record<string, unknown>
    let field: string | undefined
    if (!m.panelId) field = 'panelId'
    else if (!m.panelType) field = 'panelType'
    else if (!m.title) field = 'title'
    else if (!m.version || m.version !== '1.0') field = 'version (must be "1.0")'
    else if (!Array.isArray(m.intents)) field = 'intents'

    return {
      code: 'INVALID_MANIFEST',
      message: field
        ? `Invalid manifest: missing or invalid "${field}"`
        : 'Invalid manifest: does not match PanelChatManifest schema',
      field,
    }
  }
  return null
}

/**
 * Helper: Install a validated manifest into the database
 */
async function installManifestToDB(
  manifest: PanelChatManifest,
  userId: string | null,
  sourceType: WidgetSourceType,
  sourceRef: string | null
): Promise<InstallResult> {
  // Generate slug from panelId and check for duplicates
  const slug = manifest.panelId.toLowerCase().replace(/[^a-z0-9-]/g, '-')

  try {
    const existing = await serverPool.query(
      `SELECT id FROM installed_widgets
       WHERE slug = $1 AND (user_id = $2 OR user_id IS NULL)`,
      [slug, userId]
    )

    if (existing.rows.length > 0) {
      return {
        success: false,
        error: {
          code: 'DUPLICATE_SLUG',
          message: `Widget with slug "${slug}" is already installed`,
        },
      }
    }
  } catch (error) {
    console.error('[widget-store] installManifestToDB duplicate check error:', error)
    return {
      success: false,
      error: {
        code: 'DB_ERROR',
        message: 'Database error while checking for duplicates',
      },
    }
  }

  // Insert into database
  try {
    const result = await serverPool.query(
      `INSERT INTO installed_widgets
       (user_id, name, slug, source_type, source_ref, version, manifest, enabled)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, user_id, name, slug, source_type, source_ref, version,
                 manifest, enabled, created_at, updated_at`,
      [
        userId,
        manifest.title,
        slug,
        sourceType,
        sourceRef,
        manifest.version || '1.0',
        JSON.stringify(manifest),
        true, // Enabled by default
      ]
    )

    // Invalidate cache after install
    invalidateWidgetCache()

    const row = result.rows[0]
    const widget: InstalledWidget = {
      id: row.id,
      user_id: row.user_id,
      name: row.name,
      slug: row.slug,
      source_type: row.source_type,
      source_ref: row.source_ref,
      version: row.version,
      manifest: row.manifest as PanelChatManifest,
      enabled: row.enabled,
      created_at: row.created_at,
      updated_at: row.updated_at,
    }

    return { success: true, widget }
  } catch (error) {
    console.error('[widget-store] installManifestToDB insert error:', error)
    return {
      success: false,
      error: {
        code: 'DB_ERROR',
        message: 'Database error while installing widget',
      },
    }
  }
}

/**
 * Install a widget from a URL
 * Fetches manifest, validates, and stores in DB
 */
export async function installWidgetFromUrl(
  url: string,
  userId: string | null
): Promise<InstallResult> {
  // Step 1: Fetch manifest from URL
  let manifestJson: unknown
  try {
    const response = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10000), // 10s timeout
    })

    if (!response.ok) {
      return {
        success: false,
        error: {
          code: 'FETCH_FAILED',
          message: `Failed to fetch manifest: HTTP ${response.status}`,
        },
      }
    }

    const contentType = response.headers.get('content-type') || ''
    if (!contentType.includes('application/json') && !contentType.includes('text/')) {
      return {
        success: false,
        error: {
          code: 'INVALID_JSON',
          message: `Invalid content type: ${contentType}. Expected JSON.`,
        },
      }
    }

    try {
      manifestJson = await response.json()
    } catch {
      return {
        success: false,
        error: {
          code: 'INVALID_JSON',
          message: 'Failed to parse manifest as JSON',
        },
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return {
      success: false,
      error: {
        code: 'FETCH_FAILED',
        message: `Failed to fetch manifest: ${message}`,
      },
    }
  }

  // Step 2: Validate manifest
  const validationError = getManifestValidationError(manifestJson)
  if (validationError) {
    return { success: false, error: validationError }
  }

  // Step 3: Install to DB
  return installManifestToDB(
    manifestJson as PanelChatManifest,
    userId,
    'url',
    url
  )
}

/**
 * Install a widget from a file (JSON manifest)
 * Phase 2.5: File import support
 */
export async function installWidgetFromFile(
  fileContent: string,
  fileName: string,
  userId: string | null
): Promise<InstallResult> {
  // Step 1: Parse JSON
  let manifestJson: unknown
  try {
    manifestJson = JSON.parse(fileContent)
  } catch {
    return {
      success: false,
      error: {
        code: 'INVALID_JSON',
        message: 'Failed to parse file as JSON',
      },
    }
  }

  // Step 2: Validate manifest
  const validationError = getManifestValidationError(manifestJson)
  if (validationError) {
    return { success: false, error: validationError }
  }

  // Step 3: Install to DB
  return installManifestToDB(
    manifestJson as PanelChatManifest,
    userId,
    'file',
    fileName
  )
}

/**
 * Uninstall a widget by ID
 */
export async function uninstallWidget(
  widgetId: string,
  userId: string | null
): Promise<boolean> {
  try {
    const result = await serverPool.query(
      `DELETE FROM installed_widgets
       WHERE id = $1 AND (user_id = $2 OR user_id IS NULL)
       RETURNING id`,
      [widgetId, userId]
    )

    // Invalidate cache after uninstall
    invalidateWidgetCache()

    return result.rows.length > 0
  } catch (error) {
    console.error('[widget-store] uninstallWidget error:', error)
    throw error
  }
}

// ============================================================================
// Widget Instances (Phase 1: read-only, for future use)
// ============================================================================

/**
 * List widget instances for a workspace
 */
export async function listWidgetInstances(
  workspaceId: string,
  userId: string | null
): Promise<WidgetInstance[]> {
  try {
    const result = await serverPool.query(
      `SELECT id, user_id, widget_id, entry_id, workspace_id, panel_id,
              config, created_at, updated_at
       FROM widget_instances
       WHERE workspace_id = $1 AND (user_id = $2 OR user_id IS NULL)
       ORDER BY created_at ASC`,
      [workspaceId, userId]
    )

    return result.rows.map(row => ({
      id: row.id,
      user_id: row.user_id,
      widget_id: row.widget_id,
      entry_id: row.entry_id,
      workspace_id: row.workspace_id,
      panel_id: row.panel_id,
      config: row.config,
      created_at: row.created_at,
      updated_at: row.updated_at,
    }))
  } catch (error) {
    console.error('[widget-store] listWidgetInstances error:', error)
    throw error
  }
}

/**
 * Create a widget instance (add widget to a dashboard/workspace)
 * This is called when a user adds an installed widget to their dashboard
 */
export async function createWidgetInstance(
  widgetId: string,
  userId: string | null,
  options: {
    entryId?: string | null
    workspaceId?: string | null
    panelId: string
    config?: Record<string, unknown> | null
  }
): Promise<WidgetInstance> {
  try {
    const result = await serverPool.query(
      `INSERT INTO widget_instances
       (user_id, widget_id, entry_id, workspace_id, panel_id, config)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, user_id, widget_id, entry_id, workspace_id, panel_id,
                 config, created_at, updated_at`,
      [
        userId,
        widgetId,
        options.entryId || null,
        options.workspaceId || null,
        options.panelId,
        options.config ? JSON.stringify(options.config) : null,
      ]
    )

    const row = result.rows[0]
    return {
      id: row.id,
      user_id: row.user_id,
      widget_id: row.widget_id,
      entry_id: row.entry_id,
      workspace_id: row.workspace_id,
      panel_id: row.panel_id,
      config: row.config,
      created_at: row.created_at,
      updated_at: row.updated_at,
    }
  } catch (error) {
    console.error('[widget-store] createWidgetInstance error:', error)
    throw error
  }
}

/**
 * Delete a widget instance (remove widget from dashboard)
 */
export async function deleteWidgetInstance(
  instanceId: string,
  userId: string | null
): Promise<boolean> {
  try {
    const result = await serverPool.query(
      `DELETE FROM widget_instances
       WHERE id = $1 AND (user_id = $2 OR user_id IS NULL)
       RETURNING id`,
      [instanceId, userId]
    )
    return result.rows.length > 0
  } catch (error) {
    console.error('[widget-store] deleteWidgetInstance error:', error)
    throw error
  }
}
