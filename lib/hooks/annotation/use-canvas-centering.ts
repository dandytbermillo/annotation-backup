import { useCallback, useRef, useState } from "react"
import type { MutableRefObject } from "react"
import { centerOnNotePanel, type CenterOnNoteOptions } from "@/lib/canvas/center-on-note"

export const CENTER_RETRY_ATTEMPTS = 2
export const CENTER_RETRY_DELAY_MS = 160
export const POST_LOAD_CENTER_ATTEMPTS = 6
export const POST_LOAD_CENTER_DELAY_MS = 180
export const POST_LOAD_SECOND_PASS_DELAY_MS = 420
export const POST_LOAD_PENDING_CLEAR_DELAY_MS = 2200
export const CENTER_EXISTING_NOTES_ENABLED =
  process.env.NEXT_PUBLIC_CANVAS_CENTER_EXISTING_NOTES !== "disabled"

type DebugLogFn = (payload: {
  component: string
  action: string
  metadata?: Record<string, unknown>
}) => void

type WorkspaceEvents = { emit: (event: string, payload: any) => void }

type UseCanvasCenteringOptions = {
  activeNoteIdRef: MutableRefObject<string | null>
  debugLog: DebugLogFn
  sharedWorkspace: { events?: WorkspaceEvents } | null
}

type Point = { x: number; y: number }

export type UseCanvasCenteringResult = {
  canvasRef: MutableRefObject<any>
  freshNoteSeeds: Record<string, Point>
  freshNoteIds: string[]
  registerFreshNote: (noteId: string) => void
  consumeFreshNoteSeed: (noteId: string) => void
  storeFreshNoteSeed: (noteId: string, position: Point) => void
  handleFreshNoteHydrated: (noteId: string) => void
  handleSnapshotLoadComplete: () => void
  centerNoteOnCanvas: (noteId: string, overrides?: CenterOnNoteOptions) => void
  queueCenterAfterSnapshot: (noteId: string | null) => void
}

export function useCanvasCentering({
  activeNoteIdRef,
  debugLog,
  sharedWorkspace,
}: UseCanvasCenteringOptions): UseCanvasCenteringResult {
  const canvasRef = useRef<any>(null)
  const freshNotesRef = useRef<Set<string>>(new Set())
  const [freshNoteSeeds, setFreshNoteSeeds] = useState<Record<string, Point>>({})
  const [freshNoteIds, setFreshNoteIds] = useState<string[]>([])
  const pendingCenterAfterLoadRef = useRef<string | null>(null)
  const lastCanvasLoadTimeRef = useRef<number>(0)

  const registerFreshNote = useCallback((noteId: string) => {
    if (!noteId || freshNotesRef.current.has(noteId)) return
    freshNotesRef.current.add(noteId)
    setFreshNoteIds(Array.from(freshNotesRef.current))
  }, [])

  const consumeFreshNoteSeed = useCallback((targetNoteId: string) => {
    setFreshNoteSeeds(prev => {
      if (!prev[targetNoteId]) return prev
      const next = { ...prev }
      delete next[targetNoteId]
      return next
    })
  }, [])

  const storeFreshNoteSeed = useCallback((noteId: string, position: Point) => {
    if (!noteId) return
    setFreshNoteSeeds(prev => ({
      ...prev,
      [noteId]: position,
    }))
  }, [])

  const handleFreshNoteHydrated = useCallback(
    (noteId: string) => {
      if (!freshNotesRef.current.has(noteId)) {
        return
      }

      freshNotesRef.current.delete(noteId)
      setFreshNoteIds(Array.from(freshNotesRef.current))

      debugLog({
        component: "AnnotationApp",
        action: "fresh_note_hydrated",
        metadata: { noteId },
      })

      const events = sharedWorkspace?.events
      if (!events) return

      try {
        events.emit("workspace:highlight-note", { noteId })
        debugLog({
          component: "AnnotationApp",
          action: "fresh_note_highlight_emitted",
          metadata: { noteId },
        })
      } catch (error) {
        console.warn("[AnnotationApp] Failed to emit highlight for fresh note:", error)
      }
    },
    [sharedWorkspace, debugLog],
  )

  const centerNoteOnCanvas = useCallback(
    (noteId: string, overrides?: CenterOnNoteOptions) => {
      if (!noteId) return

      const attempts = overrides?.attempts ?? CENTER_RETRY_ATTEMPTS
      const delayMs = overrides?.delayMs ?? CENTER_RETRY_DELAY_MS
      const extraShouldRetry = overrides?.shouldRetry

      const shouldRetry = () => {
        if (activeNoteIdRef.current !== noteId) return false
        return extraShouldRetry ? extraShouldRetry() : true
      }

      const handled = centerOnNotePanel(canvasRef.current, noteId, {
        attempts,
        delayMs,
        shouldRetry,
        onError: overrides?.onError,
      })

      if (!handled) {
        debugLog({
          component: "AnnotationApp",
          action: "center_on_panel_skipped",
          metadata: {
            noteId,
            reason: "canvas_unavailable",
          },
        })
      }
    },
    [activeNoteIdRef, debugLog],
  )

  const handleSnapshotLoadComplete = useCallback(() => {
    lastCanvasLoadTimeRef.current = Date.now()
    debugLog({
      component: "AnnotationApp",
      action: "snapshot_load_complete",
      metadata: { timestamp: lastCanvasLoadTimeRef.current },
    })

    const pendingNoteId = pendingCenterAfterLoadRef.current
    if (!pendingNoteId || activeNoteIdRef.current !== pendingNoteId) {
      return
    }

    const scheduleCenter = (attempts = POST_LOAD_CENTER_ATTEMPTS) => {
      centerNoteOnCanvas(pendingNoteId, {
        attempts,
        delayMs: POST_LOAD_CENTER_DELAY_MS,
      })
    }

    setTimeout(() => {
      if (activeNoteIdRef.current === pendingNoteId) {
        scheduleCenter()
      }
    }, 30)

    setTimeout(() => {
      if (activeNoteIdRef.current === pendingNoteId) {
        scheduleCenter(POST_LOAD_CENTER_ATTEMPTS)
      }
    }, POST_LOAD_SECOND_PASS_DELAY_MS)

    setTimeout(() => {
      if (pendingCenterAfterLoadRef.current === pendingNoteId) {
        pendingCenterAfterLoadRef.current = null
      }
    }, POST_LOAD_PENDING_CLEAR_DELAY_MS)
  }, [activeNoteIdRef, centerNoteOnCanvas, debugLog])

  const queueCenterAfterSnapshot = useCallback((noteId: string | null) => {
    pendingCenterAfterLoadRef.current = noteId
  }, [])

  return {
    canvasRef,
    freshNoteSeeds,
    freshNoteIds,
    registerFreshNote,
    consumeFreshNoteSeed,
    storeFreshNoteSeed,
    handleFreshNoteHydrated,
    handleSnapshotLoadComplete,
    centerNoteOnCanvas,
    queueCenterAfterSnapshot,
  }
}
