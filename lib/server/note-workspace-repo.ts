import { serverPool } from "@/lib/db/pool"
import type { NoteWorkspacePayload, NoteWorkspaceRecord } from "@/lib/types/note-workspace"

const DEFAULT_PAYLOAD: NoteWorkspacePayload = {
  schemaVersion: "1.0.0",
  openNotes: [],
  activeNoteId: null,
  camera: { x: 0, y: 0, scale: 1 },
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
}

const DEFAULT_WORKSPACE_NAME = "Default Workspace"

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

  return {
    schemaVersion: "1.0.0",
    openNotes,
    activeNoteId,
    camera,
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
})

async function insertWorkspace({
  userId,
  name,
  payload,
  isDefault,
}: {
  userId: string
  name?: string
  payload?: NoteWorkspacePayload
  isDefault: boolean
}): Promise<NoteWorkspaceRecord> {
  const trimmedName = name?.trim()
  const workspaceName =
    trimmedName && trimmedName.length > 0 ? trimmedName : isDefault ? DEFAULT_WORKSPACE_NAME : "Workspace"
  const normalizedPayload = sanitizePayload(payload ?? DEFAULT_PAYLOAD)
  const { rows } = await serverPool.query<NoteWorkspaceRow>(
    `INSERT INTO note_workspaces (user_id, name, payload, is_default)
     VALUES ($1, $2, $3, $4)
     RETURNING id, name, payload, revision::text AS revision, created_at, updated_at, is_default,
               jsonb_array_length(payload->'openNotes') AS note_count`,
    [userId, workspaceName, normalizedPayload, isDefault],
  )
  return mapRowToRecord(rows[0])
}

async function ensureDefaultWorkspace(userId: string): Promise<void> {
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
      await insertWorkspace({ userId, isDefault: true })
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

export async function listNoteWorkspaces(userId: string): Promise<NoteWorkspaceRecord[]> {
  await ensureDefaultWorkspace(userId)
  const { rows } = await serverPool.query<NoteWorkspaceRow>(
    `SELECT id, name, payload, revision::text AS revision, created_at, updated_at, is_default,
            jsonb_array_length(payload->'openNotes') AS note_count
       FROM note_workspaces
      WHERE user_id = $1
      ORDER BY is_default DESC, updated_at DESC`,
    [userId],
  )
  return rows.map(mapRowToRecord)
}

export async function getNoteWorkspaceById(userId: string, workspaceId: string): Promise<NoteWorkspaceRecord | null> {
  const { rows } = await serverPool.query<NoteWorkspaceRow>(
    `SELECT id, name, payload, revision::text AS revision, created_at, updated_at, is_default,
            jsonb_array_length(payload->'openNotes') AS note_count
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
): Promise<NoteWorkspaceRecord> {
  return insertWorkspace({ userId, name, payload, isDefault: false })
}

export async function saveNoteWorkspaceRecord(input: {
  userId: string
  workspaceId: string
  payload: NoteWorkspacePayload
  revision: string
  name?: string
}): Promise<NoteWorkspaceRecord> {
  const normalizedPayload = sanitizePayload(input.payload)
  const { rowCount, rows } = await serverPool.query<NoteWorkspaceRow>(
    `UPDATE note_workspaces
        SET payload = $1,
            revision = gen_random_uuid(),
            name = COALESCE(NULLIF($2, ''), name),
            updated_at = now()
      WHERE user_id = $3 AND id = $4 AND revision::text = $5
      RETURNING id, name, payload, revision::text AS revision, created_at, updated_at, is_default,
                jsonb_array_length(payload->'openNotes') AS note_count`,
    [normalizedPayload, input.name?.trim() ?? null, input.userId, input.workspaceId, input.revision],
  )
  if (rowCount === 0) {
    throw new Error("REVISION_MISMATCH")
  }
  return mapRowToRecord(rows[0])
}

export async function deleteNoteWorkspaceRecord(userId: string, workspaceId: string): Promise<void> {
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
