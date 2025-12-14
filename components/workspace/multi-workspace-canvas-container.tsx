"use client"

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useSyncExternalStore,
  type MutableRefObject,
} from "react"
import { debugLog } from "@/lib/utils/debug-logger"
import { AnnotationWorkspaceCanvas, type AnnotationWorkspaceCanvasProps } from "./annotation-workspace-canvas"
import {
  getHotRuntimesInfo,
  getRuntimeVersion,
  subscribeToRuntimeChanges,
} from "@/lib/workspace/runtime-manager"

// Snapshot for useSyncExternalStore - returns version number
// The version increments on ANY runtime change (IDs, visibility, openNotes, etc.)
// This ensures the component re-renders when runtime contents change
const getRuntimeSnapshot = () => getRuntimeVersion()

export type MultiWorkspaceCanvasContainerProps = Omit<
  AnnotationWorkspaceCanvasProps,
  "workspaceId" | "noteIds" | "primaryNoteId"
> & {
  /** The currently active/visible workspace ID */
  activeWorkspaceId: string | null
  /** Pinned workspace IDs - only these workspaces stay mounted when entry is hidden */
  pinnedWorkspaceIds?: string[]
  /** Whether the parent entry is currently active/visible (vs hidden behind another entry) */
  isEntryActive?: boolean
  /** Callback when a canvas becomes visible (for telemetry) */
  onWorkspaceVisible?: (workspaceId: string) => void
  /** Callback when a canvas becomes hidden (for telemetry) */
  onWorkspaceHidden?: (workspaceId: string) => void
}

/**
 * Phase 2: Multi-runtime canvas container.
 *
 * Renders multiple AnnotationWorkspaceCanvas instances (one per hot runtime)
 * and toggles visibility via CSS. This allows workspace switching without
 * tearing down canvas state - components keep running in the background.
 *
 * Key behaviors:
 * - Hidden canvases use CSS visibility:hidden (keeps DOM mounted)
 * - Only the visible canvas receives interactive props (event handlers)
 * - Each canvas is tied to its runtime's DataStore/state
 * - Ref is forwarded to the active canvas for method calls (addComponent, zoomIn, etc.)
 */
export const MultiWorkspaceCanvasContainer = forwardRef<any, MultiWorkspaceCanvasContainerProps>(
  function MultiWorkspaceCanvasContainer(
    {
      activeWorkspaceId,
      pinnedWorkspaceIds,
      isEntryActive = true,
      onWorkspaceVisible,
      onWorkspaceHidden,
      children,
      // All other props are passed to the visible canvas
      ...canvasProps
    },
    ref,
  ) {
    // FIX 10: Extract workspaceSnapshotRevision to pass to ALL canvases (including hidden ones)
    // Without this, hidden canvases default to revision 0, and when they become active they see
    // a "revision jump" (0 → N) which triggers workspaceRestorationInProgressRef = true,
    // causing the canvas to enter cold-restore mode and lose component state (alarms, etc.)
    const { workspaceSnapshotRevision, ...interactiveCanvasProps } = canvasProps as {
      workspaceSnapshotRevision?: number
      [key: string]: unknown
    }
    // Subscribe to runtime changes for re-rendering when runtimes are added/removed
    const hotRuntimeIds = useSyncExternalStore(
      subscribeToRuntimeChanges,
      getRuntimeSnapshot,
      getRuntimeSnapshot, // SSR snapshot
    )

    // Get full runtime info for rendering
    const hotRuntimes = useMemo(() => getHotRuntimesInfo(), [hotRuntimeIds])

    // FIX 11: Track which workspaces have been rendered to keep them alive
    // Once a canvas is mounted, we keep it mounted even if openNotes temporarily drops to 0.
    // This is critical for Phase 2 hot switching - canvases should be hidden, not unmounted.
    const everRenderedWorkspacesRef = useRef<Set<string>>(new Set())

    // Determine which canvases to render
    // Filter behavior depends on whether the parent entry is active or hidden:
    // - Entry ACTIVE: Render all workspaces (user can interact with any of them)
    // - Entry HIDDEN: Only render PINNED workspaces (save resources, stop non-pinned timers)
    const canvasesToRender = useMemo(() => {
      // FIX: Create pinnedSet INSIDE the memo to ensure it's always fresh.
      // Previously, pinnedSet was a separate useMemo that could become stale due to
      // React's batching behavior when isEntryActive changes. This caused pinned
      // workspaces to be incorrectly classified as "not_pinned" when switching entries.
      const pinnedSet = new Set(pinnedWorkspaceIds ?? [])

      debugLog({
        component: "MultiWorkspaceCanvas",
        action: "filter_inputs",
        metadata: {
          isEntryActive,
          activeWorkspaceId,
          pinnedWorkspaceIds: pinnedWorkspaceIds ?? [],
          pinnedSetSize: pinnedSet.size,
          pinnedSetContents: Array.from(pinnedSet),
          hotRuntimesCount: hotRuntimes.length,
          hotRuntimeIds: hotRuntimes.map(r => r.workspaceId),
          everRenderedWorkspaces: Array.from(everRenderedWorkspacesRef.current),
        },
      })

      const result = hotRuntimes
        .filter((runtime) => {
          const hasNotes = runtime.openNotes.length > 0
          const isActiveWorkspace = runtime.workspaceId === activeWorkspaceId
          const isPinned = pinnedSet.has(runtime.workspaceId)
          const wasRenderedBefore = everRenderedWorkspacesRef.current.has(runtime.workspaceId)

          let shouldRender: boolean
          let reason: string

          if (isEntryActive) {
            // Entry is ACTIVE: Original behavior - render all interactive workspaces
            // User can interact with any workspace, even empty ones
            shouldRender = hasNotes || wasRenderedBefore || isActiveWorkspace
            reason = hasNotes ? "has_notes" : wasRenderedBefore ? "previously_rendered" : isActiveWorkspace ? "is_active" : "no_match"
          } else {
            // Entry is HIDDEN: Only keep pinned workspaces running
            // Non-pinned workspaces will unmount, stopping their background operations
            shouldRender = isPinned && (wasRenderedBefore || hasNotes)
            reason = shouldRender ? "pinned_and_has_content" : isPinned ? "pinned_but_no_content" : "not_pinned"
          }

          debugLog({
            component: "MultiWorkspaceCanvas",
            action: "filter_decision",
            metadata: {
              workspaceId: runtime.workspaceId,
              isEntryActive,
              hasNotes,
              isActiveWorkspace,
              isPinned,
              wasRenderedBefore,
              shouldRender,
              reason,
            },
          })

          return shouldRender
        })
        .map((runtime) => ({
          ...runtime,
          isActive: runtime.workspaceId === activeWorkspaceId,
        }))

      debugLog({
        component: "MultiWorkspaceCanvas",
        action: "filter_result",
        metadata: {
          isEntryActive,
          inputCount: hotRuntimes.length,
          outputCount: result.length,
          renderedWorkspaceIds: result.map(r => r.workspaceId),
        },
      })

      return result
    }, [hotRuntimes, activeWorkspaceId, isEntryActive, pinnedWorkspaceIds])

    // Track newly rendered workspaces (update ref after render completes)
    useEffect(() => {
      canvasesToRender.forEach((runtime) => {
        if (!everRenderedWorkspacesRef.current.has(runtime.workspaceId)) {
          debugLog({
            component: "MultiWorkspaceCanvas",
            action: "tracking_new_canvas",
            metadata: {
              workspaceId: runtime.workspaceId,
              openNotesCount: runtime.openNotes.length,
              totalTracked: everRenderedWorkspacesRef.current.size + 1,
            },
          })
          everRenderedWorkspacesRef.current.add(runtime.workspaceId)
        }
      })
    }, [canvasesToRender])

    // Keep refs to all canvas instances - stable Map that persists across renders
    const canvasRefsMap = useRef<Map<string, MutableRefObject<any>>>(new Map())

    // Lazy getter for canvas refs - creates on-demand during render (idempotent, safe in concurrent mode)
    // This avoids mutating the Map in a forEach during render which can cause React fiber issues
    const getOrCreateCanvasRef = useCallback((workspaceId: string): MutableRefObject<any> => {
      let ref = canvasRefsMap.current.get(workspaceId)
      if (!ref) {
        ref = { current: null }
        canvasRefsMap.current.set(workspaceId, ref)
      }
      return ref
    }, [])

    // Clean up refs for removed runtimes - do this in useEffect AFTER render, not during
    // This prevents React fiber corruption from mutations during render phase
    useEffect(() => {
      const activeIds = new Set(canvasesToRender.map((r) => r.workspaceId))
      canvasRefsMap.current.forEach((_, id) => {
        if (!activeIds.has(id)) {
          canvasRefsMap.current.delete(id)
        }
      })
    }, [canvasesToRender])

    // Forward ref to the active canvas
    useImperativeHandle(
      ref,
      () => {
        if (!activeWorkspaceId) return null
        const activeCanvasRef = canvasRefsMap.current.get(activeWorkspaceId)
        return activeCanvasRef?.current ?? null
      },
      [activeWorkspaceId, hotRuntimeIds], // Re-compute when active changes or runtimes change
    )

    // Notify visibility changes
    const prevActiveRef = useRef<string | null>(null)
    useEffect(() => {
      if (prevActiveRef.current !== activeWorkspaceId) {
        if (prevActiveRef.current && onWorkspaceHidden) {
          onWorkspaceHidden(prevActiveRef.current)
        }
        if (activeWorkspaceId && onWorkspaceVisible) {
          onWorkspaceVisible(activeWorkspaceId)
        }
        prevActiveRef.current = activeWorkspaceId
      }
    }, [activeWorkspaceId, onWorkspaceVisible, onWorkspaceHidden])

    return (
      <div
        className="multi-workspace-canvas-container"
        style={{
          position: "relative",
          width: "100%",
          height: "100%",
        }}
      >
        {canvasesToRender.map((runtime) => {
          const canvasRef = getOrCreateCanvasRef(runtime.workspaceId)
          return (
            <div
              key={runtime.workspaceId}
              className="workspace-canvas-wrapper"
              data-workspace-id={runtime.workspaceId}
              data-visible={runtime.isActive}
              style={{
                position: "absolute",
                inset: 0,
                visibility: runtime.isActive ? "visible" : "hidden",
                // Prevent hidden canvases from receiving pointer events
                pointerEvents: runtime.isActive ? "auto" : "none",
              }}
            >
              <AnnotationWorkspaceCanvas
                ref={canvasRef}
                workspaceId={runtime.workspaceId}
                noteIds={runtime.openNotes.map((n) => n.noteId)}
                primaryNoteId={runtime.openNotes[0]?.noteId ?? null}
                // FIX 10: Always pass workspaceSnapshotRevision to ALL canvases
                // This prevents the revision from jumping 0 → N when a hidden canvas becomes active
                workspaceSnapshotRevision={workspaceSnapshotRevision}
                // FIX: Pass isCanvasHidden to pause hydration for hidden canvases
                // This prevents infinite fetch loops when a pinned entry is hidden
                isCanvasHidden={!runtime.isActive}
                // Only pass interactive props and children to the visible canvas
                {...(runtime.isActive
                  ? { ...interactiveCanvasProps, children }
                  : {
                      // Hidden canvases get minimal props - no event handlers or children
                      onCanvasStateChange: undefined,
                      onConsumeFreshNoteSeed: undefined,
                      onFreshNoteHydrated: undefined,
                      onMainOnlyLayoutHandled: undefined,
                      onToggleAddComponentMenu: undefined,
                      onRegisterActiveEditor: undefined,
                      onSnapshotLoadComplete: undefined,
                      onSnapshotSettled: undefined,
                      onComponentChange: undefined,
                    })}
              />
            </div>
          )
        })}
      </div>
    )
  },
)

export default MultiWorkspaceCanvasContainer
