/**
 * Duplicate Family Map
 *
 * Authoritative mapping from dashboard workspace_panels.panel_type values
 * to duplicate family IDs. This is the single source of truth for which
 * panel types share a duplicate-instance namespace.
 *
 * A family groups panel_type values that should share instance labels.
 * For example, 'links_note' and 'links_note_tiptap' both belong to
 * the 'quick-links' family — they share one A/B/C label sequence.
 *
 * Panel types not in this map are singletons (no duplicate identity).
 */

/** Maps dashboard workspace_panels.panel_type to duplicate family ID */
export const DUPLICATE_FAMILY_MAP: Record<string, string> = {
  'links_note': 'quick-links',
  'links_note_tiptap': 'quick-links',
  'navigator': 'navigator',
}

/**
 * Get the duplicate family for a panel type.
 * Returns null for singleton panel types (not duplicable).
 */
export function getDuplicateFamily(panelType: string): string | null {
  return DUPLICATE_FAMILY_MAP[panelType] ?? null
}

/**
 * Get all panel_type values that belong to a family.
 * Returns empty array if the family is unknown.
 */
export function getPanelTypesForFamily(familyId: string): string[] {
  return Object.entries(DUPLICATE_FAMILY_MAP)
    .filter(([, family]) => family === familyId)
    .map(([type]) => type)
}
