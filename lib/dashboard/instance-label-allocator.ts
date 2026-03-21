/**
 * Instance Label Allocator
 *
 * Shared allocator for duplicate panel instance labels (A, B, C...).
 * Replaces the Links-only badge assignment logic with a generic,
 * family-scoped allocation that works for any duplicable panel family.
 *
 * The family map (duplicate-family-map.ts) determines which panel_type
 * values share a label namespace. The DB unique index on
 * (workspace_id, duplicate_family, instance_label) enforces uniqueness
 * at write time.
 *
 * Overflow policy: fail-closed. If all 26 labels (A-Z) are used,
 * the allocator throws an error. No unlabeled rows in adopted families.
 */

import { serverPool } from '@/lib/db/pool'
import { getDuplicateFamily } from './duplicate-family-map'

/** Maximum instance labels per family per workspace */
const MAX_LABELS = 26

export interface InstanceLabelResult {
  /** The assigned label (A-Z) */
  label: string
  /** The duplicate family ID */
  family: string
}

/**
 * Allocate the next available instance label for a panel type.
 *
 * Returns null for singleton panel types (not duplicable).
 * Throws if all 26 labels are used in the workspace for this family.
 *
 * @param workspaceId - The workspace where the panel is being created
 * @param panelType - The dashboard panel_type value (e.g., 'navigator', 'links_note')
 * @param client - Optional DB client for transactional use (defaults to serverPool)
 */
export async function allocateInstanceLabel(
  workspaceId: string,
  panelType: string,
  client?: { query: typeof serverPool.query },
): Promise<InstanceLabelResult | null> {
  const family = getDuplicateFamily(panelType)
  if (!family) return null

  const db = client ?? serverPool

  // Query existing labels across the entire family in this workspace
  const { rows } = await db.query(
    `SELECT instance_label FROM workspace_panels
     WHERE workspace_id = $1
       AND duplicate_family = $2
       AND instance_label IS NOT NULL
       AND deleted_at IS NULL
     ORDER BY instance_label ASC`,
    [workspaceId, family]
  )

  const usedLabels = new Set(rows.map((r: { instance_label: string }) => r.instance_label))

  // Find next available letter (A-Z), filling gaps
  for (let i = 0; i < MAX_LABELS; i++) {
    const letter = String.fromCharCode(65 + i) // A=65, B=66, ...
    if (!usedLabels.has(letter)) {
      return { label: letter, family }
    }
  }

  // All 26 labels used — fail-closed
  throw new Error(
    `Maximum ${MAX_LABELS} instances of panel family "${family}" per workspace. ` +
    `Remove an existing instance before creating a new one.`
  )
}
