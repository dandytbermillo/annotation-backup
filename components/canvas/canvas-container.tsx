"use client"

import { useRef } from "react"
import { useCanvas } from "./canvas-context"
import { Panel } from "./panel"
import { ConnectionsSvg } from "./connections-svg"
import { useCanvasEvents } from "@/hooks/use-canvas-events"

export function CanvasContainer() {
  const { state, dispatch } = useCanvas()
  const containerRef = useRef<HTMLDivElement>(null)

  useCanvasEvents(containerRef)

  const canvasStyle = {
    transform: `translate(${state.canvasState.translateX}px, ${state.canvasState.translateY}px) scale(${state.canvasState.zoom})`,
    transformOrigin: "0 0",
    transition: state.canvasState.isDragging ? "none" : "transform 0.3s ease-out",
  }

  return (
    <div
      ref={containerRef}
      className={`canvas-container ${state.canvasState.isDragging ? "dragging" : ""}`}
      style={{
        position: "relative",
        width: "100vw",
        height: "100vh",
        cursor: state.canvasState.isDragging ? "grabbing" : "grab",
        overflow: "hidden",
      }}
    >
      <div
        className="infinite-canvas"
        style={{
          position: "absolute",
          width: "8000px",
          height: "4000px",
          ...canvasStyle,
        }}
      >
        {/* Canvas Grid */}
        <div
          className="canvas-grid"
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
            opacity: 0.02,
            backgroundImage: `
              linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px),
              linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)
            `,
            backgroundSize: "40px 40px",
          }}
        />

        <ConnectionsSvg />

        {/* Render Panels */}
        {Array.from(state.panels.entries()).map(([panelId, panelData]) => (
          <Panel key={panelId} panelId={panelId} panelData={panelData} />
        ))}
      </div>
    </div>
  )
}
