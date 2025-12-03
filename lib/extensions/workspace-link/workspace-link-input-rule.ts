/**
 * Workspace Link Input Rule
 * Part of Dashboard Implementation - Phase 3.3
 *
 * Provides input rule to convert [[workspace:Name]] syntax into workspace links.
 */

import { InputRule } from '@tiptap/core'
import type { Editor } from '@tiptap/core'

/**
 * Regex to match [[workspace:Name]] or [[ws:Name]] syntax
 * Captures the workspace name
 */
const WORKSPACE_LINK_REGEX = /\[\[(?:workspace|ws):([^\]]+)\]\]$/

export interface WorkspaceLinkInputRuleOptions {
  /** Function to look up workspace ID from name */
  lookupWorkspace?: (name: string) => Promise<{ id: string; name: string } | null>
  /** Callback when a workspace link is created via input rule */
  onLinkCreated?: (workspaceId: string, workspaceName: string) => void
}

/**
 * Creates an input rule that converts [[workspace:Name]] syntax to workspace links
 */
export function WorkspaceLinkInputRule(options: WorkspaceLinkInputRuleOptions = {}) {
  return new InputRule({
    find: WORKSPACE_LINK_REGEX,
    handler: async ({ state, range, match, commands }) => {
      const workspaceName = match[1]?.trim()
      if (!workspaceName) return null

      // Look up workspace by name if lookup function provided
      let workspaceId: string | null = null
      let resolvedName = workspaceName

      if (options.lookupWorkspace) {
        try {
          const result = await options.lookupWorkspace(workspaceName)
          if (result) {
            workspaceId = result.id
            resolvedName = result.name
          }
        } catch (err) {
          console.error('[WorkspaceLinkInputRule] Lookup failed:', err)
        }
      }

      // If no lookup or lookup failed, use the name as a placeholder ID
      if (!workspaceId) {
        workspaceId = `unresolved:${workspaceName}`
      }

      // Replace the matched text with the workspace link
      const { tr } = state
      const start = range.from
      const end = range.to

      // Delete the [[workspace:Name]] syntax
      tr.delete(start, end)

      // Insert the workspace name with the workspaceLink mark
      const linkMark = state.schema.marks.workspaceLink?.create({
        workspaceId,
        workspaceName: resolvedName,
      })

      if (linkMark) {
        tr.insertText(resolvedName, start)
        tr.addMark(start, start + resolvedName.length, linkMark)
      }

      options.onLinkCreated?.(workspaceId, resolvedName)

      return tr
    },
  })
}

/**
 * Parse [[workspace:Name]] syntax from HTML/text content
 * Returns array of matches with positions
 */
export function parseWorkspaceLinkSyntax(text: string): Array<{
  fullMatch: string
  workspaceName: string
  start: number
  end: number
}> {
  const results: Array<{
    fullMatch: string
    workspaceName: string
    start: number
    end: number
  }> = []

  const globalRegex = /\[\[(?:workspace|ws):([^\]]+)\]\]/g
  let match: RegExpExecArray | null

  while ((match = globalRegex.exec(text)) !== null) {
    results.push({
      fullMatch: match[0],
      workspaceName: match[1].trim(),
      start: match.index,
      end: match.index + match[0].length,
    })
  }

  return results
}
