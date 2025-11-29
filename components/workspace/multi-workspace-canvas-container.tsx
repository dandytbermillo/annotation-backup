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
      onWorkspaceVisible,
      onWorkspaceHidden,
      children,
      // All other props are passed to the visible canvas
      ...canvasProps
    },
    ref,
  ) {
    // Subscribe to runtime changes for re-rendering when runtimes are added/removed
    const hotRuntimeIds = useSyncExternalStore(
      subscribeToRuntimeChanges,
      getRuntimeSnapshot,
      getRuntimeSnapshot, // SSR snapshot
    )

    // Get full runtime info for rendering
    const hotRuntimes = useMemo(() => getHotRuntimesInfo(), [hotRuntimeIds])

    // Determine which canvases to render
    // IMPORTANT: Only render canvases that have at least one note.
    // This prevents the hook order violation in ModernAnnotationCanvasInner:
    // - If canvas renders with empty noteIds, it returns null before hooks run
    // - When notes sync in, hooks run, causing "Expected static flag was missing" error
    // TODO: To truly keep components alive during workspace switches, we need to refactor
    // ModernAnnotationCanvasInner to handle empty noteIds gracefully (run all hooks unconditionally).
    const canvasesToRender = useMemo(() => {
      return hotRuntimes
        .filter((runtime) => runtime.openNotes.length > 0)
        .map((runtime) => ({
          ...runtime,
          isActive: runtime.workspaceId === activeWorkspaceId,
        }))
    }, [hotRuntimes, activeWorkspaceId])

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
                // Only pass interactive props and children to the visible canvas
                {...(runtime.isActive
                  ? { ...canvasProps, children }
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
