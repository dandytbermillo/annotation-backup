import { useCallback, useEffect, useRef, useState } from "react"
import { PREVIEW_HOVER_DELAY_MS } from "@/lib/constants/ui-timings"
import { buildMultilinePreview } from "@/lib/utils/branch-preview"

type PreviewPosition = { x: number; y: number }

interface FetchNoteResult {
  content?: string | null
  contentText?: string | null
}

export interface NotePreviewState<TContext = unknown> {
  noteId: string
  content: string
  position: PreviewPosition
  context?: TContext
}

interface UseNotePreviewHoverOptions<TContext = unknown> {
  fetchNote: (noteId: string) => Promise<FetchNoteResult>
  delayMs?: number
  closeDelayMs?: number
  formatContent?: (payload: FetchNoteResult) => string
  onTooltipEnter?: (context?: TContext) => void
  onTooltipLeave?: (context?: TContext) => void
}

interface UseNotePreviewHoverResult<TContext = unknown> {
  preview: NotePreviewState<TContext> | null
  isLoading: boolean
  handleHover: (
    noteId: string,
    getPosition: () => PreviewPosition,
    context?: TContext
  ) => void
  handleLeave: () => void
  handleTooltipEnter: () => void
  handleTooltipLeave: () => void
  cancelPreview: () => void
}

export function useNotePreviewHover<TContext = unknown>({
  fetchNote,
  delayMs = 500,
  closeDelayMs = PREVIEW_HOVER_DELAY_MS,
  formatContent = ({ content, contentText }) =>
    buildMultilinePreview(content, contentText || "", Number.MAX_SAFE_INTEGER),
  onTooltipEnter,
  onTooltipLeave,
}: UseNotePreviewHoverOptions<TContext>): UseNotePreviewHoverResult<TContext> {
  const [preview, setPreview] = useState<NotePreviewState<TContext> | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const hoverTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const closeTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const hoveringTooltipRef = useRef(false)

  const clearHoverTimeout = useCallback(() => {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current)
      hoverTimeoutRef.current = null
    }
  }, [])

  const clearCloseTimeout = useCallback(() => {
    if (closeTimeoutRef.current) {
      clearTimeout(closeTimeoutRef.current)
      closeTimeoutRef.current = null
    }
  }, [])

  const cancelPreview = useCallback(() => {
    clearHoverTimeout()
    clearCloseTimeout()
    setPreview(null)
    setIsLoading(false)
    hoveringTooltipRef.current = false
  }, [clearHoverTimeout, clearCloseTimeout])

  useEffect(() => cancelPreview, [cancelPreview])

  const handleHover = useCallback(
    (noteId: string, getPosition: () => PreviewPosition, context?: TContext) => {
      clearHoverTimeout()
      clearCloseTimeout()
      hoveringTooltipRef.current = false

      const position = getPosition()

      hoverTimeoutRef.current = setTimeout(async () => {
        setIsLoading(true)
        try {
          const data = await fetchNote(noteId)
          const previewText = formatContent(data)
          setPreview({
            noteId,
            content: previewText || "No content yet",
            position,
            context,
          })
        } catch (error) {
          console.error("[useNotePreviewHover] Failed to fetch note preview:", error)
        } finally {
          setIsLoading(false)
        }
      }, delayMs)
    },
    [clearHoverTimeout, clearCloseTimeout, delayMs, fetchNote, formatContent]
  )

  const handleLeave = useCallback(() => {
    clearHoverTimeout()
    clearCloseTimeout()
    closeTimeoutRef.current = setTimeout(() => {
      if (!hoveringTooltipRef.current) {
        setPreview(null)
      }
    }, closeDelayMs)
  }, [clearCloseTimeout, clearHoverTimeout, closeDelayMs])

  const handleTooltipEnter = useCallback(() => {
    hoveringTooltipRef.current = true
    clearCloseTimeout()
    if (preview?.context && onTooltipEnter) {
      onTooltipEnter(preview.context)
    }
  }, [clearCloseTimeout, onTooltipEnter, preview])

  const handleTooltipLeave = useCallback(() => {
    hoveringTooltipRef.current = false
    if (preview?.context && onTooltipLeave) {
      onTooltipLeave(preview.context)
    }
    closeTimeoutRef.current = setTimeout(() => {
      setPreview(null)
    }, closeDelayMs)
  }, [closeDelayMs, onTooltipLeave, preview])

  return {
    preview,
    isLoading,
    handleHover,
    handleLeave,
    handleTooltipEnter,
    handleTooltipLeave,
    cancelPreview,
  }
}
