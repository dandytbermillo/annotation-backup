/**
 * Links Overview Panel Manifest
 *
 * Provides chat intents for the Links Overview widget.
 * Links Overview shows a categorized view of all links/categories.
 */

import { createPanelManifest, createIntent } from '../create-manifest'

export const linksOverviewPanelManifest = createPanelManifest({
  panelId: 'links-overview',
  panelType: 'category_navigator',
  title: 'Links Overview',
  intents: [
    createIntent({
      name: 'open_drawer',
      description: 'Open the Links Overview panel in the drawer',
      examples: [
        'open links overview',
        'show links overview',
        'show all links',
        'view categories',
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
