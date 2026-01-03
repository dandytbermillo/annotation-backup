/**
 * Quick Links Panel Manifests
 *
 * Chat capabilities for Quick Links panels (A, B, C, D, etc.).
 * Each badge is a separate panel instance.
 * Migrated to use createPanelManifest/createIntent helpers.
 */

import { createPanelManifest, createIntent } from '../create-manifest'
import type { PanelChatManifest } from '../panel-manifest'

/**
 * Create manifest for a Quick Links panel badge
 */
export function createQuickLinksManifest(badge: string): PanelChatManifest {
  const badgeLower = badge.trim().toLowerCase()
  const badgeUpper = badge.trim().toUpperCase()

  return createPanelManifest({
    panelId: `quick-links-${badgeLower}`,
    panelType: 'quick-links',
    title: `Quick Links ${badgeUpper}`,
    // version defaults to '1.0'
    intents: [
      createIntent({
        name: 'show_links',
        description: `Show all links in Quick Links ${badgeUpper} panel`,
        examples: [
          `show quick links ${badgeLower}`,
          `show quick links ${badgeUpper}`,
          `open quick link ${badgeLower}`,
          `open quick link ${badgeUpper}`,
          `quick link ${badgeLower}`,
          `quick link ${badgeUpper}`,
          `quick links ${badgeLower}`,
          `quick links ${badgeUpper}`,
          `links ${badgeLower}`,
          `links ${badgeUpper}`,
          `open quick links ${badgeLower}`,
          `list quick links ${badgeLower}`,
          `list quick links ${badgeUpper}`,
          `list my quick links ${badgeLower}`,
          `list links ${badgeLower}`,
        ],
        paramsSchema: {
          mode: {
            type: 'string',
            required: false,
            description: 'Display mode: "drawer" or "preview"',
            default: 'drawer',
          },
        },
        handler: `api:/api/panels/quick-links/${badgeLower}/list`,
        // permission defaults to 'read'
      }),
      createIntent({
        name: 'open_link',
        description: `Open a specific link from Quick Links ${badgeUpper}`,
        examples: [
          `open link X from quick links ${badgeLower}`,
          `go to X in links ${badgeLower}`,
        ],
        paramsSchema: {
          name: {
            type: 'string',
            required: false,
            description: 'Name of the link to open',
          },
          position: {
            type: 'number',
            required: false,
            description: 'Position in the list (1 = first)',
          },
        },
        handler: `api:/api/panels/quick-links/${badgeLower}/open`,
        // permission defaults to 'read'
      }),
      createIntent({
        name: 'add_link',
        description: `Add a new link to Quick Links ${badgeUpper}`,
        examples: [
          `add link to quick links ${badgeLower}`,
          `save to quick links ${badgeLower}`,
          `add current to links ${badgeLower}`,
        ],
        paramsSchema: {
          url: {
            type: 'string',
            required: false,
            description: 'URL to add (if not current page)',
          },
          name: {
            type: 'string',
            required: false,
            description: 'Display name for the link',
          },
        },
        handler: `api:/api/panels/quick-links/${badgeLower}/add`,
        permission: 'write', // explicit: destructive action
      }),
      createIntent({
        name: 'remove_link',
        description: `Remove a link from Quick Links ${badgeUpper}`,
        examples: [
          `remove link X from quick links ${badgeLower}`,
          `delete link from links ${badgeLower}`,
        ],
        paramsSchema: {
          name: {
            type: 'string',
            required: false,
            description: 'Name of the link to remove',
          },
          position: {
            type: 'number',
            required: false,
            description: 'Position in the list to remove',
          },
        },
        handler: `api:/api/panels/quick-links/${badgeLower}/remove`,
        permission: 'write', // explicit: destructive action
      }),
    ],
  })
}

// Export manifests for all Quick Links badges
export const quickLinksPanelManifests: PanelChatManifest[] = [
  createQuickLinksManifest('a'),
  createQuickLinksManifest('b'),
  createQuickLinksManifest('c'),
  createQuickLinksManifest('d'),
]

// Export individual manifests for direct access
export const quickLinksAManifest = quickLinksPanelManifests[0]
export const quickLinksBManifest = quickLinksPanelManifests[1]
export const quickLinksCManifest = quickLinksPanelManifests[2]
export const quickLinksDManifest = quickLinksPanelManifests[3]
