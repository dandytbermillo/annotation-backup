import {
  OVERLAY_LAYOUT_SCHEMA_VERSION,
  OverlayInspectorState,
  OverlayLayoutEnvelope,
  OverlayLayoutPayload,
  OverlayPopupDescriptor,
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
