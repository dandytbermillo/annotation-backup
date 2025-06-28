"use client"

import { useState } from "react"

export function AnnotationPopup() {
  const [isVisible, setIsVisible] = useState(false)
  const [position, setPosition] = useState({ x: 0, y: 0 })
  const [content, setContent] = useState({ title: "", text: "" })

  return (
    <div
      className={`popup fixed bg-black/90 backdrop-blur-xl text-white rounded-lg p-4 shadow-2xl z-[2000] max-w-80 border border-white/20 transition-all duration-300 ${
        isVisible ? "block opacity-100 scale-100" : "hidden opacity-0 scale-95"
      }`}
      style={{
        left: position.x + "px",
        top: position.y + "px",
      }}
    >
      <div className="popup-title font-semibold mb-2 text-white">{content.title}</div>
      <div className="popup-text text-xs leading-relaxed text-white/90">{content.text}</div>
    </div>
  )
}
