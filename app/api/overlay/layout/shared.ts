import type { Pool } from 'pg'

import {
  OVERLAY_LAYOUT_SCHEMA_VERSION,
  OverlayInspectorState,
  OverlayLayoutEnvelope,
  OverlayLayoutPayload,
  OverlayLayoutDiagnostics,
  OverlayPopupDescriptor,
  type OverlayResolvedChild,
  type OverlayResolvedFolder,
} from '@/lib/types/overlay-layout'

export const MAX_LAYOUT_BYTES = 128 * 1024 // 128 KB cap to avoid runaway payloads
export const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function coerceNumber(value: unknown): number | null {
  if (typeof value !== 'number') return null
  return Number.isFinite(value) ? value : null
}

export function normalizePopups(raw: unknown): OverlayPopupDescriptor[] {
  if (!Array.isArray(raw)) return []

  const popups: OverlayPopupDescriptor[] = []

  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue
    const candidate = entry as Record<string, unknown>

    if (typeof candidate.id !== 'string' || candidate.id.length === 0) continue

    const canvasPosition = candidate.canvasPosition as Record<string, unknown> | undefined
    const x = coerceNumber(canvasPosition?.x)
    const y = coerceNumber(canvasPosition?.y)
    if (x === null || y === null) continue

    const levelRaw = coerceNumber(candidate.level)
    const level = levelRaw === null ? 0 : Math.trunc(levelRaw)

    const popup: OverlayPopupDescriptor = {
      id: candidate.id,
      folderId: typeof candidate.folderId === 'string' ? candidate.folderId : null,
      parentId: typeof candidate.parentId === 'string' ? candidate.parentId : null,
      canvasPosition: { x, y },
      level,
    }

    if (typeof candidate.folderName === 'string' && candidate.folderName.length > 0) {
      popup.folderName = candidate.folderName
    }

    if (typeof candidate.folderColor === 'string' && candidate.folderColor.length > 0) {
      popup.folderColor = candidate.folderColor
    }

    const widthValue = coerceNumber(candidate.width)
    if (widthValue !== null) {
      popup.width = widthValue
    }

    const heightValue = coerceNumber(candidate.height)
    if (heightValue !== null) {
      popup.height = heightValue
    }

    popups.push(popup)
  }

  return popups
}

function normalizeInspectors(raw: unknown): OverlayInspectorState[] {
  if (!Array.isArray(raw)) return []

  const inspectors: OverlayInspectorState[] = []

  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue
    const candidate = entry as Record<string, unknown>

    if (typeof candidate.type !== 'string' || candidate.type.length === 0) continue
    if (typeof candidate.visible !== 'boolean') continue

    const inspector: OverlayInspectorState = {
      type: candidate.type,
      visible: candidate.visible,
    }

    if (typeof candidate.pane === 'string') {
      inspector.pane = candidate.pane
    }

    inspectors.push(inspector)
  }

  return inspectors
}

export function normalizeLayout(
  layout: unknown,
  { useServerTimestamp }: { useServerTimestamp: boolean }
): OverlayLayoutPayload {
  const fallbackTimestamp = new Date().toISOString()

  if (!layout || typeof layout !== 'object') {
    return {
      schemaVersion: OVERLAY_LAYOUT_SCHEMA_VERSION,
      popups: [],
      inspectors: [],
      lastSavedAt: fallbackTimestamp,
    }
  }

  const candidate = layout as Record<string, unknown>
  const schemaVersion =
    typeof candidate.schemaVersion === 'string' && candidate.schemaVersion.length > 0
      ? candidate.schemaVersion
      : OVERLAY_LAYOUT_SCHEMA_VERSION

  const popups = normalizePopups(candidate.popups)
  const inspectors = normalizeInspectors(candidate.inspectors)

  let lastSavedAt = fallbackTimestamp
  if (!useServerTimestamp && typeof candidate.lastSavedAt === 'string') {
    const parsed = new Date(candidate.lastSavedAt)
    if (!Number.isNaN(parsed.getTime())) {
      lastSavedAt = parsed.toISOString()
    }
  } else if (useServerTimestamp) {
    lastSavedAt = fallbackTimestamp
  }

  return {
    schemaVersion,
    popups,
    inspectors,
    lastSavedAt,
  }
}

export interface OverlayLayoutRow {
  layout: unknown
  version: string
  revision: string
  updated_at: string | Date
  workspace_id: string | null
}

export function buildEnvelope(row: OverlayLayoutRow): OverlayLayoutEnvelope {
  const normalizedLayout = normalizeLayout(row.layout, { useServerTimestamp: false })
  return {
    layout: normalizedLayout,
    version: row.version,
    revision: row.revision,
    updatedAt:
      row.updated_at instanceof Date
        ? row.updated_at.toISOString()
        : new Date(row.updated_at).toISOString(),
  }
}

export type ParsedUserId = string | null | 'invalid'

export function parseUserId(searchValue: string | null): ParsedUserId {
  if (!searchValue || searchValue.length === 0) return null
  return UUID_REGEX.test(searchValue) ? searchValue : 'invalid'
}

type FolderRow = {
  id: string
  name: string | null
  path: string | null
  color: string | null
  parent_id: string | null
  workspace_id: string | null
}

type AncestorRow = {
  id: string
  parent_id: string | null
  color: string | null
  name: string | null
  path: string | null
  origin_id: string
  depth: number
}

type ChildRow = {
  id: string
  parent_id: string | null
  name: string | null
  type: string
  path: string | null
  color: string | null
  created_at: Date | string | null
  updated_at: Date | string | null
}

const MAX_COLOR_LOOKUP_DEPTH = 10

function coerceTimestamp(value: Date | string | null): string | null {
  if (!value) return null
  if (value instanceof Date) {
    return value.toISOString()
  }
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
}

function toResolvedChild(row: ChildRow): OverlayResolvedChild {
  const createdAt = coerceTimestamp(row.created_at)
  const updatedAt = coerceTimestamp(row.updated_at)
  const normalizedType = row.type === 'folder' ? 'folder' : 'note'

  return {
    id: row.id,
    name: row.name ?? 'Untitled',
    type: normalizedType,
    color: row.color,
    path: row.path,
    parentId: row.parent_id,
    createdAt,
    updatedAt,
  }
}

function buildResolvedFolder(
  popupId: string,
  descriptor: OverlayPopupDescriptor,
  folderRow: FolderRow | undefined,
  ancestorRows: AncestorRow[],
  childRows: ChildRow[]
): [string, OverlayResolvedFolder] | null {
  if (!folderRow) {
    return null
  }

  const sortedAncestors = ancestorRows
    .filter(row => row.origin_id === folderRow.id)
    .sort((a, b) => a.depth - b.depth)

  const resolvedColor =
    folderRow.color ??
    (sortedAncestors.find(row => row.color)?.color ?? null)

  const resolvedChildren = childRows
    .filter(child => child.parent_id === folderRow.id)
    .map(toResolvedChild)

  const resolvedFolder: OverlayResolvedFolder = {
    id: folderRow.id,
    name: folderRow.name ?? descriptor.folderName ?? 'Untitled Folder',
    level: descriptor.level ?? 0,
    path: folderRow.path,
    color: resolvedColor,
    parentId: folderRow.parent_id,
    children: resolvedChildren,
    workspaceId: folderRow.workspace_id,
  }

  return [popupId, resolvedFolder]
}

async function fetchResolvedFolders(
  layout: OverlayLayoutPayload,
  pool: Pool,
  targetWorkspaceId: string | null
): Promise<{
  resolvedFolders: Record<string, OverlayResolvedFolder>
  diagnostics: OverlayLayoutDiagnostics
}> {
  const missingFolders: OverlayLayoutDiagnostics['missingFolders'] = []
  const workspaceMismatches: OverlayLayoutDiagnostics['workspaceMismatches'] = []

  const popupsWithFolderId = layout.popups.filter(popup => {
    if (!popup.folderId) {
      missingFolders.push({ popupId: popup.id, folderId: null })
      return false
    }
    return true
  })

  const folderIds = Array.from(new Set(popupsWithFolderId.map(popup => popup.folderId!)))

  if (folderIds.length === 0) {
    return {
      resolvedFolders: {},
      diagnostics: {
        missingFolders,
        workspaceMismatches,
      },
    }
  }

  const client = await pool.connect()
  try {
    const folderQuery = client.query<FolderRow>(
      `SELECT id, name, path, color, parent_id, workspace_id
         FROM items
        WHERE id = ANY($1)
          AND deleted_at IS NULL`,
      [folderIds]
    )

    const ancestorQuery = client.query<AncestorRow>(
      `WITH RECURSIVE ancestors AS (
          SELECT id,
                 parent_id,
                 color,
                 name,
                 path,
                 id AS origin_id,
                 0   AS depth
            FROM items
           WHERE id = ANY($1)
             AND deleted_at IS NULL
          UNION ALL
          SELECT i.id,
                 i.parent_id,
                 i.color,
                 i.name,
                 i.path,
                 ancestors.origin_id,
                 ancestors.depth + 1
            FROM items i
            JOIN ancestors ON ancestors.parent_id = i.id
           WHERE i.deleted_at IS NULL
             AND ancestors.depth < $2
        )
        SELECT id,
               parent_id,
               color,
               name,
               path,
               origin_id,
               depth
          FROM ancestors`,
      [folderIds, MAX_COLOR_LOOKUP_DEPTH]
    )

    const childrenQuery = client.query<ChildRow>(
      `SELECT id,
              parent_id,
              name,
              type,
              path,
              color,
              created_at,
              updated_at
         FROM items
        WHERE parent_id = ANY($1)
          AND deleted_at IS NULL
        ORDER BY position NULLS LAST, name ASC`,
      [folderIds]
    )

    const [folderRows, ancestorRows, childRows] = await Promise.all([
      folderQuery,
      ancestorQuery,
      childrenQuery,
    ])

    const folderMap = new Map<string, FolderRow>()
    folderRows.rows.forEach(row => {
      folderMap.set(row.id, row)
    })

    const resolvedEntries: Array<[string, OverlayResolvedFolder]> = []

    for (const popup of layout.popups) {
      if (!popup.folderId) {
        // Already tracked as missing earlier
        continue
      }

      const folderRow = folderMap.get(popup.folderId)
      if (!folderRow) {
        missingFolders.push({ popupId: popup.id, folderId: popup.folderId })
        continue
      }

      if (
        targetWorkspaceId &&
        folderRow.workspace_id &&
        folderRow.workspace_id !== targetWorkspaceId
      ) {
        workspaceMismatches.push({
          popupId: popup.id,
          folderId: popup.folderId,
          expectedWorkspaceId: targetWorkspaceId,
          actualWorkspaceId: folderRow.workspace_id,
        })
      }

      const resolved = buildResolvedFolder(
        popup.id,
        popup,
        folderRow,
        ancestorRows.rows,
        childRows.rows
      )
      if (resolved) {
        resolvedEntries.push(resolved)
      }
    }

    return {
      resolvedFolders: Object.fromEntries(resolvedEntries),
      diagnostics: {
        missingFolders,
        workspaceMismatches,
      },
    }
  } catch (error) {
    console.error('[overlay-layout] Failed to resolve folder metadata', error)
    return {
      resolvedFolders: {},
      diagnostics: {
        missingFolders,
        workspaceMismatches,
      },
    }
  } finally {
    client.release()
  }
}

export async function buildEnvelopeWithMetadata(
  row: OverlayLayoutRow,
  pool: Pool
): Promise<OverlayLayoutEnvelope> {
  const baseEnvelope = buildEnvelope(row)

  if (baseEnvelope.layout.popups.length === 0) {
    return baseEnvelope
  }

  const { resolvedFolders, diagnostics } = await fetchResolvedFolders(
    baseEnvelope.layout,
    pool,
    row.workspace_id ?? null
  )

  const hasResolvedFolders = Object.keys(resolvedFolders).length > 0
  const hasDiagnostics =
    diagnostics.missingFolders.length > 0 || diagnostics.workspaceMismatches.length > 0

  if (!hasResolvedFolders && !hasDiagnostics) {
    return baseEnvelope
  }

  return {
    ...baseEnvelope,
    layout: {
      ...baseEnvelope.layout,
      ...(hasResolvedFolders ? { resolvedFolders } : {}),
      ...(hasDiagnostics ? { diagnostics } : {}),
    },
  }
}
