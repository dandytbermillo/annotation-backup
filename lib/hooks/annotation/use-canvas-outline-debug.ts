"use client"

import { useEffect } from "react"

import { debugLog } from "@/lib/utils/debug-logger"

export function useCanvasOutlineDebug() {
  useEffect(() => {
    debugLog({
      component: "AnnotationApp",
      action: "canvas_outline_applied",
      metadata: {
        outline: "rgba(99, 102, 241, 0.85) solid 4px",
        outlineOffset: "6px",
      },
    })
  }, [])
}
