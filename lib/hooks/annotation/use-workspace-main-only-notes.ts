import { useCallback, useState } from "react"

export function useWorkspaceMainOnlyNotes() {
  const [mainOnlyNotes, setMainOnlyNotes] = useState<string[]>([])

  const requestMainOnlyNote = useCallback((noteId: string) => {
    if (!noteId) return
    setMainOnlyNotes(prev => (prev.includes(noteId) ? prev : [...prev, noteId]))
  }, [])

  const handleMainOnlyLayoutHandled = useCallback((noteId: string) => {
    if (!noteId) return
    setMainOnlyNotes(prev => prev.filter(id => id !== noteId))
  }, [])

  return {
    mainOnlyNotes,
    requestMainOnlyNote,
    handleMainOnlyLayoutHandled,
  }
}
