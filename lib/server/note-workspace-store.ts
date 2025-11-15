import fs from "fs/promises"
import path from "path"
import crypto from "crypto"
import type { NoteWorkspacePayload, NoteWorkspaceRecord } from "@/lib/types/note-workspace"

const STORE_DIR = path.join(process.cwd(), "var")
const STORE_FILE = path.join(STORE_DIR, "note-workspaces.json")
const DEFAULT_WORKSPACE_NAME = "Default Workspace"

export type WorkspaceRecord = NoteWorkspaceRecord

async function ensureStoreFile() {
  await fs.mkdir(STORE_DIR, { recursive: true })
  try {
    await fs.access(STORE_FILE)
  } catch {
    const now = new Date().toISOString()
    const initialPayload: NoteWorkspacePayload = {
      schemaVersion: "1.0.0",
      openNotes: [],
      activeNoteId: null,
      camera: { x: 0, y: 0, scale: 1 },
    }
    const defaultWorkspace: WorkspaceRecord = {
      id: crypto.randomUUID(),
      name: DEFAULT_WORKSPACE_NAME,
      payload: initialPayload,
      revision: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
      isDefault: true,
      noteCount: 0,
    }
    await fs.writeFile(STORE_FILE, JSON.stringify([defaultWorkspace], null, 2), "utf8")
  }
}

async function readStore(): Promise<WorkspaceRecord[]> {
  await ensureStoreFile()
  const raw = await fs.readFile(STORE_FILE, "utf8")
  try {
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) {
      return parsed as WorkspaceRecord[]
    }
  } catch {
    // fall through to reset store
  }
  await fs.writeFile(STORE_FILE, "[]", "utf8")
  return []
}

async function writeStore(records: WorkspaceRecord[]) {
  await fs.writeFile(STORE_FILE, JSON.stringify(records, null, 2), "utf8")
}

function sanitizePayload(payload: NoteWorkspacePayload): NoteWorkspacePayload {
  if (!payload || typeof payload !== "object")
    return {
      schemaVersion: "1.0.0",
      openNotes: [],
      activeNoteId: null,
      camera: { x: 0, y: 0, scale: 1 },
    }
  const schemaVersion = payload.schemaVersion === "1.0.0" ? payload.schemaVersion : "1.0.0"
  const openNotes = Array.isArray(payload.openNotes)
    ? payload.openNotes
        .map((panel) => {
          if (!panel || typeof panel !== "object" || typeof panel.noteId !== "string") return null
          return {
            noteId: panel.noteId,
            position: panel.position ?? null,
            size: panel.size ?? null,
            zIndex: typeof panel.zIndex === "number" ? panel.zIndex : null,
            isPinned: Boolean(panel.isPinned),
          }
        })
        .filter(Boolean)
    : []
  const camera = payload.camera && typeof payload.camera === "object"
    ? {
        x: Number((payload.camera as any).x) || 0,
        y: Number((payload.camera as any).y) || 0,
        scale: Number((payload.camera as any).scale) || 1,
      }
    : { x: 0, y: 0, scale: 1 }
  const activeNoteId = typeof payload.activeNoteId === "string" ? payload.activeNoteId : null
  return { schemaVersion, openNotes, activeNoteId, camera }
}

export async function listNoteWorkspaces(): Promise<WorkspaceRecord[]> {
  const records = await readStore()
  return records.map((record) => ({
    ...record,
    noteCount: record.payload.openNotes.length,
  }))
}

export async function getNoteWorkspace(id: string): Promise<WorkspaceRecord | null> {
  const records = await readStore()
  return records.find((record) => record.id === id) ?? null
}

export async function createNoteWorkspace({
  name,
  payload,
  isDefault = false,
}: {
  name?: string
  payload: NoteWorkspacePayload
  isDefault?: boolean
}): Promise<WorkspaceRecord> {
  const sanitized = sanitizePayload(payload)
  const now = new Date().toISOString()
  const records = await readStore()
  const workspace: WorkspaceRecord = {
    id: crypto.randomUUID(),
    name: name?.trim() || `Workspace ${records.length + 1}`,
    payload: sanitized,
    revision: crypto.randomUUID(),
    createdAt: now,
    updatedAt: now,
    isDefault,
    noteCount: sanitized.openNotes.length,
  }
  if (isDefault) {
    records.forEach((record) => {
      if (record.isDefault) record.isDefault = false
    })
  }
  records.push(workspace)
  await writeStore(records)
  return workspace
}

export async function saveNoteWorkspace(
  id: string,
  payload: NoteWorkspacePayload,
  revision: string,
  options?: { name?: string },
): Promise<WorkspaceRecord> {
  const records = await readStore()
  const index = records.findIndex((record) => record.id === id)
  if (index === -1) {
    throw new Error("NOT_FOUND")
  }
  const record = records[index]
  if (record.revision !== revision) {
    throw new Error("REVISION_MISMATCH")
  }
  const sanitized = sanitizePayload(payload)
  const now = new Date().toISOString()
  const trimmedName = options?.name?.trim()
  const updated: WorkspaceRecord = {
    ...record,
    name: trimmedName?.length ? trimmedName : record.name,
    payload: sanitized,
    revision: crypto.randomUUID(),
    updatedAt: now,
    noteCount: sanitized.openNotes.length,
  }
  records[index] = updated
  await writeStore(records)
  return updated
}

export async function deleteNoteWorkspace(id: string): Promise<void> {
  const records = await readStore()
  const index = records.findIndex((record) => record.id === id)
  if (index === -1) {
    throw new Error("NOT_FOUND")
  }
  const record = records[index]
  if (record.isDefault) {
    throw new Error("CANNOT_DELETE_DEFAULT")
  }
  records.splice(index, 1)
  if (!records.some((workspace) => workspace.isDefault)) {
    if (records[0]) records[0].isDefault = true
  }
  await writeStore(records)
}
