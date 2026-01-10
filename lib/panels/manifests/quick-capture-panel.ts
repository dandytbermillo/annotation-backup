/**
 * Quick Capture Panel Manifest
 *
 * Provides chat intents for the Quick Capture widget.
 * Quick Capture allows users to quickly jot down notes or ideas.
 */

import { createPanelManifest, createIntent } from '../create-manifest'

export const quickCapturePanelManifest = createPanelManifest({
  panelId: 'quick-capture',
  panelType: 'quick_capture',
  title: 'Quick Capture',
  intents: [
    createIntent({
      name: 'open_drawer',
      description: 'Open the Quick Capture panel in the drawer',
      examples: [
        'open quick capture',
        'show quick capture',
        'open quick notes',
        'capture something',
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
