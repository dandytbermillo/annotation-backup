/**
 * State-Info Resolvers (6x.8 Phase 3 + Phase 4)
 *
 * Deterministic resolvers that answer "what is open/active" queries
 * from live UI/session state. No LLM. No freeform generation.
 */

/**
 * Resolve note state-info queries from UI context.
 *
 * Returns a bounded human-readable answer string.
 */
export function resolveNoteStateInfo(uiContext: {
  workspace?: {
    activeNoteId?: string | null
    openNotes?: Array<{ id: string; title?: string }>
  }
}): string {
  const activeNoteId = uiContext?.workspace?.activeNoteId
  if (!activeNoteId) return 'No note is currently open.'

  const notes = uiContext?.workspace?.openNotes ?? []
  const activeNote = notes.find(n => n.id === activeNoteId)
  const title = activeNote?.title ?? 'Untitled'

  if (notes.length > 1) {
    return `The active note is ${title}. ${notes.length} notes are open.`
  }
  return `The open note is ${title}.`
}

/**
 * Discriminates current-state "panel open" queries from "visible widgets" queries.
 * Requires BOTH a panel/drawer reference AND an open-state keyword.
 * This avoids matching generic "open" tokens in history/verification phrasings.
 */
export function isPanelOpenQuery(input: string): boolean {
  return /\bpanels?\b|\bdrawer\b/i.test(input) && /\bopen(ed)?\b/i.test(input)
}

/**
 * Resolve "which panel is open?" queries.
 * Source: uiContext.dashboard.openDrawer (currently open panel drawer).
 */
export function resolvePanelOpenStateInfo(uiContext: {
  dashboard?: {
    openDrawer?: { panelId: string; title: string; type?: string }
  }
}): string {
  const drawer = uiContext?.dashboard?.openDrawer
  if (!drawer) return 'No panel drawer is currently open.'
  return `The open panel is ${drawer.title}.`
}

/**
 * Resolve "which widgets are visible?" queries.
 * Source: uiContext.dashboard.visibleWidgets (widget titles on the dashboard grid).
 */
export function resolvePanelWidgetStateInfo(uiContext: {
  dashboard?: {
    visibleWidgets?: Array<{ id: string; title: string; type: string }>
  }
}): string {
  const widgets = uiContext?.dashboard?.visibleWidgets ?? []
  if (widgets.length === 0) return 'No panels are currently visible.'
  const names = widgets.map(w => w.title).join(', ')
  return `The visible panels are: ${names}.`
}

/**
 * Resolve workspace state-info queries.
 * Source: uiContext.workspace.workspaceName.
 */
export function resolveWorkspaceStateInfo(uiContext: {
  workspace?: {
    workspaceName?: string
  }
}): string {
  const name = uiContext?.workspace?.workspaceName
  if (!name) return 'No workspace is currently active.'
  return `You are in workspace ${name}.`
}

/**
 * Resolve dashboard state-info queries.
 * Source: uiContext.dashboard.entryName + visibleWidgets count.
 * Distinction from panel_widget: dashboard answers about the container, panel_widget about specific widgets.
 */
export function resolveDashboardStateInfo(uiContext: {
  dashboard?: {
    entryName?: string
    visibleWidgets?: Array<{ id: string; title: string; type: string }>
  }
}): string {
  const widgets = uiContext?.dashboard?.visibleWidgets ?? []
  const entryName = uiContext?.dashboard?.entryName
  if (widgets.length === 0) return entryName ? `The dashboard for ${entryName} is empty.` : 'The dashboard is empty.'
  return `The dashboard${entryName ? ` for ${entryName}` : ''} has ${widgets.length} widget${widgets.length === 1 ? '' : 's'}.`
}
