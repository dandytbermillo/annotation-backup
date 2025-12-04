import { serverPool } from "@/lib/db/pool"
import type { NoteWorkspacePayload, NoteWorkspaceRecord } from "@/lib/types/note-workspace"

const DEFAULT_PAYLOAD: NoteWorkspacePayload = {
  schemaVersion: "1.1.0",
  openNotes: [],
  activeNoteId: null,
  camera: { x: 0, y: 0, scale: 1 },
  panels: [],
  components: [],
}

let schemaReadyPromise: Promise<void> | null = null

async function ensureSchemaReady(): Promise<void> {
  if (schemaReadyPromise) {
    return schemaReadyPromise
  }
  schemaReadyPromise = (async () => {
    await serverPool.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto"`)
    // Note: The actual table schema is managed by migrations.
    // This CREATE TABLE is kept for backwards compatibility but the real schema
    // includes item_id and other columns added by migrations.
    await serverPool.query(`
      CREATE TABLE IF NOT EXISTS note_workspaces (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL,
        name TEXT NOT NULL DEFAULT 'Workspace',
        payload JSONB NOT NULL DEFAULT '{"schemaVersion":"1.0.0","openNotes":[],"activeNoteId":null,"camera":{"x":0,"y":0,"scale":1}}'::jsonb,
        revision UUID NOT NULL DEFAULT gen_random_uuid(),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        is_default BOOLEAN NOT NULL DEFAULT FALSE
      )
    `)
    // Use the per-entry unique constraint (one default per user+item)
    // This replaces the old per-user constraint
    await serverPool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS note_workspaces_unique_default_per_entry
        ON note_workspaces(user_id, item_id)
        WHERE is_default AND item_id IS NOT NULL
    `)
    await serverPool.query(`
      CREATE INDEX IF NOT EXISTS note_workspaces_open_notes_idx
        ON note_workspaces
        USING GIN ((payload->'openNotes'))
    `)
  })().catch((error) => {
    schemaReadyPromise = null
    throw error
  })
  return schemaReadyPromise
}

type NoteWorkspaceRow = {
  id: string
  name: string
  payload: NoteWorkspacePayload | null
  revision: string
  created_at: string | Date
  updated_at: string | Date
  is_default: boolean
  note_count: number | string | null
  item_id?: string
}

const DEFAULT_WORKSPACE_NAME = "Default Workspace"

// Default item ID for workspaces created without a specific entry
// This is the "Legacy Workspaces" folder under the user's home
const DEFAULT_LEGACY_WORKSPACES_PATH = '/knowledge-base/home-00000000-0000-0000-0000-000000000000/legacy-workspaces'

async function getOrCreateLegacyWorkspacesFolder(userId: string): Promise<string> {
  // First, try to find existing Legacy Workspaces folder
  const existing = await serverPool.query<{ id: string }>(
    `SELECT id FROM items WHERE path = $1 AND deleted_at IS NULL LIMIT 1`,
    [DEFAULT_LEGACY_WORKSPACES_PATH],
  )
  if (existing.rows[0]) {
    return existing.rows[0].id
  }

  // Create the folder hierarchy if it doesn't exist
  // First ensure home folder exists
  const userHomeSlug = `home-${userId}`
  const userHomePath = `/knowledge-base/${userHomeSlug}`

  // Get or create Knowledge Base root
  const kbResult = await serverPool.query<{ id: string }>(
    `SELECT id FROM items WHERE path = '/knowledge-base' AND deleted_at IS NULL LIMIT 1`,
  )
  const kbId = kbResult.rows[0]?.id
  if (!kbId) {
    throw new Error('Knowledge Base root folder not found')
  }

  // Get or create user home folder
  let homeResult = await serverPool.query<{ id: string }>(
    `SELECT id FROM items WHERE path = $1 AND deleted_at IS NULL LIMIT 1`,
    [userHomePath],
  )
  let homeId = homeResult.rows[0]?.id
  if (!homeId) {
    const insertHome = await serverPool.query<{ id: string }>(
      `INSERT INTO items (type, parent_id, path, name, slug)
       VALUES ('folder', $1, $2, 'Home', $3)
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [kbId, userHomePath, userHomeSlug],
    )
    homeId = insertHome.rows[0]?.id
    if (!homeId) {
      // Race condition - try to fetch again
      homeResult = await serverPool.query<{ id: string }>(
        `SELECT id FROM items WHERE path = $1 AND deleted_at IS NULL LIMIT 1`,
        [userHomePath],
      )
      homeId = homeResult.rows[0]?.id
    }
  }
  if (!homeId) {
    throw new Error('Failed to create or find user home folder')
  }

  // Get or create Legacy Workspaces folder
  const legacyPath = `${userHomePath}/legacy-workspaces`
  let legacyResult = await serverPool.query<{ id: string }>(
    `SELECT id FROM items WHERE path = $1 AND deleted_at IS NULL LIMIT 1`,
    [legacyPath],
  )
  let legacyId = legacyResult.rows[0]?.id
  if (!legacyId) {
    const insertLegacy = await serverPool.query<{ id: string }>(
      `INSERT INTO items (type, parent_id, path, name, slug)
       VALUES ('folder', $1, $2, 'Legacy Workspaces', 'legacy-workspaces')
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [homeId, legacyPath],
    )
    legacyId = insertLegacy.rows[0]?.id
    if (!legacyId) {
      // Race condition - try to fetch again
      legacyResult = await serverPool.query<{ id: string }>(
        `SELECT id FROM items WHERE path = $1 AND deleted_at IS NULL LIMIT 1`,
        [legacyPath],
      )
      legacyId = legacyResult.rows[0]?.id
    }
  }
  if (!legacyId) {
    throw new Error('Failed to create or find Legacy Workspaces folder')
  }

  return legacyId
}

const normalizeTimestamp = (value: string | Date | null | undefined): string => {
  if (!value) {
    return new Date().toISOString()
  }
  if (value instanceof Date) {
    return value.toISOString()
  }
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString()
}

const sanitizePayload = (payload: NoteWorkspacePayload | null | undefined): NoteWorkspacePayload => {
  if (!payload || typeof payload !== "object") {
    return { ...DEFAULT_PAYLOAD, camera: { ...DEFAULT_PAYLOAD.camera }, openNotes: [] }
  }

  const sanitizePanelSnapshot = (
    panels: NoteWorkspacePayload["panels"],
  ): NoteWorkspacePayload["panels"] => {
    if (!Array.isArray(panels)) return []
    return panels
      .map((panel) => {
        if (!panel || typeof panel !== "object") return null
        const noteId = typeof panel.noteId === "string" ? panel.noteId : null
        const panelId = typeof (panel as any).panelId === "string" ? (panel as any).panelId : null
        if (!noteId || !panelId) return null
        const position =
          panel.position && typeof panel.position === "object"
            ? {
                x: Number((panel.position as any).x) || 0,
                y: Number((panel.position as any).y) || 0,
              }
            : null
        const size =
          panel.size && typeof panel.size === "object"
            ? {
                width: Number((panel.size as any).width) || 0,
                height: Number((panel.size as any).height) || 0,
              }
            : null
        const worldPosition =
          panel.worldPosition && typeof panel.worldPosition === "object"
            ? {
                x: Number((panel.worldPosition as any).x) || 0,
                y: Number((panel.worldPosition as any).y) || 0,
              }
            : null
        const worldSize =
          panel.worldSize && typeof panel.worldSize === "object"
            ? {
                width: Number((panel.worldSize as any).width) || 0,
                height: Number((panel.worldSize as any).height) || 0,
              }
            : null
        const metadata =
          panel.metadata && typeof panel.metadata === "object" ? (panel.metadata as Record<string, unknown>) : null
        const branches = Array.isArray(panel.branches) ? panel.branches.map((entry) => String(entry)) : null
        return {
          noteId,
          panelId,
          type: typeof panel.type === "string" ? panel.type : null,
          title: typeof (panel as any).title === "string" ? (panel as any).title : null,
          position,
          size,
          zIndex: typeof panel.zIndex === "number" ? panel.zIndex : null,
          metadata,
          parentId: typeof panel.parentId === "string" ? panel.parentId : null,
          branches,
          worldPosition,
          worldSize,
        }
      })
      .filter((panel): panel is NoteWorkspacePayload["panels"][number] => Boolean(panel))
  }

  const openNotes = Array.isArray(payload.openNotes)
    ? payload.openNotes
        .map((panel) => {
          if (!panel || typeof panel !== "object" || typeof panel.noteId !== "string") {
            return null
          }
          return {
            noteId: panel.noteId,
            position: panel.position ?? null,
            size: panel.size ?? null,
            zIndex: typeof panel.zIndex === "number" ? panel.zIndex : null,
            isPinned: Boolean(panel.isPinned),
          }
        })
        .filter((panel): panel is Exclude<typeof panel, null> => Boolean(panel))
    : []

  const camera =
    payload.camera && typeof payload.camera === "object"
      ? {
          x: Number((payload.camera as any).x) || 0,
          y: Number((payload.camera as any).y) || 0,
          scale: Number((payload.camera as any).scale) || 1,
        }
      : { ...DEFAULT_PAYLOAD.camera }

  const activeNoteId = typeof payload.activeNoteId === "string" ? payload.activeNoteId : null

  const components = Array.isArray((payload as any).components)
    ? (payload as any).components
        .map((c: any) => {
          if (!c || typeof c !== "object" || typeof c.id !== "string" || typeof c.type !== "string") {
            return null
          }
          const position =
            c.position && typeof c.position === "object"
              ? { x: Number((c.position as any).x) || 0, y: Number((c.position as any).y) || 0 }
              : null
          const size =
            c.size && typeof c.size === "object"
              ? { width: Number((c.size as any).width) || 0, height: Number((c.size as any).height) || 0 }
              : null
          return {
            id: c.id,
            type: c.type,
            position,
            size,
            zIndex: typeof c.zIndex === "number" ? c.zIndex : null,
            metadata: c.metadata && typeof c.metadata === "object" ? c.metadata : null,
          }
        })
        .filter(Boolean)
    : []

  return {
    schemaVersion: payload.schemaVersion ?? "1.1.0",
    openNotes,
    activeNoteId,
    camera,
    panels: sanitizePanelSnapshot(payload.panels),
    components,
  }
}

const mapRowToRecord = (row: NoteWorkspaceRow): NoteWorkspaceRecord => ({
  id: row.id,
  name: row.name,
  payload: sanitizePayload(row.payload),
  revision: row.revision,
  createdAt: normalizeTimestamp(row.created_at),
  updatedAt: normalizeTimestamp(row.updated_at),
  isDefault: row.is_default,
  noteCount: Number(row.note_count ?? 0),
  itemId: row.item_id,
})

async function insertWorkspace({
  userId,
  name,
  payload,
  isDefault,
  itemId,
}: {
  userId: string
  name?: string
  payload?: NoteWorkspacePayload
  isDefault: boolean
  itemId: string
}): Promise<NoteWorkspaceRecord> {
  await ensureSchemaReady()
  const trimmedName = name?.trim()
  const workspaceName =
    trimmedName && trimmedName.length > 0 ? trimmedName : isDefault ? DEFAULT_WORKSPACE_NAME : "Workspace"
  const normalizedPayload = sanitizePayload(payload ?? DEFAULT_PAYLOAD)
  const { rows } = await serverPool.query<NoteWorkspaceRow>(
    `INSERT INTO note_workspaces (user_id, name, payload, is_default, item_id)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, name, payload, revision::text AS revision, created_at, updated_at, is_default,
               jsonb_array_length(payload->'openNotes') AS note_count, item_id`,
    [userId, workspaceName, normalizedPayload, isDefault, itemId],
  )
  return mapRowToRecord(rows[0])
}

async function ensureDefaultWorkspace(userId: string): Promise<void> {
  await ensureSchemaReady()
  const existingDefault = await serverPool.query<{ id: string }>(
    `SELECT id FROM note_workspaces WHERE user_id = $1 AND is_default = TRUE LIMIT 1`,
    [userId],
  )
  if (existingDefault.rowCount && existingDefault.rowCount > 0) {
    return
  }

  const anyWorkspace = await serverPool.query<{ id: string }>(
    `SELECT id FROM note_workspaces WHERE user_id = $1 ORDER BY created_at ASC LIMIT 1`,
    [userId],
  )

  if (anyWorkspace.rowCount === 0) {
    try {
      const itemId = await getOrCreateLegacyWorkspacesFolder(userId)
      await insertWorkspace({ userId, isDefault: true, itemId })
    } catch (error) {
      const code = (error as { code?: string } | null)?.code
      if (code !== "23505") {
        throw error
      }
    }
    return
  }

  const targetId = anyWorkspace.rows[0]?.id
  if (!targetId) {
    return
  }
  await serverPool.query(`UPDATE note_workspaces SET is_default = TRUE WHERE user_id = $1 AND id = $2`, [
    userId,
    targetId,
  ])
}

export async function ensureDefaultWorkspaceRecord(userId: string): Promise<NoteWorkspaceRecord | null> {
  await ensureDefaultWorkspace(userId)
  const { rows } = await serverPool.query<NoteWorkspaceRow>(
    `SELECT id, name, payload, revision::text AS revision, created_at, updated_at, is_default,
            jsonb_array_length(payload->'openNotes') AS note_count, item_id
       FROM note_workspaces
      WHERE user_id = $1 AND is_default = TRUE
      LIMIT 1`,
    [userId],
  )
  const row = rows[0]
  if (!row) return null
  return mapRowToRecord(row)
}

export async function listNoteWorkspaces(userId: string): Promise<NoteWorkspaceRecord[]> {
  await ensureSchemaReady()
  await ensureDefaultWorkspace(userId)
  const { rows } = await serverPool.query<NoteWorkspaceRow>(
    `SELECT id, name, payload, revision::text AS revision, created_at, updated_at, is_default,
            jsonb_array_length(payload->'openNotes') AS note_count, item_id
       FROM note_workspaces
      WHERE user_id = $1
      ORDER BY is_default DESC, updated_at DESC`,
    [userId],
  )
  return rows.map(mapRowToRecord)
}

/**
 * List workspaces for a specific item (entry/folder)
 * Used by Navigator panel to show workspaces when expanding an entry
 */
export async function listNoteWorkspacesByItemId(userId: string, itemId: string): Promise<NoteWorkspaceRecord[]> {
  await ensureSchemaReady()
  const { rows } = await serverPool.query<NoteWorkspaceRow>(
    `SELECT id, name, payload, revision::text AS revision, created_at, updated_at, is_default,
            jsonb_array_length(payload->'openNotes') AS note_count, item_id
       FROM note_workspaces
      WHERE user_id = $1 AND item_id = $2
      ORDER BY is_default DESC, updated_at DESC`,
    [userId, itemId],
  )
  return rows.map(mapRowToRecord)
}

export async function getNoteWorkspaceById(userId: string, workspaceId: string): Promise<NoteWorkspaceRecord | null> {
  await ensureSchemaReady()
  const { rows } = await serverPool.query<NoteWorkspaceRow>(
    `SELECT id, name, payload, revision::text AS revision, created_at, updated_at, is_default,
            jsonb_array_length(payload->'openNotes') AS note_count, item_id
       FROM note_workspaces
      WHERE user_id = $1 AND id = $2`,
    [userId, workspaceId],
  )
  const row = rows[0]
  if (!row) return null
  return mapRowToRecord(row)
}

export async function createNoteWorkspaceRecord(
  userId: string,
  name: string | undefined,
  payload: NoteWorkspacePayload,
  itemId?: string,
): Promise<NoteWorkspaceRecord> {
  await ensureSchemaReady()
  // If no itemId provided, use the Legacy Workspaces folder
  const resolvedItemId = itemId || await getOrCreateLegacyWorkspacesFolder(userId)
  return insertWorkspace({ userId, name, payload, isDefault: false, itemId: resolvedItemId })
}

export async function saveNoteWorkspaceRecord(input: {
  userId: string
  workspaceId: string
  payload: NoteWorkspacePayload
  revision: string
  name?: string
}): Promise<NoteWorkspaceRecord> {
  await ensureSchemaReady()
  const normalizedPayload = sanitizePayload(input.payload)
  const { rowCount, rows } = await serverPool.query<NoteWorkspaceRow>(
    `UPDATE note_workspaces
        SET payload = $1,
            revision = gen_random_uuid(),
            name = COALESCE(NULLIF($2, ''), name),
            updated_at = now()
      WHERE user_id = $3 AND id = $4 AND revision::text = $5
      RETURNING id, name, payload, revision::text AS revision, created_at, updated_at, is_default,
                jsonb_array_length(payload->'openNotes') AS note_count, item_id`,
    [normalizedPayload, input.name?.trim() ?? null, input.userId, input.workspaceId, input.revision],
  )
  if (rowCount === 0) {
    throw new Error("REVISION_MISMATCH")
  }
  return mapRowToRecord(rows[0])
}

export async function deleteNoteWorkspaceRecord(userId: string, workspaceId: string): Promise<void> {
  await ensureSchemaReady()
  const lookup = await serverPool.query<{ is_default: boolean }>(
    `SELECT is_default FROM note_workspaces WHERE user_id = $1 AND id = $2`,
    [userId, workspaceId],
  )
  const row = lookup.rows[0]
  if (!row) {
    throw new Error("NOT_FOUND")
  }
  if (row.is_default) {
    throw new Error("CANNOT_DELETE_DEFAULT")
  }
  await serverPool.query(`DELETE FROM note_workspaces WHERE user_id = $1 AND id = $2`, [userId, workspaceId])
}
