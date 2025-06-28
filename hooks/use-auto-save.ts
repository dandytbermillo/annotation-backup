"use client"

import { useEffect, type RefObject } from "react"
import { useCanvas } from "@/components/canvas/canvas-context"

export function useAutoSave(panelId: string, contentRef: RefObject<HTMLDivElement>) {
  const { dataStore } = useCanvas()

  useEffect(() => {
    const content = contentRef.current
    if (!content || !content.hasAttribute("contenteditable")) return

    let saveTimeout: NodeJS.Timeout

    const handleInput = () => {
      const indicator = document.getElementById(`auto-save-${panelId}`)
      if (indicator) {
        indicator.textContent = "Saving..."
        indicator.classList.add("!bg-yellow-500", "!text-gray-800")
        indicator.classList.remove("!bg-green-500")
        indicator.style.opacity = "1"
      }

      clearTimeout(saveTimeout)
      saveTimeout = setTimeout(() => {
        // Update content in data store
        dataStore.update(panelId, { content: content.innerHTML })

        if (indicator) {
          indicator.textContent = "Saved"
          indicator.classList.remove("!bg-yellow-500", "!text-gray-800")
          indicator.classList.add("!bg-green-500")

          setTimeout(() => {
            indicator.style.opacity = "0"
            setTimeout(() => (indicator.style.opacity = "1"), 2000)
          }, 1500)
        }
      }, 500)
    }

    content.addEventListener("input", handleInput)

    return () => {
      content.removeEventListener("input", handleInput)
      clearTimeout(saveTimeout)
    }
  }, [panelId, dataStore, contentRef])
}
