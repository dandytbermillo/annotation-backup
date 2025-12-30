/**
 * Quick Links Content Parser
 *
 * Parses TipTap JSON content to extract Quick Links marks and plain text notes.
 * Uses annotation-style mark extraction from TipTap document structure.
 *
 * NOTE: HTML fallback was removed. All Quick Links panels must have contentJson.
 * If a panel is missing contentJson, it needs to be re-saved in the editor.
 */

import type { JSONContent } from '@tiptap/core'
import type { QuickLinkItem } from './view-panel-types'

/**
 * Parse Quick Links content from TipTap JSON
 * Returns empty array with error if content is not valid JSON.
 */
export function parseQuickLinksContent(content: JSONContent | string | null | undefined): QuickLinkItem[] {
  // Reject non-JSON content
  if (!content || typeof content === 'string') {
    // Return empty - caller should handle missing contentJson
    return []
  }

  return parseJSONContent(content)
}

/**
 * Check if content is valid for parsing (has contentJson)
 */
export function isValidQuickLinksContent(content: unknown): content is JSONContent {
  return content !== null && typeof content === 'object' && !Array.isArray(content)
}

/**
 * Parse TipTap JSON content to extract Quick Links (annotation-style)
 *
 * This is the preferred approach: directly extract marks from JSON structure.
 * No HTML parsing needed, works natively server-side.
 *
 * Extracts:
 * - Links: Text nodes with `quickLinksLink` marks
 * - Notes: Full paragraphs that contain NO links (pure text paragraphs)
 */
function parseJSONContent(json: JSONContent): QuickLinkItem[] {
  const items: QuickLinkItem[] = []

  // Walk document content (top-level nodes are typically paragraphs)
  if (!json.content) return items

  for (const block of json.content) {
    if (block.type === 'paragraph' && block.content) {
      // Check if this paragraph has ANY links
      const hasLinks = block.content.some((child: JSONContent) =>
        child.marks?.some((m: { type: string }) => m.type === 'quickLinksLink')
      )

      if (hasLinks) {
        // Extract links from this paragraph
        for (const child of block.content) {
          if (child.marks) {
            const mark = child.marks.find((m: { type: string }) => m.type === 'quickLinksLink')
            if (mark?.attrs?.workspaceId && mark?.attrs?.entryId) {
              items.push({
                type: 'link',
                attrs: {
                  workspaceId: mark.attrs.workspaceId as string,
                  workspaceName: (mark.attrs.workspaceName as string) || (child.text as string) || '',
                  entryId: mark.attrs.entryId as string,
                  entryName: (mark.attrs.entryName as string) || '',
                  dashboardId: mark.attrs.dashboardId as string | undefined,
                },
              })
            }
          }
        }
      } else {
        // No links in this paragraph - treat as a plain text note
        const text = block.content
          .map((child: JSONContent) => (child.text as string) || '')
          .join('')
          .trim()

        if (text) {
          items.push({
            type: 'note',
            text,
          })
        }
      }
    }
  }

  return items
}

/**
 * Build ViewListItems from parsed Quick Links content
 */
export function buildQuickLinksViewItems(
  _panelId: string,
  content: JSONContent | string | null | undefined
): import('./view-panel-types').ViewListItem[] {
  const parsed = parseQuickLinksContent(content)

  return parsed.map((item, index) => {
    if (item.type === 'link') {
      return {
        id: item.attrs.workspaceId || `link-${index}`,
        name: item.attrs.workspaceName || 'Workspace',
        type: 'link' as const,
        meta: item.attrs.entryName || undefined,
        isSelectable: true,
        entryId: item.attrs.entryId,
        workspaceId: item.attrs.workspaceId,
        dashboardId: item.attrs.dashboardId,
      }
    }

    return {
      id: `note-${index}`,
      name: item.text,
      type: 'note' as const,
      isSelectable: false,
    }
  })
}
