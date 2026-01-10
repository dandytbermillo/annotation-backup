/**
 * Continue Panel Manifest
 *
 * Provides chat intents for the Continue widget.
 * Continue shows items the user was recently working on to help resume work.
 */

import { createPanelManifest, createIntent } from '../create-manifest'

export const continuePanelManifest = createPanelManifest({
  panelId: 'continue',
  panelType: 'continue',
  title: 'Continue',
  intents: [
    createIntent({
      name: 'open_drawer',
      description: 'Open the Continue panel in the drawer',
      examples: [
        'open continue',
        'show continue',
        'what was I working on',
        'resume work',
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
