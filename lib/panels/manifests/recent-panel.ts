/**
 * Recent Panel Manifest
 *
 * Chat capabilities for the Recent Items panel.
 * Migrated to use createPanelManifest/createIntent helpers.
 */

import { createPanelManifest, createIntent } from '../create-manifest'

export const recentPanelManifest = createPanelManifest({
  panelId: 'recent',
  panelType: 'recent',
  title: 'Recent Items',
  intents: [
    createIntent({
      name: 'list_recent',
      description: 'Show recently accessed entries and workspaces',
      examples: [
        'show recent',
        'show recents',
        'list recent',
        'list recents',
        'what did I open recently?',
        'recent items',
        'show recent items',
        'open recent list',
        'my recent',
      ],
      paramsSchema: {
        mode: {
          type: 'string',
          required: false,
          description: 'Display mode: "drawer" or "preview"',
          default: 'drawer',
        },
        limit: {
          type: 'number',
          required: false,
          description: 'Maximum number of items to show',
          default: 10,
        },
        type: {
          type: 'string',
          required: false,
          description: 'Filter by type: "entry", "workspace", or "all"',
          default: 'all',
        },
      },
      handler: 'api:/api/panels/recent/list',
      // permission defaults to 'read'
    }),
    createIntent({
      name: 'open_recent_item',
      description: 'Open a specific item from the recent list by position or name',
      examples: [
        'open the last thing I opened',
        'open the first recent item',
        'open recent entry X',
        'go to my last workspace',
      ],
      paramsSchema: {
        position: {
          type: 'number',
          required: false,
          description: 'Position in the recent list (1 = most recent)',
        },
        name: {
          type: 'string',
          required: false,
          description: 'Name of the item to open',
        },
      },
      handler: 'api:/api/panels/recent/open',
      // permission defaults to 'read'
    }),
    createIntent({
      name: 'clear_recent',
      description: 'Clear the recent items history',
      examples: [
        'clear recent',
        'clear recents',
        'clear recent history',
        'delete recent items',
      ],
      handler: 'api:/api/panels/recent/clear',
      permission: 'write', // explicit: destructive action
    }),
  ],
})
