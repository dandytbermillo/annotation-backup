/**
 * Surface Manifest Definitions — Phase C
 *
 * Concrete manifest definitions for built-in non-note surfaces.
 * Uses the shared SurfaceManifestEntry schema from Phase B.
 *
 * Registration is explicit via registerBuiltInSurfaceManifests() —
 * no module side effects. Phase E will wire the import site into
 * the routing initialization path.
 *
 * Identity mapping:
 * - links_panel = shared surface vocabulary name
 * - quick-links-* = concrete panel-registry identity / duplicate family
 * Phase E maps between these identities at runtime.
 */

import {
  registerSurfaceManifest,
  SURFACE_MANIFEST_VERSION,
  type SurfaceManifestEntry,
} from './surface-manifest'

// =============================================================================
// links_panel (multi-instance, duplicate family: quick-links)
// =============================================================================

const LINKS_PANEL_MANIFEST: SurfaceManifestEntry = {
  surfaceId: 'links_panel',
  surfaceType: 'links_panel',
  containerType: 'dashboard',
  surfaceInstanceType: 'multi_instance',
  instanceSelector: {
    selectorMode: 'instance_label',
    requireSpecificInstance: false,
  },
  manifestVersion: SURFACE_MANIFEST_VERSION,
  handlerId: 'links_panel_handler',
  supportedCommands: [
    {
      intentFamily: 'state_info',
      intentSubtype: 'list_items',
      examples: ['show links panel a', 'what is in links panel b?'],
      executionPolicy: 'list_items',
      replayPolicy: 'cache_resolution_only',
      clarificationPolicy: 'no_clarification',
      safetyRules: ['read_only'],
    },
    {
      intentFamily: 'navigate',
      intentSubtype: 'open_item',
      examples: ['open Resume.pdf in links panel b'],
      requiredArguments: [],           // name OR position — at least one required at execution
      requiredContext: ['targetPanel'],
      executionPolicy: 'execute_item',
      replayPolicy: 'safe_with_revalidation',
      clarificationPolicy: 'clarify_on_ambiguous_target',
      safetyRules: ['validate_item_exists'],
    },
  ],
}

// =============================================================================
// recent (singleton)
// =============================================================================

const RECENT_MANIFEST: SurfaceManifestEntry = {
  surfaceId: 'recent',
  surfaceType: 'recent',
  containerType: 'dashboard',
  surfaceInstanceType: 'singleton',
  manifestVersion: SURFACE_MANIFEST_VERSION,
  handlerId: 'recent_panel_handler',
  supportedCommands: [
    {
      intentFamily: 'state_info',
      intentSubtype: 'list_recent',
      examples: ['show recent items', 'what did I open recently?'],
      executionPolicy: 'list_items',
      replayPolicy: 'cache_resolution_only',
      clarificationPolicy: 'no_clarification',
      safetyRules: ['read_only'],
    },
    {
      intentFamily: 'navigate',
      intentSubtype: 'open_recent_item',
      examples: ['open the last thing I opened'],
      requiredArguments: [],           // name OR position — at least one required at execution
      executionPolicy: 'execute_item',
      replayPolicy: 'safe_with_revalidation',
      clarificationPolicy: 'clarify_on_ambiguous_target',
      safetyRules: ['validate_item_exists'],
    },
  ],
}

// =============================================================================
// Registration
// =============================================================================

/**
 * Register all built-in surface manifest definitions.
 * Called explicitly by the import site that needs the registry populated.
 * Phase E will wire this into the routing initialization path.
 */
export function registerBuiltInSurfaceManifests(): void {
  registerSurfaceManifest(LINKS_PANEL_MANIFEST)
  registerSurfaceManifest(RECENT_MANIFEST)
}
