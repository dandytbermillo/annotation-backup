// @ts-nocheck
/**
 * Quick Links Mark Extension for TipTap
 * Part of Dashboard Implementation - Quick Links Panel TipTap Version
 *
 * A TipTap Mark that renders workspace links with full entry context:
 * - workspaceId, workspaceName
 * - entryId, entryName
 * - dashboardId (for navigation to entry's dashboard)
 *
 * Supports internal vs external link distinction based on current entry context.
 */

import { Mark, mergeAttributes } from '@tiptap/core'
import { Plugin, PluginKey } from 'prosemirror-state'
import { Decoration, DecorationSet } from 'prosemirror-view'
import type { Node as ProseMirrorNode } from 'prosemirror-model'
import { debugLog } from '@/lib/utils/debug-logger'

/**
 * Build decorations for external links (links to different entries)
 * Called from both init and apply to ensure decorations are always up-to-date
 */
function buildExternalLinkDecorations(
  doc: ProseMirrorNode,
  getCurrentEntryId?: () => string | null
): { decorations: DecorationSet } {
  const currentEntryId = getCurrentEntryId?.()

  // Debug logging
  void debugLog({
    component: 'QuickLinksMark',
    action: 'buildExternalLinkDecorations',
    metadata: { currentEntryId }
  })

  if (!currentEntryId) {
    void debugLog({
      component: 'QuickLinksMark',
      action: 'no_current_entry_id',
      content_preview: 'No currentEntryId, returning empty decorations'
    })
    return { decorations: DecorationSet.empty }
  }

  const decos: Decoration[] = []
  doc.descendants((node, pos) => {
    if (!node.isText) return
    node.marks.forEach(mark => {
      if (mark.type.name === 'quickLinksLink') {
        const linkEntryId = mark.attrs.entryId
        const isExternal = linkEntryId !== currentEntryId
        void debugLog({
          component: 'QuickLinksMark',
          action: 'found_link',
          metadata: { linkEntryId, currentEntryId, isExternal }
        })
        if (linkEntryId && isExternal) {
          // This is an external link - add decoration with external-link class
          const from = pos
          const to = pos + (node.text?.length || 0)
          decos.push(Decoration.inline(from, to, {
            class: 'external-link',
          }))
          void debugLog({
            component: 'QuickLinksMark',
            action: 'added_external_decoration',
            metadata: { workspaceName: mark.attrs.workspaceName, from, to }
          })
        }
      }
    })
  })
  void debugLog({
    component: 'QuickLinksMark',
    action: 'decorations_created',
    metadata: { totalCount: decos.length }
  })
  return { decorations: DecorationSet.create(doc, decos) }
}

export interface QuickLinksMarkOptions {
  /** HTML attributes to add to the link element */
  HTMLAttributes: Record<string, any>
  /** Callback when a workspace link is clicked for internal navigation (same entry) */
  onInternalLinkClick?: (workspaceId: string, workspaceName: string) => void
  /** Callback when a workspace link is clicked for external navigation (different entry) */
  onExternalLinkClick?: (
    entryId: string,
    workspaceId: string,
    dashboardId: string | null
  ) => void
  /** Function to get current entry ID for internal/external determination */
  getCurrentEntryId?: () => string | null
  /** Whether links are clickable */
  clickable?: boolean
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    quickLinksLink: {
      /**
       * Set a quick links mark
       */
      setQuickLinksLink: (attributes: {
        workspaceId: string
        workspaceName: string
        entryId: string
        entryName: string
        dashboardId?: string
      }) => ReturnType
      /**
       * Toggle a quick links mark
       */
      toggleQuickLinksLink: (attributes: {
        workspaceId: string
        workspaceName: string
        entryId: string
        entryName: string
        dashboardId?: string
      }) => ReturnType
      /**
       * Unset a quick links mark
       */
      unsetQuickLinksLink: () => ReturnType
    }
  }
}

export const QuickLinksMark = Mark.create<QuickLinksMarkOptions>({
  name: 'quickLinksLink',

  priority: 1000,

  keepOnSplit: false,

  addOptions() {
    return {
      HTMLAttributes: {},
      onInternalLinkClick: undefined,
      onExternalLinkClick: undefined,
      getCurrentEntryId: undefined,
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
        parseHTML: (element) =>
          element.getAttribute('data-workspace-name') ||
          element.getAttribute('data-workspace'),
        renderHTML: (attributes) => {
          if (!attributes.workspaceName) return {}
          return { 'data-workspace-name': attributes.workspaceName }
        },
      },
      entryId: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-entry-id'),
        renderHTML: (attributes) => {
          if (!attributes.entryId) return {}
          return { 'data-entry-id': attributes.entryId }
        },
      },
      entryName: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-entry-name'),
        renderHTML: (attributes) => {
          if (!attributes.entryName) return {}
          return { 'data-entry-name': attributes.entryName }
        },
      },
      dashboardId: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-dashboard-id'),
        renderHTML: (attributes) => {
          if (!attributes.dashboardId) return {}
          return { 'data-dashboard-id': attributes.dashboardId }
        },
      },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'span[data-quick-link]',
      },
      {
        tag: 'a[data-quick-link]',
      },
      // Also parse legacy workspace-link format
      {
        tag: 'span.workspace-link[data-workspace-id]',
      },
    ]
  },

  renderHTML({ HTMLAttributes }) {
    // Determine if external based on stored entryId
    // The actual external class will be applied by the decoration plugin
    return [
      'span',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        'data-quick-link': '',
        class: 'quick-link',
      }),
      0,
    ]
  },

  addCommands() {
    return {
      setQuickLinksLink:
        (attributes) =>
        ({ commands }) => {
          return commands.setMark(this.name, attributes)
        },
      toggleQuickLinksLink:
        (attributes) =>
        ({ commands }) => {
          return commands.toggleMark(this.name, attributes)
        },
      unsetQuickLinksLink:
        () =>
        ({ commands }) => {
          return commands.unsetMark(this.name)
        },
    }
  },

  addProseMirrorPlugins() {
    const {
      onInternalLinkClick,
      onExternalLinkClick,
      getCurrentEntryId,
      clickable,
    } = this.options

    return [
      // Plugin to handle click navigation
      new Plugin({
        key: new PluginKey('quickLinksClick'),
        props: {
          handleClick: (view, pos, event) => {
            if (!clickable) return false

            const target = event.target as HTMLElement
            if (!target) return false

            // Check if clicked on a quick link
            const linkElement = target.closest('[data-quick-link]') as HTMLElement
            if (!linkElement) return false

            const workspaceId = linkElement.getAttribute('data-workspace-id')
            const workspaceName =
              linkElement.getAttribute('data-workspace-name') || linkElement.textContent || ''
            const entryId = linkElement.getAttribute('data-entry-id')
            const dashboardId = linkElement.getAttribute('data-dashboard-id')

            if (!workspaceId) return false

            event.preventDefault()
            event.stopPropagation()

            // Determine if internal or external link
            const currentEntryId = getCurrentEntryId?.()
            const isInternal = entryId === currentEntryId

            if (isInternal && onInternalLinkClick) {
              onInternalLinkClick(workspaceId, workspaceName)
            } else if (!isInternal && onExternalLinkClick && entryId) {
              onExternalLinkClick(entryId, workspaceId, dashboardId)
            }

            return true
          },
        },
      }),
      // Plugin to add external-link class based on current entry context
      // Uses ProseMirror decorations (like annotation-decorations-plain.ts) instead of direct DOM manipulation
      // This is safe because decorations are part of ProseMirror's rendering cycle
      new Plugin({
        key: new PluginKey('quickLinksExternalClass'),
        state: {
          init(_config, state) {
            // Build decorations on initial load
            return buildExternalLinkDecorations(state.doc, getCurrentEntryId)
          },
          apply(_tr, _value, _old, newState) {
            // Rebuild decorations on every transaction
            return buildExternalLinkDecorations(newState.doc, getCurrentEntryId)
          }
        },
        props: {
          decorations(state) {
            // @ts-ignore
            return this.getState(state)?.decorations
          },
        },
      }),
    ]
  },
})
