/**
 * Link Notes Panel Manifests
 *
 * Chat capabilities for Link Notes panels (A, B, C, D, E, etc.).
 * Each badge is a separate panel instance.
 *
 * Note: Internal panelId remains 'quick-links-X' for API route compatibility.
 * User-facing name is "Link Notes".
 */

import { createPanelManifest, createIntent } from '../create-manifest'
import type { PanelChatManifest } from '../panel-manifest'

/**
 * Create manifest for a Link Notes panel badge
 */
export function createLinkNotesManifest(badge: string): PanelChatManifest {
  const badgeLower = badge.trim().toLowerCase()
  const badgeUpper = badge.trim().toUpperCase()

  return createPanelManifest({
    // Keep 'quick-links' for API route compatibility
    panelId: `quick-links-${badgeLower}`,
    panelType: 'quick-links',
    title: `Link Notes ${badgeUpper}`,
    intents: [
      createIntent({
        name: 'show_links',
        description: `Show all links in Link Notes ${badgeUpper} panel`,
        examples: [
          // Link notes variations (primary)
          `show link notes ${badgeLower}`,
          `show link notes ${badgeUpper}`,
          `open link notes ${badgeLower}`,
          `open link notes ${badgeUpper}`,
          `link notes ${badgeLower}`,
          `link notes ${badgeUpper}`,
          // Quick links variations (legacy)
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
          `list link notes ${badgeLower}`,
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
      }),
      createIntent({
        name: 'open_link',
        description: `Open a specific link from Link Notes ${badgeUpper}`,
        examples: [
          `open link X from link notes ${badgeLower}`,
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
      }),
      createIntent({
        name: 'add_link',
        description: `Add a new link to Link Notes ${badgeUpper}`,
        examples: [
          `add link to link notes ${badgeLower}`,
          `add link to quick links ${badgeLower}`,
          `save to link notes ${badgeLower}`,
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
        permission: 'write',
      }),
      createIntent({
        name: 'remove_link',
        description: `Remove a link from Link Notes ${badgeUpper}`,
        examples: [
          `remove link X from link notes ${badgeLower}`,
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
        permission: 'write',
      }),
    ],
  })
}

// Export manifests for all Link Notes badges
export const linkNotesPanelManifests: PanelChatManifest[] = [
  createLinkNotesManifest('a'),
  createLinkNotesManifest('b'),
  createLinkNotesManifest('c'),
  createLinkNotesManifest('d'),
  createLinkNotesManifest('e'),
]

// Export individual manifests for direct access
export const linkNotesAManifest = linkNotesPanelManifests[0]
export const linkNotesBManifest = linkNotesPanelManifests[1]
export const linkNotesCManifest = linkNotesPanelManifests[2]
export const linkNotesDManifest = linkNotesPanelManifests[3]
export const linkNotesEManifest = linkNotesPanelManifests[4]

// Backward-compatible aliases (deprecated - use linkNotes* instead)
/** @deprecated Use createLinkNotesManifest instead */
export const createQuickLinksManifest = createLinkNotesManifest
/** @deprecated Use linkNotesPanelManifests instead */
export const quickLinksPanelManifests = linkNotesPanelManifests
