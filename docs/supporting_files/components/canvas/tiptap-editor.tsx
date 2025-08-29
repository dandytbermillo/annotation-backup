"use client"

import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Highlight from '@tiptap/extension-highlight'
import Underline from '@tiptap/extension-underline'
import Placeholder from '@tiptap/extension-placeholder'
import Collaboration from '@tiptap/extension-collaboration'
import CollaborationCursor from '@tiptap/extension-collaboration-cursor'
import { useEffect, useImperativeHandle, forwardRef } from 'react'
import * as Y from 'yjs'
import { IndexeddbPersistence } from 'y-indexeddb'
import { WebsocketProvider } from 'y-websocket'
import { Mark, mergeAttributes } from '@tiptap/core'
import { AnnotationDecorations } from './annotation-decorations'
import { PerformanceMonitor } from './performance-decorations'
import { CollaborationProvider } from '@/lib/yjs-provider'

const Annotation = Mark.create({
  name: 'annotation',
  addOptions() { return { HTMLAttributes: {} } },
  addAttributes() {
    return {
      id: { default: null, parseHTML: e => e.getAttribute('data-annotation-id'), renderHTML: a => a.id ? { 'data-annotation-id': a.id } : {} },
      type: { default: null, parseHTML: e => e.getAttribute('data-type'), renderHTML: a => a.type ? { 'data-type': a.type } : {} },
      branchId: { default: null, parseHTML: e => e.getAttribute('data-branch'), renderHTML: a => a.branchId ? { 'data-branch': a.branchId } : {} },
      'data-branch': { default: null, parseHTML: e => e.getAttribute('data-branch'), renderHTML: a => a['data-branch'] ? { 'data-branch': a['data-branch'] } : {} },
    }
  },
  parseHTML() { return [{ tag: 'span[data-annotation-id]' }] },
  renderHTML({ HTMLAttributes, mark }) {
    const type = mark.attrs.type || 'note'
    const className = `annotation annotation-${type}`
    return ['span', mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, { class: className, style: 'cursor: pointer;' }), 0]
  },
})

interface TiptapEditorProps {
  content: string
  isEditable: boolean
  panelId: string
  onUpdate?: (html: string) => void
  onSelectionChange?: (text: string, range: Range | null) => void
  placeholder?: string
  ydoc?: Y.Doc
  provider?: WebsocketProvider | null
  onCreateAnnotation?: (type: string, selectedText: string) => { id: string; branchId: string } | null
}

export interface TiptapEditorHandle {
  getHTML: () => string
  focus: () => void
  setEditable: (editable: boolean) => void
  executeCommand: (command: string, value?: any) => void
  insertAnnotation: (type: string, annotationId: string, branchId: string) => void
}

const TiptapEditor = forwardRef<TiptapEditorHandle, TiptapEditorProps>(({
  content, isEditable, panelId, onUpdate, onSelectionChange, placeholder, ydoc, provider
}, ref) => {
  const doc = ydoc || new Y.Doc()

  useEffect(() => {
    if (!provider && !ydoc && typeof window !== 'undefined' && typeof indexedDB !== 'undefined') {
      const persistence = new IndexeddbPersistence(`annotation-${panelId}`, doc)
      return () => { persistence.destroy() }
    }
  }, [doc, panelId, provider, ydoc])

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ history: false }),
      Highlight,
      Underline,
      Annotation,
      Placeholder.configure({ placeholder: placeholder || 'Start typing...' }),
      ...(provider ? [
        Collaboration.configure({ document: doc }),
        CollaborationCursor.configure({ provider, user: { name: 'User', color: '#667eea' } }),
      ] : []),
    ],
    plugins: [AnnotationDecorations(), PerformanceMonitor()],
    content,
    editable: isEditable,
    onUpdate: ({ editor }) => { const html = editor.getHTML(); onUpdate?.(html) },
    onSelectionUpdate: ({ editor }) => {
      const { from, to } = editor.state.selection
      const text = editor.state.doc.textBetween(from, to, ' ')
      if (text.trim().length > 0 && onSelectionChange) {
        const view = editor.view
        const domRange = document.createRange()
        try {
          const start = view.domAtPos(from)
          const end = view.domAtPos(to)
          domRange.setStart(start.node, start.offset)
          domRange.setEnd(end.node, end.offset)
          onSelectionChange(text, domRange)
        } catch { onSelectionChange(text, null) }
      } else { onSelectionChange?.('', null) }
    },
    editorProps: {
      attributes: {
        class: 'prose prose-lg max-w-none focus:outline-none tiptap-editor',
        'data-panel': panelId,
        style: `background:#fafbfc;border:1px solid #e1e8ed;border-radius:8px;padding:20px;min-height:250px;font-family:'Georgia',serif;line-height:1.8;font-size:15px;color:#2c3e50;`,
      },
      handleClick: (view, pos, event) => {
        const target = event.target as HTMLElement
        if (target.classList.contains('annotation') || target.closest('.annotation')) {
          const annotationElement = target.classList.contains('annotation') ? target : target.closest('.annotation') as HTMLElement
          const branchId = annotationElement.getAttribute('data-branch') || annotationElement.getAttribute('data-branch-id')
          if (branchId) window.dispatchEvent(new CustomEvent('create-panel', { detail: { panelId: branchId } }))
          return true
        }
        return false
      },
    },
  })

  useEffect(() => { if (editor && editor.isEditable !== isEditable) editor.setEditable(isEditable) }, [editor, isEditable])
  useEffect(() => { if (editor && content !== editor.getHTML() && !editor.isFocused) editor.commands.setContent(content) }, [editor, content])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const style = document.createElement('style')
    style.textContent = `
      .tiptap-editor .annotation { background: linear-gradient(135deg, #ffeaa7 0%, #fab1a0 100%); padding: 2px 6px; border-radius: 4px; cursor: pointer; position: relative; transition: all 0.3s ease; font-weight: 600; border-bottom: 2px solid transparent; }
      .tiptap-editor .annotation:hover { transform: translateY(-1px); box-shadow: 0 4px 12px rgba(0,0,0,0.15); }
      .tiptap-editor .annotation.note { background: linear-gradient(135deg, #e3f2fd 0%, #bbdefb 100%); border-bottom-color: #2196f3; color: #1565c0; }
      .tiptap-editor .annotation.explore { background: linear-gradient(135deg, #fff3e0 0%, #ffcc80 100%); border-bottom-color: #ff9800; color: #ef6c00; }
      .tiptap-editor .annotation.promote { background: linear-gradient(135deg, #e8f5e8 0%, #c8e6c9 100%); border-bottom-color: #4caf50; color: #2e7d32; }
      .tiptap-editor .annotation-hover-target { position: relative; display: inline-block; overflow: hidden; }
      .tiptap-editor .annotation-hover-target.annotation-hovered { transform: translateY(-2px) scale(1.02); filter: brightness(1.1); z-index: 10; }
      .tiptap-editor .annotation-hover-target.annotation-clicked { animation: annotationClick 0.3s ease-out; }
      @keyframes annotationClick { 0%{transform:scale(1);}50%{transform:scale(0.95);}100%{transform:scale(1);} }
      .annotation-tooltip { position: absolute; background: rgba(0, 0, 0, 0.95); color: white; padding: 12px 16px; border-radius: 8px; box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3); z-index: 10000; max-width: 300px; opacity: 0; pointer-events: none; transition: opacity 0.2s ease, transform 0.2s ease; transform: translateY(5px); }
      .annotation-tooltip.visible { opacity: 1; transform: translateY(0); }
      .annotation-ripple { position: absolute; border-radius: 50%; background: rgba(255, 255, 255, 0.6); transform: scale(0); animation: ripple 0.6s ease-out; pointer-events: none; }
      @keyframes ripple { to { transform: scale(4); opacity: 0; } }
    `
    document.head.appendChild(style)
    return () => { document.head.removeChild(style) }
  }, [])

  useImperativeHandle(ref, () => ({
    getHTML: () => editor?.getHTML() || '',
    focus: () => { editor?.commands.focus() },
    setEditable: (editable: boolean) => { editor?.setEditable(editable) },
    executeCommand: (command: string, value?: any) => {
      if (!editor) return
      switch (command) {
        case 'bold': editor.chain().focus().toggleBold().run(); break
        case 'italic': editor.chain().focus().toggleItalic().run(); break
        case 'underline': editor.chain().focus().toggleUnderline().run(); break
        case 'heading': editor.chain().focus().toggleHeading({ level: value || 2 }).run(); break
        case 'bulletList': editor.chain().focus().toggleBulletList().run(); break
        case 'orderedList': editor.chain().focus().toggleOrderedList().run(); break
        case 'blockquote': editor.chain().focus().toggleBlockquote().run(); break
        case 'highlight': editor.chain().focus().toggleHighlight().run(); break
        case 'removeFormat': editor.chain().focus().clearNodes().unsetAllMarks().run(); break
      }
    },
    insertAnnotation: (type: string, annotationId: string, branchId: string) => {
      if (!editor) return
      const { from, to } = editor.state.selection
      if (from === to) return
      editor.chain().focus().setMark('annotation', { id: annotationId, type, branchId, 'data-branch': branchId }).run()
      const html = editor.getHTML(); onUpdate?.(html)
    }
  }), [editor, onUpdate])

  return (
    <div className="tiptap-editor-wrapper">
      <EditorContent editor={editor} />
    </div>
  )
})

TiptapEditor.displayName = 'TiptapEditor'
export default TiptapEditor

