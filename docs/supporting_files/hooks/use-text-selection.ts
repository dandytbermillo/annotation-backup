"use client"

import { useEffect, type RefObject } from "react"
import { useCanvas } from "@/components/canvas/canvas-context"

export function useTextSelection(contentRef: RefObject<HTMLDivElement>, panelId: string) {
  const { dispatch } = useCanvas()

  useEffect(() => {
    const content = contentRef.current
    if (!content) return

    const handleMouseUp = (e: MouseEvent) => {
      const selection = window.getSelection()
      const selectedText = selection?.toString().trim() || ""

      if (selectedText.length > 0 && selection) {
        dispatch({
          type: "SET_SELECTION",
          payload: {
            text: selectedText,
            range: selection.getRangeAt(0),
            panel: panelId,
          },
        })

        // Position and show annotation toolbar
        const toolbar = document.getElementById("annotation-toolbar")
        if (toolbar) {
          toolbar.style.left = e.pageX + "px"
          toolbar.style.top = e.pageY - 80 + "px"
          toolbar.classList.add("visible")
        }
      } else {
        dispatch({
          type: "SET_SELECTION",
          payload: {
            text: "",
            range: null,
            panel: null,
          },
        })

        // Hide annotation toolbar
        const toolbar = document.getElementById("annotation-toolbar")
        if (toolbar) {
          toolbar.classList.remove("visible")
        }
      }
    }

    content.addEventListener("mouseup", handleMouseUp)

    return () => {
      content.removeEventListener("mouseup", handleMouseUp)
    }
  }, [panelId, dispatch, contentRef])
}

