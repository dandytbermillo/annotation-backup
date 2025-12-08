/**
 * Quick Links Commands
 * Part of Dashboard Implementation - Quick Links Panel TipTap Version
 *
 * Helper functions for working with quick links in TipTap.
 */

import type { Editor } from '@tiptap/core'

export interface QuickLinkAttributes {
  workspaceId: string
  workspaceName: string
  entryId: string
  entryName: string
  dashboardId?: string
}

/**
 * Insert a quick link at the current selection
 */
export function insertQuickLink(
  editor: Editor,
  attributes: QuickLinkAttributes
): boolean {
  const { from, to, empty } = editor.state.selection

  if (empty) {
    // No selection - insert the workspace name as text with mark
    return editor
      .chain()
      .focus()
      .insertContent({
        type: 'text',
        text: attributes.workspaceName,
        marks: [
          {
            type: 'quickLinksLink',
            attrs: attributes,
          },
        ],
      })
      .run()
  }

  // Has selection - apply mark to selected text
  return editor
    .chain()
    .focus()
    .setQuickLinksLink(attributes)
    .run()
}

/**
 * Get the currently selected text
 */
export function getSelectedText(editor: Editor): string {
  const { from, to } = editor.state.selection
  return editor.state.doc.textBetween(from, to, ' ')
}

/**
 * Check if the current selection has a quick link mark
 */
export function isQuickLinkActive(editor: Editor): boolean {
  return editor.isActive('quickLinksLink')
}

/**
 * Get quick link attributes at current position
 */
export function getQuickLinkAttributes(
  editor: Editor
): QuickLinkAttributes | null {
  const { from } = editor.state.selection
  const marks = editor.state.doc.resolve(from).marks()

  for (const mark of marks) {
    if (mark.type.name === 'quickLinksLink') {
      return {
        workspaceId: mark.attrs.workspaceId,
        workspaceName: mark.attrs.workspaceName,
        entryId: mark.attrs.entryId,
        entryName: mark.attrs.entryName,
        dashboardId: mark.attrs.dashboardId,
      }
    }
  }

  return null
}

/**
 * Remove quick link mark from current selection
 */
export function removeQuickLink(editor: Editor): boolean {
  return editor.chain().focus().unsetQuickLinksLink().run()
}

/**
 * Check if editor has text selected (for highlight-to-link feature)
 */
export function hasTextSelection(editor: Editor): boolean {
  const { from, to, empty } = editor.state.selection
  if (empty) return false

  const text = editor.state.doc.textBetween(from, to, ' ')
  return text.trim().length > 0
}

/**
 * Get all quick links from the editor content
 */
export function getAllQuickLinks(editor: Editor): QuickLinkAttributes[] {
  const links: QuickLinkAttributes[] = []

  editor.state.doc.descendants((node: { marks?: Array<{ type: { name: string }; attrs: Record<string, unknown> }> }) => {
    if (node.marks) {
      for (const mark of node.marks) {
        if (mark.type.name === 'quickLinksLink' && mark.attrs.workspaceId) {
          links.push({
            workspaceId: mark.attrs.workspaceId as string,
            workspaceName: (mark.attrs.workspaceName as string) || '',
            entryId: (mark.attrs.entryId as string) || '',
            entryName: (mark.attrs.entryName as string) || '',
            dashboardId: mark.attrs.dashboardId as string | undefined,
          })
        }
      }
    }
    return true
  })

  return links
}

/**
 * Convert editor content to HTML string
 */
export function getContentAsHtml(editor: Editor): string {
  return editor.getHTML()
}

/**
 * Convert HTML content to ProseMirror JSON
 */
export function setContentFromHtml(editor: Editor, html: string): void {
  editor.commands.setContent(html)
}
