/**
 * Navigator Panel Manifest
 *
 * Provides chat intents for the Navigator widget.
 * The Navigator shows the workspace navigation tree (folders, notes, etc.).
 */

import { createPanelManifest, createIntent } from '../create-manifest'

export const navigatorPanelManifest = createPanelManifest({
  panelId: 'navigator',
  panelType: 'navigator',
  title: 'Navigator',
  intents: [
    createIntent({
      name: 'open_drawer',
      description: 'Open the Navigator panel in the drawer',
      examples: [
        'open navigator',
        'show navigator',
        'open the navigator',
        'show the navigation panel',
      ],
      handler: 'api:/api/panels/open-drawer',
      permission: 'read',
      paramsSchema: {
        mode: {
          type: 'string',
          required: false,
          description: 'Display mode: "drawer" (default)',
          default: 'drawer',
        },
      },
    }),
  ],
})
