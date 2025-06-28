"use client"

import { type TiptapEditorHandle } from "./tiptap-editor"

interface EditorToolbarProps {
  panelId: string
  editorRef: React.RefObject<TiptapEditorHandle>
  isMainPanel?: boolean
  onToggleEditing?: () => void
}

export function EditorToolbar({ panelId, editorRef, isMainPanel, onToggleEditing }: EditorToolbarProps) {
  const executeCommand = (command: string, value?: any) => {
    editorRef.current?.executeCommand(command, value)
  }

  return (
    <div 
      className="rich-toolbar"
      id={`toolbar-${panelId}`}
      style={{
        display: "flex",
        gap: "8px",
        marginBottom: "16px",
        padding: "12px",
        background: "linear-gradient(135deg, #f5f7fa 0%, #e9ecef 100%)",
        borderRadius: "12px",
        boxShadow: "0 2px 8px rgba(0,0,0,0.1)",
        alignItems: "center",
        flexWrap: "wrap",
      }}
    >
      <button
        className="toolbar-btn"
        onClick={() => executeCommand('bold')}
        title="Bold"
        style={{
          background: "white",
          border: "1px solid #dee2e6",
          borderRadius: "8px",
          padding: "8px 12px",
          cursor: "pointer",
          transition: "all 0.2s ease",
          fontWeight: "700",
          fontSize: "14px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          minWidth: "36px",
          height: "36px",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = "#667eea"
          e.currentTarget.style.color = "white"
          e.currentTarget.style.transform = "translateY(-1px)"
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = "white"
          e.currentTarget.style.color = "inherit"
          e.currentTarget.style.transform = "translateY(0)"
        }}
      >
        <strong>B</strong>
      </button>

      <button
        className="toolbar-btn"
        onClick={() => executeCommand('italic')}
        title="Italic"
        style={{
          background: "white",
          border: "1px solid #dee2e6",
          borderRadius: "8px",
          padding: "8px 12px",
          cursor: "pointer",
          transition: "all 0.2s ease",
          fontStyle: "italic",
          fontSize: "14px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          minWidth: "36px",
          height: "36px",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = "#667eea"
          e.currentTarget.style.color = "white"
          e.currentTarget.style.transform = "translateY(-1px)"
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = "white"
          e.currentTarget.style.color = "inherit"
          e.currentTarget.style.transform = "translateY(0)"
        }}
      >
        <em>I</em>
      </button>

      <button
        className="toolbar-btn"
        onClick={() => executeCommand('underline')}
        title="Underline"
        style={{
          background: "white",
          border: "1px solid #dee2e6",
          borderRadius: "8px",
          padding: "8px 12px",
          cursor: "pointer",
          transition: "all 0.2s ease",
          textDecoration: "underline",
          fontSize: "14px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          minWidth: "36px",
          height: "36px",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = "#667eea"
          e.currentTarget.style.color = "white"
          e.currentTarget.style.transform = "translateY(-1px)"
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = "white"
          e.currentTarget.style.color = "inherit"
          e.currentTarget.style.transform = "translateY(0)"
        }}
      >
        <u>U</u>
      </button>

      <div style={{ width: "1px", height: "24px", background: "#dee2e6", margin: "0 4px" }} />

      <button
        className="toolbar-btn"
        onClick={() => executeCommand('heading', 2)}
        title="Heading 2"
        style={{
          background: "white",
          border: "1px solid #dee2e6",
          borderRadius: "8px",
          padding: "8px 12px",
          cursor: "pointer",
          transition: "all 0.2s ease",
          fontWeight: "600",
          fontSize: "14px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          minWidth: "36px",
          height: "36px",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = "#667eea"
          e.currentTarget.style.color = "white"
          e.currentTarget.style.transform = "translateY(-1px)"
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = "white"
          e.currentTarget.style.color = "inherit"
          e.currentTarget.style.transform = "translateY(0)"
        }}
      >
        H2
      </button>

      <button
        className="toolbar-btn"
        onClick={() => executeCommand('heading', 3)}
        title="Heading 3"
        style={{
          background: "white",
          border: "1px solid #dee2e6",
          borderRadius: "8px",
          padding: "8px 12px",
          cursor: "pointer",
          transition: "all 0.2s ease",
          fontWeight: "600",
          fontSize: "14px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          minWidth: "36px",
          height: "36px",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = "#667eea"
          e.currentTarget.style.color = "white"
          e.currentTarget.style.transform = "translateY(-1px)"
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = "white"
          e.currentTarget.style.color = "inherit"
          e.currentTarget.style.transform = "translateY(0)"
        }}
      >
        H3
      </button>

      <div style={{ width: "1px", height: "24px", background: "#dee2e6", margin: "0 4px" }} />

      <button
        className="toolbar-btn"
        onClick={() => executeCommand('bulletList')}
        title="Bullet List"
        style={{
          background: "white",
          border: "1px solid #dee2e6",
          borderRadius: "8px",
          padding: "8px 12px",
          cursor: "pointer",
          transition: "all 0.2s ease",
          fontSize: "14px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          minWidth: "36px",
          height: "36px",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = "#667eea"
          e.currentTarget.style.color = "white"
          e.currentTarget.style.transform = "translateY(-1px)"
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = "white"
          e.currentTarget.style.color = "inherit"
          e.currentTarget.style.transform = "translateY(0)"
        }}
      >
        •
      </button>

      <button
        className="toolbar-btn"
        onClick={() => executeCommand('orderedList')}
        title="Numbered List"
        style={{
          background: "white",
          border: "1px solid #dee2e6",
          borderRadius: "8px",
          padding: "8px 12px",
          cursor: "pointer",
          transition: "all 0.2s ease",
          fontSize: "14px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          minWidth: "36px",
          height: "36px",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = "#667eea"
          e.currentTarget.style.color = "white"
          e.currentTarget.style.transform = "translateY(-1px)"
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = "white"
          e.currentTarget.style.color = "inherit"
          e.currentTarget.style.transform = "translateY(0)"
        }}
      >
        1.
      </button>

      <button
        className="toolbar-btn"
        onClick={() => executeCommand('blockquote')}
        title="Quote"
        style={{
          background: "white",
          border: "1px solid #dee2e6",
          borderRadius: "8px",
          padding: "8px 12px",
          cursor: "pointer",
          transition: "all 0.2s ease",
          fontSize: "14px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          minWidth: "36px",
          height: "36px",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = "#667eea"
          e.currentTarget.style.color = "white"
          e.currentTarget.style.transform = "translateY(-1px)"
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = "white"
          e.currentTarget.style.color = "inherit"
          e.currentTarget.style.transform = "translateY(0)"
        }}
      >
        "
      </button>

      <div style={{ width: "1px", height: "24px", background: "#dee2e6", margin: "0 4px" }} />

      <button
        className="toolbar-btn"
        onClick={() => executeCommand('highlight')}
        title="Highlight"
        style={{
          background: "white",
          border: "1px solid #dee2e6",
          borderRadius: "8px",
          padding: "8px 12px",
          cursor: "pointer",
          transition: "all 0.2s ease",
          fontSize: "14px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          minWidth: "36px",
          height: "36px",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = "#ffeaa7"
          e.currentTarget.style.color = "#2d3436"
          e.currentTarget.style.transform = "translateY(-1px)"
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = "white"
          e.currentTarget.style.color = "inherit"
          e.currentTarget.style.transform = "translateY(0)"
        }}
      >
        🖍️
      </button>

      <button
        className="toolbar-btn"
        onClick={() => executeCommand('removeFormat')}
        title="Clear Format"
        style={{
          background: "white",
          border: "1px solid #dee2e6",
          borderRadius: "8px",
          padding: "8px 12px",
          cursor: "pointer",
          transition: "all 0.2s ease",
          fontSize: "14px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          minWidth: "36px",
          height: "36px",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = "#e74c3c"
          e.currentTarget.style.color = "white"
          e.currentTarget.style.transform = "translateY(-1px)"
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = "white"
          e.currentTarget.style.color = "inherit"
          e.currentTarget.style.transform = "translateY(0)"
        }}
      >
        ✕
      </button>

      {isMainPanel && (
        <>
          <div style={{ marginLeft: "auto" }} />
          <button
            className="toolbar-btn special"
            onClick={onToggleEditing}
            title="Toggle Editing"
            style={{
              background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
              color: "white",
              border: "none",
              borderRadius: "8px",
              padding: "8px 16px",
              cursor: "pointer",
              transition: "all 0.2s ease",
              fontWeight: "600",
              fontSize: "14px",
              display: "flex",
              alignItems: "center",
              gap: "6px",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = "translateY(-1px)"
              e.currentTarget.style.boxShadow = "0 4px 12px rgba(102, 126, 234, 0.3)"
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = "translateY(0)"
              e.currentTarget.style.boxShadow = "none"
            }}
          >
            📝 Edit
          </button>
        </>
      )}
    </div>
  )
} 