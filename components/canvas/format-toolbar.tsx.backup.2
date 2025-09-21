"use client"

import { useState, useRef, useEffect } from "react"
import type { TiptapEditorPlainHandle } from "./tiptap-editor-plain"
import type { TiptapEditorHandle } from "./tiptap-editor-collab"

type UnifiedEditorHandle = TiptapEditorHandle | TiptapEditorPlainHandle

interface FormatToolbarProps {
  editorRef: React.RefObject<UnifiedEditorHandle | null>
  panelId: string
}

export function FormatToolbar({ editorRef, panelId }: FormatToolbarProps) {
  const [isVisible, setIsVisible] = useState(false)
  const timeoutRef = useRef<NodeJS.Timeout>()

  const executeCommand = (command: string, value?: any) => {
    if (!editorRef.current) return
    editorRef.current.executeCommand(command, value)
  }

  const handleMouseEnter = () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
    }
    setIsVisible(true)
  }

  const handleMouseLeave = () => {
    timeoutRef.current = setTimeout(() => {
      setIsVisible(false)
    }, 300)
  }

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }
    }
  }, [])

  return (
    <div 
      className="format-toolbar-container" 
      style={{ position: "relative", display: "inline-block" }}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <button
        className="format-toolbar-trigger"
        onClick={() => setIsVisible(!isVisible)}
        title="Text Formatting"
        style={{
          background: "rgba(255,255,255,0.2)",
          border: "none",
          borderRadius: "4px",
          padding: "4px 8px",
          cursor: "pointer",
          fontSize: "11px",
          color: "white",
          transition: "all 0.2s ease",
          display: "flex",
          alignItems: "center",
          gap: "4px",
          height: "24px",
        }}
        onMouseOver={(e) => {
          e.currentTarget.style.background = "rgba(255,255,255,0.3)"
        }}
        onMouseOut={(e) => {
          e.currentTarget.style.background = "rgba(255,255,255,0.2)"
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
        </svg>
        <span>Format</span>
      </button>

      {isVisible && (
        <div
          className="format-toolbar-dropdown"
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            right: "0",
            background: "#e8eaed",
            border: "1px solid #dadce0",
            borderRadius: "12px",
            padding: "8px",
            boxShadow: "0 2px 10px rgba(0,0,0,0.2)",
            zIndex: 1000,
            display: "grid",
            gridTemplateColumns: "repeat(5, 1fr)",
            gap: "6px",
            minWidth: "250px",
          }}
        >
          {/* First row */}
          <button
            onClick={() => { executeCommand("bold"); setIsVisible(false) }}
            title="Bold"
            style={{
              background: "white",
              border: "1px solid #dadce0",
              borderRadius: "8px",
              width: "42px",
              height: "42px",
              cursor: "pointer",
              transition: "all 0.15s ease",
              fontSize: "16px",
              fontWeight: "bold",
              color: "#202124",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "#f1f3f4"
              e.currentTarget.style.borderColor = "#5f6368"
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "white"
              e.currentTarget.style.borderColor = "#dadce0"
            }}
          >
            B
          </button>
          
          <button
            onClick={() => { executeCommand("italic"); setIsVisible(false) }}
            title="Italic"
            style={{
              background: "white",
              border: "1px solid #dadce0",
              borderRadius: "8px",
              width: "42px",
              height: "42px",
              cursor: "pointer",
              transition: "all 0.15s ease",
              fontSize: "16px",
              fontStyle: "italic",
              fontFamily: "serif",
              color: "#202124",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "#f1f3f4"
              e.currentTarget.style.borderColor = "#5f6368"
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "white"
              e.currentTarget.style.borderColor = "#dadce0"
            }}
          >
            I
          </button>

          <button
            onClick={() => { executeCommand("underline"); setIsVisible(false) }}
            title="Underline"
            style={{
              background: "white",
              border: "1px solid #dadce0",
              borderRadius: "8px",
              width: "42px",
              height: "42px",
              cursor: "pointer",
              transition: "all 0.15s ease",
              fontSize: "16px",
              textDecoration: "underline",
              color: "#202124",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "#f1f3f4"
              e.currentTarget.style.borderColor = "#5f6368"
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "white"
              e.currentTarget.style.borderColor = "#dadce0"
            }}
          >
            U
          </button>

          <button
            onClick={() => { executeCommand("heading", 2); setIsVisible(false) }}
            title="Heading 2"
            style={{
              background: "white",
              border: "1px solid #dadce0",
              borderRadius: "8px",
              width: "42px",
              height: "42px",
              cursor: "pointer",
              transition: "all 0.15s ease",
              fontSize: "14px",
              fontWeight: "600",
              color: "#202124",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "#f1f3f4"
              e.currentTarget.style.borderColor = "#5f6368"
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "white"
              e.currentTarget.style.borderColor = "#dadce0"
            }}
          >
            H2
          </button>

          <button
            onClick={() => { executeCommand("heading", 3); setIsVisible(false) }}
            title="Heading 3"
            style={{
              background: "white",
              border: "1px solid #dadce0",
              borderRadius: "8px",
              width: "42px",
              height: "42px",
              cursor: "pointer",
              transition: "all 0.15s ease",
              fontSize: "14px",
              fontWeight: "600",
              color: "#202124",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "#f1f3f4"
              e.currentTarget.style.borderColor = "#5f6368"
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "white"
              e.currentTarget.style.borderColor = "#dadce0"
            }}
          >
            H3
          </button>

          {/* Second row */}
          <button
            onClick={() => { executeCommand("bulletList"); setIsVisible(false) }}
            title="Bullet List"
            style={{
              background: "white",
              border: "1px solid #dadce0",
              borderRadius: "8px",
              width: "42px",
              height: "42px",
              cursor: "pointer",
              transition: "all 0.15s ease",
              fontSize: "20px",
              color: "#202124",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "#f1f3f4"
              e.currentTarget.style.borderColor = "#5f6368"
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "white"
              e.currentTarget.style.borderColor = "#dadce0"
            }}
          >
            •
          </button>

          <button
            onClick={() => { executeCommand("orderedList"); setIsVisible(false) }}
            title="Numbered List"
            style={{
              background: "white",
              border: "1px solid #dadce0",
              borderRadius: "8px",
              width: "42px",
              height: "42px",
              cursor: "pointer",
              transition: "all 0.15s ease",
              fontSize: "14px",
              color: "#202124",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "#f1f3f4"
              e.currentTarget.style.borderColor = "#5f6368"
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "white"
              e.currentTarget.style.borderColor = "#dadce0"
            }}
          >
            1.
          </button>

          <button
            onClick={() => { executeCommand("blockquote"); setIsVisible(false) }}
            title="Quote"
            style={{
              background: "white",
              border: "1px solid #dadce0",
              borderRadius: "8px",
              width: "42px",
              height: "42px",
              cursor: "pointer",
              transition: "all 0.15s ease",
              fontSize: "20px",
              fontWeight: "500",
              color: "#202124",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "#f1f3f4"
              e.currentTarget.style.borderColor = "#5f6368"
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "white"
              e.currentTarget.style.borderColor = "#dadce0"
            }}
          >
            "
          </button>

          <button
            onClick={() => { executeCommand("highlight"); setIsVisible(false) }}
            title="Highlight"
            style={{
              background: "white",
              border: "1px solid #dadce0",
              borderRadius: "8px",
              width: "42px",
              height: "42px",
              cursor: "pointer",
              transition: "all 0.15s ease",
              fontSize: "16px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "#f1f3f4"
              e.currentTarget.style.borderColor = "#5f6368"
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "white"
              e.currentTarget.style.borderColor = "#dadce0"
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ea4335" strokeWidth="2">
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
            </svg>
          </button>

          <div style={{ width: "42px" }}></div>

          {/* Third row - only Clear Format */}
          <button
            onClick={() => { executeCommand("removeFormat"); setIsVisible(false) }}
            title="Clear Format"
            style={{
              background: "white",
              border: "1px solid #dadce0",
              borderRadius: "8px",
              width: "42px",
              height: "42px",
              cursor: "pointer",
              transition: "all 0.15s ease",
              fontSize: "20px",
              color: "#202124",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "#f1f3f4"
              e.currentTarget.style.borderColor = "#5f6368"
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "white"
              e.currentTarget.style.borderColor = "#dadce0"
            }}
          >
            ✕
          </button>
        </div>
      )}
    </div>
  )
}