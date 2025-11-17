import { useCallback } from "react"
import type {
  Dispatch,
  MutableRefObject,
  SetStateAction,
} from "react"

import {
  CENTER_EXISTING_NOTES_ENABLED,
  CENTER_RETRY_ATTEMPTS,
} from "@/lib/hooks/annotation/use-canvas-centering"
import {
  computeVisuallyCenteredWorldPosition,
  type RapidSequenceState,
} from "@/lib/canvas/visual-centering"
import type { CanvasState, DebugLogFn } from "@/lib/hooks/annotation/use-workspace-canvas-state"
import { trackNoteAccess } from "@/lib/utils/note-creator"
import { isDefaultMainPosition } from "@/lib/canvas/position-utils"

type Point = { x: number; y: number }

type WorkspaceNote = {
  noteId: string
  mainPosition?: Point | null
}

type SharedWorkspace = {
  events?: {
    emit: (event: string, payload: { noteId: string }) => void
  }
} | null

type OpenWorkspaceNote = (
  noteId: string,
  options?: {
    persist?: boolean
    mainPosition?: Point
    persistPosition?: boolean
  },
) => Promise<void>

type CloseWorkspaceNote = (noteId: string, options?: { persist?: boolean; removeWorkspace?: boolean }) => Promise<void>

type NoteSelectionOptions = {
  initialPosition?: Point | null
  source?: "toolbar-create" | "toolbar-open" | "popup" | "recent"
}

export type WorkspaceNoteSelectionHandlers = {
  handleNoteSelect: (noteId: string, options?: NoteSelectionOptions) => void
  handleCloseNote: (noteId: string) => void
  handleCenterNote: (noteId: string) => void
}

type UseWorkspaceNoteSelectionOptions = {
  activeNoteId: string | null
  openNotes: WorkspaceNote[]
  openWorkspaceNote: OpenWorkspaceNote
  closeWorkspaceNote: CloseWorkspaceNote
  requestMainOnlyNote: (noteId: string) => void
  centerNoteOnCanvas: (noteId: string, overrides?: { attempts?: number; delayMs?: number }) => void
  logWorkspaceNotePositions: (context: string) => void
  resolveMainPanelPosition: (noteId: string) => Point | null
  hasRenderedMainPanel: (noteId: string | null | undefined) => boolean
  setActiveNoteId: Dispatch<SetStateAction<string | null>>
  setSkipSnapshotForNote: Dispatch<SetStateAction<string | null>>
  registerFreshNote: (noteId: string) => void
  storeFreshNoteSeed: (noteId: string, position: Point) => void
  bumpRecentNotesRefresh: () => void
  isHydrating: boolean
  sharedWorkspace: SharedWorkspace
  canvasRef: MutableRefObject<any>
  canvasState: CanvasState
  reopenSequenceRef: MutableRefObject<RapidSequenceState>
  lastCanvasInteractionRef: MutableRefObject<{ x: number; y: number } | null>
  debugLog: DebugLogFn
}

export function useWorkspaceNoteSelection({
  activeNoteId,
  openNotes,
  openWorkspaceNote,
  closeWorkspaceNote,
  requestMainOnlyNote,
  centerNoteOnCanvas,
  logWorkspaceNotePositions,
  resolveMainPanelPosition,
  hasRenderedMainPanel,
  setActiveNoteId,
  setSkipSnapshotForNote,
  registerFreshNote,
  storeFreshNoteSeed,
  bumpRecentNotesRefresh,
  isHydrating,
  sharedWorkspace,
  canvasRef,
  canvasState,
  reopenSequenceRef,
  lastCanvasInteractionRef,
  debugLog,
}: UseWorkspaceNoteSelectionOptions): WorkspaceNoteSelectionHandlers {
  const handleNoteSelect = useCallback(
    (noteId: string, options?: NoteSelectionOptions) => {
      debugLog({
        component: "AnnotationApp",
        action: "note_select",
        metadata: {
          noteId,
          activeNoteId,
          isReselect: noteId === activeNoteId,
          source: options?.source,
          hasOptions: Boolean(options),
        },
      })

      const isReselect = noteId === activeNoteId
      const isToolbarCreation = options?.source === "toolbar-create"

      if (isToolbarCreation) {
        registerFreshNote(noteId)
      }

      trackNoteAccess(noteId)
        .then(() => {
          bumpRecentNotesRefresh()
        })
        .catch(() => {
          // trackNoteAccess already logs internally; no further action needed here
        })

      const emitHighlight = () => {
        if (isHydrating) {
          debugLog({
            component: "AnnotationApp",
            action: "highlight_event_skipped",
            metadata: { noteId, reason: "workspace_hydrating" },
          })
          return
        }

        const events = sharedWorkspace?.events
        if (!events) {
          debugLog({
            component: "AnnotationApp",
            action: "highlight_event_skipped",
            metadata: { noteId, reason: "no_workspace_events" },
          })
          return
        }

        try {
          events.emit("workspace:highlight-note", { noteId })
        } catch (error) {
          console.warn("[AnnotationApp] Failed to emit highlight event:", error)
        }
      }

      if (isReselect) {
        logWorkspaceNotePositions("tab_click_reselect")
        debugLog({
          component: "AnnotationApp",
          action: "highlight_note",
          metadata: { noteId },
        })

        if (!isToolbarCreation) {
          emitHighlight()
        }
        return
      }

      setSkipSnapshotForNote(noteId)
      const alreadyOpen = openNotes.some(open => open.noteId === noteId)

      debugLog({
        component: "AnnotationApp",
        action: "toolbar_click_debug",
        metadata: {
          noteId,
          alreadyOpen,
          openNotesCount: openNotes.length,
          openNoteIds: openNotes.map(n => n.noteId),
          isThisNoteInList: alreadyOpen,
        },
      })

      const hasExplicitPosition = Boolean(options?.initialPosition)
      let resolvedPosition = options?.initialPosition ?? null

      const persistedPosition = !alreadyOpen && !hasExplicitPosition
        ? resolveMainPanelPosition(noteId)
        : null

      const panelAlreadyRendered = hasRenderedMainPanel(noteId)

      const hasPersistedPosition = Boolean(
        (persistedPosition && !isDefaultMainPosition(persistedPosition)) ||
        panelAlreadyRendered,
      )

      debugLog({
        component: "AnnotationApp",
        action: "position_guard_check",
        metadata: {
          noteId,
          alreadyOpen,
          hasExplicitPosition,
          hasPersisted: Boolean(persistedPosition),
          panelAlreadyRendered,
          hasPersistedPosition,
          persistedPosition,
        },
      })

      if (isToolbarCreation && !hasExplicitPosition) {
        const currentCamera = canvasRef.current?.getCameraState?.() ?? canvasState

        debugLog({
          component: "AnnotationApp",
          action: "new_note_camera_state",
          metadata: {
            noteId,
            currentCamera,
            canvasState,
            hasGetCameraState: Boolean(canvasRef.current?.getCameraState),
          },
        })

        const viewportCenterX = typeof window !== "undefined" ? window.innerWidth / 2 : 960
        const viewportCenterY = typeof window !== "undefined" ? window.innerHeight / 2 : 540
        const PANEL_WIDTH = 500
        const PANEL_HEIGHT = 400
        const worldX =
          (viewportCenterX - (currentCamera.translateX ?? 0)) / (currentCamera.zoom ?? 1) -
          PANEL_WIDTH / 2
        const worldY =
          (viewportCenterY - (currentCamera.translateY ?? 0)) / (currentCamera.zoom ?? 1) -
          PANEL_HEIGHT / 2

        resolvedPosition = { x: worldX, y: worldY }

        debugLog({
          component: "AnnotationApp",
          action: "new_note_viewport_centered",
          metadata: {
            noteId,
            viewportCenter: { x: viewportCenterX, y: viewportCenterY },
            camera: currentCamera,
            worldPosition: resolvedPosition,
            formula: `x = (${viewportCenterX} - ${currentCamera.translateX ?? 0}) / ${currentCamera.zoom ?? 1} - ${PANEL_WIDTH / 2}`,
            formulaY: `y = (${viewportCenterY} - ${currentCamera.translateY ?? 0}) / ${currentCamera.zoom ?? 1} - ${PANEL_HEIGHT / 2}`,
          },
        })
      } else if (!hasExplicitPosition && !alreadyOpen) {
        resolvedPosition = persistedPosition ?? null

        debugLog({
          component: "AnnotationApp",
          action: "existing_note_persisted_position",
          metadata: {
            noteId,
            persistedPosition: resolvedPosition,
            hasPersistedPosition,
          },
        })
      }

      if (!alreadyOpen) {
        const shouldCenterExisting =
          CENTER_EXISTING_NOTES_ENABLED &&
          !isToolbarCreation &&
          !hasExplicitPosition &&
          !hasPersistedPosition

        debugLog({
          component: "AnnotationApp",
          action: "centering_guard_evaluated",
          metadata: {
            noteId,
            CENTER_EXISTING_NOTES_ENABLED,
            isToolbarCreation,
            hasExplicitPosition,
            hasPersistedPosition,
            panelAlreadyRendered,
            shouldCenterExisting,
            fixBlocked: !shouldCenterExisting && panelAlreadyRendered,
          },
        })

        let usedCenteredOverride = false
        if (shouldCenterExisting) {
          debugLog({
            component: "AnnotationApp",
            action: "centering_override_applying",
            metadata: { noteId, reason: "shouldCenterExisting=true" },
          })

          const currentCamera = canvasRef.current?.getCameraState?.() ?? canvasState

          debugLog({
            component: "AnnotationApp",
            action: "existing_note_centering_camera_state",
            metadata: {
              noteId,
              currentCamera,
              canvasState,
              hasGetCameraState: Boolean(canvasRef.current?.getCameraState),
            },
          })

          const centeredCandidate = computeVisuallyCenteredWorldPosition(
            {
              translateX: currentCamera.translateX,
              translateY: currentCamera.translateY,
              zoom: currentCamera.zoom,
            },
            reopenSequenceRef.current,
            null,
          )

          debugLog({
            component: "AnnotationApp",
            action: "existing_note_centered_candidate",
            metadata: {
              noteId,
              centeredCandidate,
              lastInteraction: lastCanvasInteractionRef.current,
              sequenceCount: reopenSequenceRef.current.count,
            },
          })

          if (centeredCandidate) {
            resolvedPosition = centeredCandidate
            usedCenteredOverride = true
            storeFreshNoteSeed(noteId, centeredCandidate)
          }

          if (usedCenteredOverride) {
            const persisted = resolveMainPanelPosition(noteId)
            debugLog({
              component: "AnnotationApp",
              action: "open_note_centered_override",
              metadata: {
                noteId,
                persistedPosition: persisted,
                centeredPosition: resolvedPosition,
                storedInFreshNoteSeeds: true,
              },
            })
          }
        } else if (panelAlreadyRendered) {
          debugLog({
            component: "AnnotationApp",
            action: "centering_blocked_by_hydration_gap_fix",
            metadata: {
              noteId,
              reason: "Panel already rendered on canvas",
              panelAlreadyRendered,
              hasPersistedPosition,
            },
          })
        }

        if (shouldCenterExisting) {
          requestMainOnlyNote(noteId)
        }

        debugLog({
          component: "AnnotationApp",
          action: "calling_openWorkspaceNote",
          metadata: {
            noteId,
            resolvedPosition,
            isToolbarCreation,
            hasExplicitPosition,
          },
        })

        void openWorkspaceNote(noteId, {
          persist: true,
          mainPosition: resolvedPosition ?? undefined,
          persistPosition: true,
        }).catch(error => {
          console.error("[AnnotationApp] Failed to open note in workspace:", error)
        })
      }

      setActiveNoteId(noteId)
      if (!isToolbarCreation) {
        emitHighlight()
      }
    },
    [
      activeNoteId,
      bumpRecentNotesRefresh,
      canvasRef,
      canvasState,
      debugLog,
      hasRenderedMainPanel,
      isHydrating,
      openNotes,
      openWorkspaceNote,
      registerFreshNote,
      requestMainOnlyNote,
      resolveMainPanelPosition,
      reopenSequenceRef,
      setActiveNoteId,
      setSkipSnapshotForNote,
      sharedWorkspace,
      storeFreshNoteSeed,
      logWorkspaceNotePositions,
      lastCanvasInteractionRef,
    ],
  )

  const handleCloseNote = useCallback(
    (noteId: string) => {
      if (!noteId) return

      void closeWorkspaceNote(noteId, { persist: false, removeWorkspace: false }).catch(error => {
        console.error("[AnnotationApp] Failed to close workspace note:", error)
      })
    },
    [closeWorkspaceNote],
  )

  const handleCenterNote = useCallback(
    (noteId: string) => {
      if (!noteId) return

      debugLog({
        component: "AnnotationApp",
        action: "manual_center_request",
        metadata: {
          noteId,
          activeNoteId,
        },
      })

      if (noteId !== activeNoteId) {
        setActiveNoteId(noteId)
      }

      const events = sharedWorkspace?.events
      if (events) {
        try {
          events.emit("workspace:highlight-note", { noteId })
        } catch (error) {
          console.warn("[AnnotationApp] Failed to emit manual highlight event:", error)
        }
      }

      centerNoteOnCanvas(noteId, { attempts: CENTER_RETRY_ATTEMPTS + 1 })
    },
    [activeNoteId, centerNoteOnCanvas, debugLog, setActiveNoteId, sharedWorkspace],
  )

  return {
    handleNoteSelect,
    handleCloseNote,
    handleCenterNote,
  }
}
