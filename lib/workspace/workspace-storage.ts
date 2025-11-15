"use client"

import type { MutableRefObject, Dispatch, SetStateAction } from "react"

type Position = { x: number; y: number }
type WorkspaceVersionUpdate = { noteId: string; version: number }

export function syncMapToStorage<T>(storageKey: string, mapRef: MutableRefObject<Map<string, T>>) {
  if (typeof window === "undefined") return

  const entries = Array.from(mapRef.current.entries())
  if (entries.length === 0) {
    window.localStorage.removeItem(storageKey)
    return
  }

  try {
    window.localStorage.setItem(storageKey, JSON.stringify(entries))
  } catch (error) {
    console.warn(`[CanvasWorkspace] Failed to persist ${storageKey} to storage`, error)
  }
}

export function persistWorkspaceVersions(
  storageKey: string,
  versionsRef: MutableRefObject<Map<string, number>>,
) {
  if (typeof window === "undefined") return

  const entries = Array.from(versionsRef.current.entries())
  try {
    if (entries.length === 0) {
      window.localStorage.removeItem(storageKey)
    } else {
      window.localStorage.setItem(storageKey, JSON.stringify(entries))
    }
  } catch (error) {
    console.warn("[CanvasWorkspace] Failed to persist workspace versions to storage", error)
  }
}

export function applyWorkspaceVersionUpdates<T extends { noteId: string; version: number }>(
  updates: WorkspaceVersionUpdate[],
  versionsRef: MutableRefObject<Map<string, number>>,
  setOpenNotes: Dispatch<SetStateAction<T[]>>,
) {
  if (!Array.isArray(updates) || updates.length === 0) {
    return
  }

  let mutated = false

  updates.forEach(update => {
    if (!update || typeof update.noteId !== "string") {
      return
    }
    const parsedVersion = Number(update.version)
    if (!Number.isFinite(parsedVersion)) {
      return
    }

    const prevVersion = versionsRef.current.get(update.noteId)
    if (prevVersion === parsedVersion) {
      return
    }

    versionsRef.current.set(update.noteId, parsedVersion)
    mutated = true
  })

  if (!mutated) {
    return
  }

  setOpenNotes(prev =>
    prev.map(note => {
      const updatedVersion = versionsRef.current.get(note.noteId)
      if (updatedVersion === undefined || updatedVersion === note.version) {
        return note
      }
      return { ...note, version: updatedVersion }
    }),
  )
}
