/**
 * Workspace Link Commands
 * Part of Dashboard Implementation - Phase 3.3
 *
 * Helper functions for working with workspace links in TipTap.
 */

import type { Editor } from '@tiptap/core'

export interface WorkspaceLinkAttributes {
  workspaceId: string
  workspaceName: string
}

/**
 * Insert a workspace link at the current selection
 */
export function insertWorkspaceLink(
  editor: Editor,
  attributes: WorkspaceLinkAttributes
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
            type: 'workspaceLink',
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
    .setWorkspaceLink(attributes)
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
 * Check if the current selection has a workspace link mark
 */
export function isWorkspaceLinkActive(editor: Editor): boolean {
  return editor.isActive('workspaceLink')
}

/**
 * Get workspace link attributes at current position
 */
export function getWorkspaceLinkAttributes(
  editor: Editor
): WorkspaceLinkAttributes | null {
  const { from } = editor.state.selection
  const marks = editor.state.doc.resolve(from).marks()

  for (const mark of marks) {
    if (mark.type.name === 'workspaceLink') {
      return {
        workspaceId: mark.attrs.workspaceId,
        workspaceName: mark.attrs.workspaceName,
      }
    }
  }

  return null
}

/**
 * Remove workspace link mark from current selection
 */
export function removeWorkspaceLink(editor: Editor): boolean {
  return editor.chain().focus().unsetWorkspaceLink().run()
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
