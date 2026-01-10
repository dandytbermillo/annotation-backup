/**
 * Widget Manager Panel Manifest
 *
 * Provides chat intents for the Widget Manager.
 * Widget Manager allows users to view, install, and manage dashboard widgets.
 */

import { createPanelManifest, createIntent } from '../create-manifest'

export const widgetManagerPanelManifest = createPanelManifest({
  panelId: 'widget-manager',
  panelType: 'widget_manager',
  title: 'Widget Manager',
  intents: [
    createIntent({
      name: 'open_drawer',
      description: 'Open the Widget Manager panel in the drawer',
      examples: [
        'open widget manager',
        'show widget manager',
        'manage widgets',
        'show widgets',
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
