import { useCallback, useEffect, type MutableRefObject } from "react"
import { ensurePanelKey, parsePanelKey } from "@/lib/canvas/composite-id"

type WorkspaceDataStore = {
  get(key: string): any
  update?(key: string, updates: any): void
  on?(event: string, handler: (...args: any[]) => void): void
  off?(event: string, handler: (...args: any[]) => void): void
}

type SharedWorkspace = {
  dataStore?: WorkspaceDataStore | null
} | null

type NoteTitleSyncDeps = {
  sharedWorkspace: SharedWorkspace
  sortedOpenNotes: Array<{ noteId: string | null }>
  noteTitleMapRef: MutableRefObject<Map<string, string>>
  setTitleForNote: (noteId: string, title: string | null) => void
  ensureTitleFromServer: (noteId: string) => void
  forceNoteTitleUpdate: () => void
}

const hasEventApi = (
  store: WorkspaceDataStore | null | undefined,
): store is WorkspaceDataStore & {
  on: (event: string, handler: (...args: any[]) => void) => void
  off: (event: string, handler: (...args: any[]) => void) => void
} => typeof store?.on === "function" && typeof store?.off === "function"

const deriveTitleFromRecord = (record: unknown): string | null => {
  if (!record || typeof record !== "object") return null
  const typed = record as Record<string, any>
  const candidates = [
    typed.title,
    typed.name,
    typed.metadata?.noteTitle,
    typed.metadata?.title,
    typed.metadata?.displayName,
    typed.metadata?.displayId,
  ]

  for (const candidate of candidates) {
    if (typeof candidate === "string") {
      const trimmed = candidate.trim()
      if (trimmed) {
        return trimmed
      }
    }
  }

  return null
}

export function useWorkspaceNoteTitleSync({
  sharedWorkspace,
  sortedOpenNotes,
  noteTitleMapRef,
  setTitleForNote,
  ensureTitleFromServer,
  forceNoteTitleUpdate,
}: NoteTitleSyncDeps) {
  const updateTitleForNote = useCallback(
    (noteId: string | null | undefined) => {
      if (!noteId) return
      const dataStore = sharedWorkspace?.dataStore
      if (!dataStore) return

      const storeKey = ensurePanelKey(noteId, "main")
      const record = dataStore.get(storeKey)
      const derived = deriveTitleFromRecord(record)
      if (derived) {
        setTitleForNote(noteId, derived)
        return
      }

      const existingTitle = noteTitleMapRef.current.get(noteId)

      if (existingTitle) {
        if (record && typeof record === "object" && typeof dataStore.update === "function") {
          const currentStoreTitle = typeof (record as any).title === "string" ? (record as any).title.trim() : ""
          if (currentStoreTitle !== existingTitle) {
            dataStore.update(storeKey, { title: existingTitle })
          }
        }
        return
      }

      setTitleForNote(noteId, null)
      ensureTitleFromServer(noteId)
    },
    [sharedWorkspace, ensureTitleFromServer, setTitleForNote],
  )

  useEffect(() => {
    if (sortedOpenNotes.length === 0) {
      if (noteTitleMapRef.current.size > 0) {
        noteTitleMapRef.current.clear()
        forceNoteTitleUpdate()
      }
      return
    }

    sortedOpenNotes.forEach((note) => {
      if (note?.noteId) {
        updateTitleForNote(note.noteId)
      }
    })

    const activeIds = new Set(sortedOpenNotes.map((note) => note.noteId).filter(Boolean) as string[])
    let removed = false
    noteTitleMapRef.current.forEach((_value, noteId) => {
      if (!activeIds.has(noteId)) {
        noteTitleMapRef.current.delete(noteId)
        removed = true
      }
    })
    if (removed) {
      forceNoteTitleUpdate()
    }
  }, [sortedOpenNotes, updateTitleForNote, forceNoteTitleUpdate])

  useEffect(() => {
    const dataStore = sharedWorkspace?.dataStore
    if (!hasEventApi(dataStore)) {
      return
    }

    const handleMutation = (key: unknown) => {
      if (typeof key !== "string") return
      const { noteId, panelId } = parsePanelKey(key)
      if (!noteId || panelId !== "main") return
      updateTitleForNote(noteId)
    }

    const handleDelete = (key: unknown) => {
      if (typeof key !== "string") return
      const { noteId, panelId } = parsePanelKey(key)
      if (!noteId || panelId !== "main") return
      setTitleForNote(noteId, null)
    }

    dataStore.on("set", handleMutation)
    dataStore.on("update", handleMutation)
    dataStore.on("delete", handleDelete)

    return () => {
      dataStore.off("set", handleMutation)
      dataStore.off("update", handleMutation)
      dataStore.off("delete", handleDelete)
    }
  }, [sharedWorkspace, updateTitleForNote, setTitleForNote])

  return {
    updateTitleForNote,
  }
}
