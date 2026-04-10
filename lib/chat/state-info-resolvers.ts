/**
 * State-Info Resolvers (6x.8 Phase 3 + Phase 4 + Step 10)
 *
 * Deterministic resolvers that answer "what is open/visible" queries
 * from live UI/session state. No LLM. No freeform generation.
 *
 * Step 10 addition: noun-specific state-info for covered widget/panel nouns.
 * Design addendum: state-info-runtime-registry-addendum.md
 */

import { matchKnownNoun, resolveToVisiblePanel, resolveFamilyCardinality } from '@/lib/chat/known-noun-routing'
import { getDuplicateFamily } from '@/lib/dashboard/duplicate-family-map'
import { getWidgetOpenState as registryGetWidgetOpenState, getStateInfoActivePanelId as registryGetActivePanelId, getAllOpenPanelIds as registryGetAllOpenPanelIds } from '@/lib/widgets/ui-snapshot-registry'

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
    visibleWidgets?: Array<{ id: string; title: string; type: string; instanceLabel?: string; duplicateFamily?: string }>
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
    visibleWidgets?: Array<{ id: string; title: string; type: string; instanceLabel?: string; duplicateFamily?: string }>
  }
}): string {
  const widgets = uiContext?.dashboard?.visibleWidgets ?? []
  const entryName = uiContext?.dashboard?.entryName
  if (widgets.length === 0) return entryName ? `The dashboard for ${entryName} is empty.` : 'The dashboard is empty.'
  return `The dashboard${entryName ? ` for ${entryName}` : ''} has ${widgets.length} widget${widgets.length === 1 ? '' : 's'}.`
}

// =============================================================================
// Step 10a: DashboardStateSnapshot — authoritative per-turn registry
// Design addendum: state-info-runtime-registry-addendum.md
// =============================================================================

/** One entry per widget/panel in the unified registry */
export interface StateInfoWidgetEntry {
  instanceId: string
  title: string
  type: string
  familyId: string | null
  instanceLabel: string | null
  duplicateCapable: boolean
  open: boolean
  presentOnDashboard: boolean
}

/** Per-turn normalized registry, built from producers */
export interface DashboardStateSnapshot {
  entries: StateInfoWidgetEntry[]
  openDrawerPanelId: string | null
  sourceSurface: 'dashboard'
}

/**
 * Build the per-turn dashboard state snapshot from raw producers.
 * This is the single source of truth for all state-info resolvers.
 * Resolvers must read only this snapshot — never raw sources directly.
 */
export function buildDashboardStateSnapshot(
  visibleWidgets: Array<{ id: string; title: string; type: string; instanceLabel?: string; duplicateFamily?: string }>,
  registryOverride?: { getWidgetOpenState: (id: string) => boolean; getActivePanelId: () => string | null; getAllOpenPanelIds: () => string[] },
): DashboardStateSnapshot {
  // Step 10a: Read open + active state from the authoritative registry
  let getWidgetOpenStateFn: (id: string) => boolean
  let getActivePanelIdFn: () => string | null
  let getAllOpenPanelIdsFn: () => string[]
  if (registryOverride) {
    getWidgetOpenStateFn = registryOverride.getWidgetOpenState
    getActivePanelIdFn = registryOverride.getActivePanelId
    getAllOpenPanelIdsFn = registryOverride.getAllOpenPanelIds
  } else {
    getWidgetOpenStateFn = registryGetWidgetOpenState
    getActivePanelIdFn = registryGetActivePanelId
    getAllOpenPanelIdsFn = registryGetAllOpenPanelIds
  }
  const openDrawerPanelId = getActivePanelIdFn()

  const seenIds = new Set<string>()
  const entries: StateInfoWidgetEntry[] = []

  // 1. Primary: visibleWidgets (dashboard inventory — full metadata)
  // open state comes from the authoritative registry via getWidgetOpenState(panelId)
  for (const w of visibleWidgets) {
    if (seenIds.has(w.id)) continue
    seenIds.add(w.id)
    const familyId = w.duplicateFamily ?? null
    entries.push({
      instanceId: w.id,
      title: w.title,
      type: w.type,
      familyId,
      instanceLabel: w.instanceLabel ?? null,
      duplicateCapable: familyId !== null,
      open: getWidgetOpenStateFn(w.id),
      presentOnDashboard: true,
    })
  }

  // 2. Materialization invariant: any open or active panel not in visibleWidgets gets a minimal entry.
  const allOpenIds = getAllOpenPanelIdsFn()
  const panelIdsToMaterialize = new Set(allOpenIds)
  if (openDrawerPanelId) panelIdsToMaterialize.add(openDrawerPanelId)
  for (const pid of panelIdsToMaterialize) {
    if (seenIds.has(pid)) continue
    seenIds.add(pid)
    entries.push({
      instanceId: pid,
      title: pid, // minimal — no title available outside visibleWidgets
      type: '',
      familyId: null,
      instanceLabel: null,
      duplicateCapable: false,
      open: getWidgetOpenStateFn(pid),
      presentOnDashboard: false,
    })
  }

  return { entries, openDrawerPanelId, sourceSurface: 'dashboard' }
}

// =============================================================================
// Step 10a: Semantic-first state-info executor (registry-backed)
// Called AFTER semantic retrieval classifies the query. NOT a direct regex handler.
// =============================================================================

/**
 * Execute a state-info query against the authoritative registry.
 * Takes the already-classified intent from semantic retrieval (slots_json)
 * and reads the registry snapshot for the answer.
 *
 * This is NOT a freeform input parser. The query_type/target_name/family_id
 * come from the curated seed that the semantic pipeline matched.
 */
export function executeStateInfoFromRegistry(
  slotsJson: Record<string, unknown>,
  snapshot: DashboardStateSnapshot,
): { handled: boolean; answer?: string } {
  const queryType = slotsJson.query_type as string | undefined
  const targetName = slotsJson.target_name as string | undefined
  const familyId = slotsJson.family_id as string | undefined
  // Scope wording — derived from the curated seed's slots_json.scope field.
  // "what widgets are open?" → scope: 'widgets' → say "widget(s)"
  // "what panels are open?"  → scope: 'panels'  → say "panel(s)"
  const scopeRaw = (slotsJson.scope as string | undefined)?.toLowerCase()
  const isWidgetScope = scopeRaw === 'widget' || scopeRaw === 'widgets'
  const noun = isWidgetScope ? 'widget' : 'panel'
  const nounPlural = `${noun}s`

  if (queryType === 'open_state') {
    if (targetName) {
      // Noun-specific open-state: "is recent open?", "which navigator is open?"
      if (familyId) {
        // Family noun
        const familyEntries = snapshot.entries.filter(e => e.familyId === familyId)
        const openSiblings = familyEntries.filter(e => e.open)
        if (openSiblings.length > 0) {
          const names = openSiblings.map(s => s.title).join(' and ')
          return { handled: true, answer: `Yes. ${names} is currently open.` }
        }
        if (familyEntries.length === 0) {
          return { handled: true, answer: `No ${targetName} is currently visible on the dashboard.` }
        }
        return { handled: true, answer: `No. No ${targetName} is currently open.` }
      }
      // Singleton noun
      const panelTypeSlug = targetName.replace(/-/g, '_').replace(/\s+/g, '_')
      const entry = snapshot.entries.find(
        e => e.title.toLowerCase() === targetName.toLowerCase() || e.type === panelTypeSlug
      )
      if (entry?.open) {
        return { handled: true, answer: `Yes. ${entry.title} is currently open.` }
      }
      if (entry) {
        return { handled: true, answer: `No. ${entry.title} is visible but not currently open.` }
      }
      return { handled: true, answer: `${targetName} is not currently visible on the dashboard.` }
    }
    // Generic open-state — scope-aware wording.
    const openEntries = snapshot.entries.filter(e => e.open)
    if (openEntries.length === 0) {
      return { handled: true, answer: `No ${noun} is currently open.` }
    }
    if (openEntries.length === 1) {
      return { handled: true, answer: `The open ${noun} is ${openEntries[0].title}.` }
    }
    const names = openEntries.map(e => e.title).join(', ')
    return { handled: true, answer: `The open ${nounPlural} are: ${names}.` }
  }

  if (queryType === 'active_state') {
    const activeEntry = snapshot.openDrawerPanelId
      ? snapshot.entries.find(e => e.instanceId === snapshot.openDrawerPanelId)
      : null
    if (activeEntry) {
      return { handled: true, answer: `The active ${noun} is ${activeEntry.title}.` }
    }
    return { handled: true, answer: `No ${noun} is currently active.` }
  }

  return { handled: false }
}

// =============================================================================
// Step 10: Generic + Noun-Specific State-Info Resolver (transitional regex-based — being replaced)
// =============================================================================

/**
 * Resolve generic state-info questions from the unified registry.
 * Handles "what panel is open?", "what widgets are open?", "what widgets are visible?"
 * "visible" is centrally normalized to "open" per addendum §Normalization clarification.
 * Must run early enough to preempt widget-item selection context.
 */
export function resolveGenericStateInfo(
  input: string,
  snapshot: DashboardStateSnapshot,
): { handled: boolean; answer?: string } {
  const trimmed = input.trim().toLowerCase()

  // NOTE: This transitional resolver is kept for backward-compatible unit tests only.
  // Production path goes through semantic retrieval → executeStateInfoFromRegistry.
  // All open-state queries (including "what panel is open?") use full multi-open registry.

  // "what widgets are open?" / "which widgets are open?"
  // "what widgets are visible?" / "which widgets are visible?" — normalized to "open" per addendum
  if (/^(what|which)\s+(widgets?|panels?)\s+(is|are)\s+(open|visible|showing)/i.test(trimmed)) {
    const openEntries = snapshot.entries.filter(e => e.open)
    if (openEntries.length === 0) {
      return { handled: true, answer: 'No widgets are currently open.' }
    }
    const names = openEntries.map(e => e.title).join(', ')
    return { handled: true, answer: `The open widgets are: ${names}.` }
  }

  return { handled: false }
}

/** State property extracted from the question */
type StateProperty = 'open' | 'visible'

/**
 * Detect whether the input is a noun-specific state-info question and extract
 * the state property. Returns null if not a state-info question or if the noun
 * cannot be identified.
 *
 * This uses STATE_INFO_QUESTION_PATTERN shape detection on raw input,
 * then extracts the noun via matchKnownNoun (advisory, not deterministic execution).
 */
export function detectNounStateInfoQuery(input: string): {
  stateProperty: StateProperty
  nounInput: string
} | null {
  const trimmed = input.trim().toLowerCase()

  // Must match state-info question structure: starts with is/are/which/what, ends with state property.
  // This prevents matching commands like "open recent" or "open the second one pls".
  const STATE_INFO_QUESTION_SHAPE = /^(is|are|which|what)\s+.+\s+(open|opened|visible)\s*[?]?\s*$/i
  if (!STATE_INFO_QUESTION_SHAPE.test(trimmed)) return null

  // Detect state property from the question
  let stateProperty: StateProperty | null = null
  if (/\bopen(ed)?\b/i.test(trimmed)) stateProperty = 'open'
  else if (/\bvisible\b/i.test(trimmed)) stateProperty = 'visible'
  if (!stateProperty) return null

  // Extract the noun portion — strip question structure words and state property,
  // keeping only the noun. This is advisory extraction for matchKnownNoun, not
  // deterministic execution input.
  let nounPart = trimmed
    .replace(/[?!.]+$/, '')           // trailing punctuation
    .replace(/^(is|are|which|what)\s+/i, '') // leading question word
    .replace(/\s+(?:is|are)\s+(open|opened|visible|closed|showing)\s*$/i, '') // "X is open" middle pattern
    .replace(/\s+(open|opened|visible|closed|showing)\s*$/i, '') // trailing state property
    .replace(/^(any|the|a)\s+/i, '')  // leading articles
    .trim()

  if (!nounPart) return null
  return { stateProperty, nounInput: nounPart }
}

/**
 * Resolve noun-specific state-info questions from the unified registry.
 *
 * Handles:
 * - Singleton nouns: "is recent open?" → check entry.open in snapshot
 * - Family nouns: "which navigator is open?" → check family entries in snapshot
 * - Instance nouns: "is links panel a open?" → check specific entry
 *
 * Returns { handled: true, answer } when a deterministic answer is available.
 * Returns { handled: false } when the noun is not recognized or not in scope.
 *
 * Design addendum: state-info-runtime-registry-addendum.md
 */
export function resolveNounSpecificStateInfo(
  input: string,
  snapshot: DashboardStateSnapshot,
): { handled: boolean; answer?: string } {
  const detected = detectNounStateInfoQuery(input)
  if (!detected) return { handled: false }

  const { stateProperty, nounInput } = detected

  // Try to match the noun via the known-noun map (advisory only)
  const nounMatch = matchKnownNoun(nounInput)
  if (!nounMatch) return { handled: false }

  // Determine if this noun belongs to a duplicate-capable family
  const panelId = nounMatch.panelId
  const underscored = panelId.replace(/-/g, '_')
  const familyId = getDuplicateFamily(underscored) ?? getDuplicateFamily(panelId) ?? null
  const familyMap: Record<string, string> = { 'quick-links': 'quick-links', 'navigator': 'navigator' }
  const effectiveFamilyId = familyId ?? familyMap[panelId] ?? null

  if (stateProperty === 'open') {
    return resolveOpenStateFromSnapshot(nounMatch, effectiveFamilyId, snapshot)
  } else if (stateProperty === 'visible') {
    return resolveVisibleStateFromSnapshot(nounMatch, effectiveFamilyId, snapshot)
  }

  return { handled: false }
}

function resolveOpenStateFromSnapshot(
  nounMatch: { panelId: string; title: string },
  familyId: string | null,
  snapshot: DashboardStateSnapshot,
): { handled: boolean; answer?: string } {
  if (familyId) {
    // Duplicate-capable family: check which siblings are open in the snapshot
    const familyEntries = snapshot.entries.filter(e => e.familyId === familyId)
    const openSiblings = familyEntries.filter(e => e.open)

    if (openSiblings.length > 0) {
      const names = openSiblings.map(s => s.title).join(' and ')
      return { handled: true, answer: `Yes. ${names} is currently open.` }
    }
    if (familyEntries.length === 0) {
      return { handled: true, answer: `No ${nounMatch.title} is currently visible on the dashboard.` }
    }
    return { handled: true, answer: `No. No ${nounMatch.title.toLowerCase()} is currently open.` }
  }

  // Singleton noun: find by type match in snapshot
  const panelTypeSlug = nounMatch.panelId.replace(/-/g, '_')
  const entry = snapshot.entries.find(
    e => e.title.toLowerCase() === nounMatch.title.toLowerCase() || e.type === panelTypeSlug
  )
  if (entry?.open) {
    return { handled: true, answer: `Yes. ${entry.title} is currently open.` }
  }
  if (entry) {
    return { handled: true, answer: `No. ${entry.title} is visible but not currently open.` }
  }
  return { handled: true, answer: `${nounMatch.title} is not currently visible on the dashboard.` }
}

function resolveVisibleStateFromSnapshot(
  nounMatch: { panelId: string; title: string },
  familyId: string | null,
  snapshot: DashboardStateSnapshot,
): { handled: boolean; answer?: string } {
  if (familyId) {
    const familyEntries = snapshot.entries.filter(e => e.familyId === familyId)
    const visibleEntries = familyEntries.filter(e => e.presentOnDashboard)
    if (visibleEntries.length === 0) {
      return { handled: true, answer: `No ${nounMatch.title.toLowerCase()} is currently visible.` }
    }
    const names = visibleEntries.map(s => s.title).join(', ')
    return { handled: true, answer: `Yes. The visible ${nounMatch.title.toLowerCase()} panels are: ${names}.` }
  }

  // Singleton
  const panelTypeSlug = nounMatch.panelId.replace(/-/g, '_')
  const entry = snapshot.entries.find(
    e => e.title.toLowerCase() === nounMatch.title.toLowerCase() || e.type === panelTypeSlug
  )
  if (entry?.presentOnDashboard) {
    return { handled: true, answer: `Yes. ${entry.title} is currently visible.` }
  }
  return { handled: true, answer: `No. ${nounMatch.title} is not currently visible.` }
}
