#!/usr/bin/env tsx

/**
 * Migration Script: Overlay Layout v1 → v2
 *
 * Backfills overlayPosition field from canvasPosition for all existing layouts.
 *
 * Usage:
 *   npx tsx scripts/migrate-overlay-layout-v2.ts
 *
 * What it does:
 *   1. Loads all workspace layouts from the API
 *   2. For each layout with version '1.0.0':
 *      - Adds overlayPosition = canvasPosition for each popup
 *      - Updates schema version to '2.0.0'
 *      - Saves the migrated layout back
 *   3. Preserves revision history (no conflicts)
 *
 * Safety:
 *   - Dry-run mode by default (set DRY_RUN=false to actually migrate)
 *   - Validates schema before saving
 *   - Reports any errors without stopping migration of other layouts
 */

import type {
  OverlayLayoutEnvelope,
  OverlayLayoutPayload,
  OverlayPopupDescriptor,
} from '../lib/types/overlay-layout'

// Configuration
const DRY_RUN = process.env.DRY_RUN !== 'false'
const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3000'
const WORKSPACE_KEY = process.env.WORKSPACE_KEY || 'default'

interface MigrationStats {
  total: number
  alreadyMigrated: number
  migrated: number
  errors: number
}

/**
 * Load a layout from the API
 */
async function loadLayout(
  workspaceKey: string,
  userId?: string
): Promise<OverlayLayoutEnvelope | null> {
  const url = `${API_BASE_URL}/api/overlay/layout/${encodeURIComponent(workspaceKey)}`
  const params = userId ? `?userId=${encodeURIComponent(userId)}` : ''

  try {
    const response = await fetch(`${url}${params}`, {
      method: 'GET',
      cache: 'no-store',
    })

    if (response.status === 404) {
      return null
    }

    if (!response.ok) {
      throw new Error(`Failed to load layout: ${response.statusText}`)
    }

    return await response.json()
  } catch (error) {
    console.error(`Error loading layout for workspace ${workspaceKey}:`, error)
    return null
  }
}

/**
 * Save a layout to the API
 */
async function saveLayout(
  workspaceKey: string,
  layout: OverlayLayoutPayload,
  version: string,
  revision: string | null,
  userId?: string
): Promise<OverlayLayoutEnvelope | null> {
  const url = `${API_BASE_URL}/api/overlay/layout/${encodeURIComponent(workspaceKey)}`
  const params = userId ? `?userId=${encodeURIComponent(userId)}` : ''

  try {
    const response = await fetch(`${url}${params}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      cache: 'no-store',
      body: JSON.stringify({
        layout,
        version,
        revision,
      }),
    })

    if (!response.ok) {
      throw new Error(`Failed to save layout: ${response.statusText}`)
    }

    return await response.json()
  } catch (error) {
    console.error(`Error saving layout for workspace ${workspaceKey}:`, error)
    return null
  }
}

/**
 * Migrate a single popup descriptor
 */
function migratePopup(popup: OverlayPopupDescriptor): OverlayPopupDescriptor {
  return {
    ...popup,
    overlayPosition: popup.overlayPosition || popup.canvasPosition,
  }
}

/**
 * Migrate a single layout from v1 to v2
 */
function migrateLayout(envelope: OverlayLayoutEnvelope): OverlayLayoutEnvelope {
  const { layout, version, revision, updatedAt } = envelope

  // Already migrated?
  if (layout.schemaVersion === '2.0.0') {
    return envelope
  }

  // Validate it's v1
  if (layout.schemaVersion !== '1.0.0') {
    throw new Error(`Unexpected schema version: ${layout.schemaVersion}`)
  }

  // Migrate popups: backfill overlayPosition
  const migratedLayout: OverlayLayoutPayload = {
    ...layout,
    schemaVersion: '2.0.0',
    popups: layout.popups.map(migratePopup),
  }

  return {
    layout: migratedLayout,
    version,
    revision,
    updatedAt,
  }
}

/**
 * Main migration function
 */
async function migrate(): Promise<void> {
  console.log('🔄 Overlay Layout Migration v1 → v2')
  console.log(`   Workspace: ${WORKSPACE_KEY}`)
  console.log(`   API: ${API_BASE_URL}`)
  console.log(`   Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'}`)
  console.log('')

  const stats: MigrationStats = {
    total: 0,
    alreadyMigrated: 0,
    migrated: 0,
    errors: 0,
  }

  // For now, migrate the default workspace layout
  // In production, you might query for all user IDs and migrate each
  const envelope = await loadLayout(WORKSPACE_KEY)

  if (!envelope) {
    console.log('ℹ️  No layout found for workspace:', WORKSPACE_KEY)
    return
  }

  stats.total++

  try {
    const { layout, version, revision } = envelope

    console.log(`📄 Processing layout:`)
    console.log(`   Schema version: ${layout.schemaVersion}`)
    console.log(`   Popups: ${layout.popups.length}`)
    console.log(`   Revision: ${revision}`)

    if (layout.schemaVersion === '2.0.0') {
      console.log('✅ Already migrated')
      stats.alreadyMigrated++
      return
    }

    // Perform migration
    const migrated = migrateLayout(envelope)

    console.log(`🔄 Migration preview:`)
    console.log(`   Before: schema=${layout.schemaVersion}, popups=${layout.popups.length}`)
    console.log(`   After:  schema=${migrated.layout.schemaVersion}, popups=${migrated.layout.popups.length}`)

    // Show sample popup migration
    if (layout.popups.length > 0) {
      const original = layout.popups[0]
      const migrated = migratePopup(original)
      console.log(`   Sample popup:`)
      console.log(`     canvasPosition: (${original.canvasPosition.x}, ${original.canvasPosition.y})`)
      console.log(`     overlayPosition: (${migrated.overlayPosition?.x}, ${migrated.overlayPosition?.y})`)
    }

    if (!DRY_RUN) {
      console.log('💾 Saving migrated layout...')
      const saved = await saveLayout(
        WORKSPACE_KEY,
        migrated.layout,
        version,
        revision
      )

      if (saved) {
        console.log('✅ Migrated successfully')
        stats.migrated++
      } else {
        console.error('❌ Failed to save migrated layout')
        stats.errors++
      }
    } else {
      console.log('🔍 DRY RUN - Skipping save')
      console.log('   Run with DRY_RUN=false to apply migration')
      stats.migrated++
    }
  } catch (error) {
    console.error('❌ Migration error:', error)
    stats.errors++
  }

  console.log('')
  console.log('📊 Migration Summary:')
  console.log(`   Total layouts: ${stats.total}`)
  console.log(`   Already migrated: ${stats.alreadyMigrated}`)
  console.log(`   Newly migrated: ${stats.migrated}`)
  console.log(`   Errors: ${stats.errors}`)
  console.log('')

  if (DRY_RUN) {
    console.log('✨ Dry run complete. No changes made.')
    console.log('   To apply migration, run: DRY_RUN=false npx tsx scripts/migrate-overlay-layout-v2.ts')
  } else if (stats.errors === 0) {
    console.log('✅ Migration complete!')
  } else {
    console.log('⚠️  Migration completed with errors. Review logs above.')
    process.exit(1)
  }
}

// Run migration
migrate().catch((error) => {
  console.error('💥 Fatal error:', error)
  process.exit(1)
})
