"use client"

import { useCallback, useRef } from "react"

type SelectionGuardsState = {
  onSelectStart: (event: Event) => void
  onDragStart: (event: Event) => void
  prevUserSelect: string
}

export function useSelectionGuards() {
  const selectionGuardsRef = useRef<SelectionGuardsState | null>(null)

  const enableSelectionGuards = useCallback(() => {
    if (typeof document === "undefined") return
    if (selectionGuardsRef.current) return

    const onSelectStart = (event: Event) => {
      event.preventDefault()
    }
    const onDragStart = (event: Event) => {
      event.preventDefault()
    }

    selectionGuardsRef.current = {
      onSelectStart,
      onDragStart,
      prevUserSelect: document.body.style.userSelect,
    }

    document.documentElement.classList.add("dragging-no-select")
    document.body.style.userSelect = "none"
    document.addEventListener("selectstart", onSelectStart, true)
    document.addEventListener("dragstart", onDragStart, true)

    try {
      window.getSelection()?.removeAllRanges?.()
    } catch {
      // ignore selection clearing issues
    }
  }, [])

  const disableSelectionGuards = useCallback(() => {
    if (typeof document === "undefined") return
    const guards = selectionGuardsRef.current
    if (!guards) return

    document.removeEventListener("selectstart", guards.onSelectStart, true)
    document.removeEventListener("dragstart", guards.onDragStart, true)
    document.documentElement.classList.remove("dragging-no-select")
    document.body.style.userSelect = guards.prevUserSelect || ""
    selectionGuardsRef.current = null
  }, [])

  return { enableSelectionGuards, disableSelectionGuards }
}
