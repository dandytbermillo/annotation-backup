/**
 * Workspace Link Mark
 * Part of Dashboard Implementation - Phase 3.3
 *
 * A TipTap Mark that renders workspace links as clickable elements.
 * Links navigate to the specified workspace when clicked.
 */

import { Mark, mergeAttributes } from '@tiptap/core'
import { Plugin, PluginKey } from 'prosemirror-state'

export interface WorkspaceLinkOptions {
  /** HTML attributes to add to the link element */
  HTMLAttributes: Record<string, any>
  /** Callback when a workspace link is clicked */
  onWorkspaceClick?: (workspaceId: string, workspaceName: string) => void
  /** Whether links are clickable (false in edit mode, true in view mode) */
  clickable?: boolean
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    workspaceLink: {
      /**
       * Set a workspace link mark
       */
      setWorkspaceLink: (attributes: {
        workspaceId: string
        workspaceName: string
      }) => ReturnType
      /**
       * Toggle a workspace link mark
       */
      toggleWorkspaceLink: (attributes: {
        workspaceId: string
        workspaceName: string
      }) => ReturnType
      /**
       * Unset a workspace link mark
       */
      unsetWorkspaceLink: () => ReturnType
    }
  }
}

export const WorkspaceLink = Mark.create<WorkspaceLinkOptions>({
  name: 'workspaceLink',

  priority: 1000,

  keepOnSplit: false,

  addOptions() {
    return {
      HTMLAttributes: {},
      onWorkspaceClick: undefined,
      clickable: true,
    }
  },

  addAttributes() {
    return {
      workspaceId: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-workspace-id'),
        renderHTML: (attributes) => {
          if (!attributes.workspaceId) return {}
          return { 'data-workspace-id': attributes.workspaceId }
        },
      },
      workspaceName: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-workspace-name'),
        renderHTML: (attributes) => {
          if (!attributes.workspaceName) return {}
          return { 'data-workspace-name': attributes.workspaceName }
        },
      },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'a[data-workspace-link]',
      },
      {
        tag: 'span[data-workspace-link]',
      },
    ]
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'a',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        'data-workspace-link': '',
        class: 'workspace-link',
        href: '#',
        // Prevent default navigation
        onclick: 'return false;',
      }),
      0,
    ]
  },

  addCommands() {
    return {
      setWorkspaceLink:
        (attributes) =>
        ({ commands }) => {
          return commands.setMark(this.name, attributes)
        },
      toggleWorkspaceLink:
        (attributes) =>
        ({ commands }) => {
          return commands.toggleMark(this.name, attributes)
        },
      unsetWorkspaceLink:
        () =>
        ({ commands }) => {
          return commands.unsetMark(this.name)
        },
    }
  },

  addProseMirrorPlugins() {
    const { onWorkspaceClick, clickable } = this.options

    return [
      new Plugin({
        key: new PluginKey('workspaceLinkClick'),
        props: {
          handleClick: (view, pos, event) => {
            if (!clickable || !onWorkspaceClick) return false

            const target = event.target as HTMLElement
            if (!target) return false

            // Check if clicked on a workspace link
            const linkElement = target.closest('[data-workspace-link]') as HTMLElement
            if (!linkElement) return false

            const workspaceId = linkElement.getAttribute('data-workspace-id')
            const workspaceName = linkElement.getAttribute('data-workspace-name')

            if (workspaceId && workspaceName) {
              event.preventDefault()
              event.stopPropagation()
              onWorkspaceClick(workspaceId, workspaceName)
              return true
            }

            return false
          },
        },
      }),
    ]
  },
})
