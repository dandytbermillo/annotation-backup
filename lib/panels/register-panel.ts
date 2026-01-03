/**
 * Panel Registration Helpers
 *
 * Allows third-party panels to register manifests at runtime.
 * Keeps registry interactions centralized and idempotent.
 */

import type { PanelChatManifest } from './panel-manifest'
import { panelRegistry } from './panel-registry'
import { debugLog } from '@/lib/utils/debug-logger'

/**
 * Register a single panel manifest.
 */
export function registerPanelManifest(manifest: PanelChatManifest): boolean {
  const existing = panelRegistry.get(manifest.panelId)
  if (existing) {
    debugLog({
      component: 'PanelRegistry',
      action: 'register_skip',
      content_preview: `Panel ${manifest.panelId} already registered`,
      metadata: { panelId: manifest.panelId }
    })
    return true
  }
  const success = panelRegistry.register(manifest)
  debugLog({
    component: 'PanelRegistry',
    action: 'register_manifest',
    content_preview: `Registered panel ${manifest.panelId}: ${success}`,
    metadata: {
      panelId: manifest.panelId,
      panelType: manifest.panelType,
      intentCount: manifest.intents?.length ?? 0,
      success
    }
  })
  return success
}

/**
 * Register multiple panel manifests.
 */
export function registerPanelManifests(manifests: PanelChatManifest[]): void {
  for (const manifest of manifests) {
    registerPanelManifest(manifest)
  }
}

/**
 * Check if a panel is already registered.
 */
export function isPanelRegistered(panelId: string): boolean {
  return Boolean(panelRegistry.get(panelId))
}
