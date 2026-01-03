/**
 * Demo Widget Panel Manifest
 *
 * Static manifest for the Demo Widget.
 * Note: For true third-party widgets, the manifest should be passed
 * from client to server with each chat request (see panel-registry.ts comments).
 */

import { createPanelManifest, createIntent } from '../create-manifest'

/**
 * Demo Widget manifest for chat integration.
 * Uses a static panelId for the default instance.
 */
export const demoWidgetManifest = createPanelManifest({
  panelId: 'demo-widget',
  panelType: 'custom',
  title: 'Demo Widget',
  intents: [
    createIntent({
      name: 'list_items',
      description: 'Show all items in the Demo Widget',
      examples: [
        'show demo',
        'show demo widget',
        'list demo items',
        'what is in demo',
        'open demo',
        'preview demo',
      ],
      handler: 'api:/api/panels/demo-widget/list',
      paramsSchema: {
        mode: {
          type: 'string',
          required: false,
          description: 'Display mode: "drawer" or "preview"',
          default: 'drawer',
        },
      },
    }),
  ],
})
