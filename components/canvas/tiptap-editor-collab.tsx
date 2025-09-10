"use client"

import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Highlight from '@tiptap/extension-highlight'
import Underline from '@tiptap/extension-underline'
import Placeholder from '@tiptap/extension-placeholder'
import Collaboration from '@tiptap/extension-collaboration'
import CollaborationCursor from '@tiptap/extension-collaboration-cursor'
import { useEffect, useImperativeHandle, forwardRef } from 'react'
import type * as Y from 'yjs'
import { Mark, mergeAttributes } from '@tiptap/core'
import { AnnotationDecorations } from './annotation-decorations'
import { PerformanceMonitor } from './performance-decorations'
import { ClearStoredMarksAtBoundary } from './clear-stored-marks-plugin'

export interface TiptapEditorHandle {
  getHTML: () => string
  focus: () => void
  setEditable: (editable: boolean) => void
  executeCommand: (command: string, value?: any) => void
  insertAnnotation: (type: string, annotationId: string, branchId: string) => void
}

type ProviderLike = any

interface TiptapEditorProps {
  content: string
  isEditable: boolean
  panelId: string
  onUpdate?: (html: string) => void
  onSelectionChange?: (text: string, range: Range | null) => void
  placeholder?: string
  ydoc: Y.Doc
  provider?: ProviderLike | null
}

const Annotation = Mark.create({
  name: 'annotation',
  
  // Prevent mark from extending when typing at boundaries
  inclusive: false,
  // Prevent mark from carrying over when pressing Enter
  keepOnSplit: false,
  
  addOptions() { return { HTMLAttributes: {} } },
  addAttributes() {
    return {
      id: { default: null, parseHTML: el => el.getAttribute('data-annotation-id'), renderHTML: a => a.id ? { 'data-annotation-id': a.id } : {} },
      type: { default: null, parseHTML: el => el.getAttribute('data-type'), renderHTML: a => a.type ? { 'data-type': a.type } : {} },
      branchId: { default: null, parseHTML: el => el.getAttribute('data-branch'), renderHTML: a => a.branchId ? { 'data-branch': a.branchId } : {} },
      'data-branch': { default: null, parseHTML: el => el.getAttribute('data-branch'), renderHTML: a => a['data-branch'] ? { 'data-branch': a['data-branch'] } : {} },
    }
  },
  parseHTML() { return [{ tag: 'span[data-annotation-id]' }] },
  renderHTML({ HTMLAttributes, mark }) {
    const type = mark.attrs.type || 'note'
    const className = `annotation annotation-${type}`
    return ['span', mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, { class: className, style: 'cursor: pointer;' }), 0]
  },
})

const TiptapEditorCollab = forwardRef<TiptapEditorHandle, TiptapEditorProps>(({
  content, isEditable, panelId, onUpdate, onSelectionChange, placeholder, ydoc, provider
}, ref) => {
  const doc = ydoc

  useEffect(() => {
    // Debug hook if needed
    if (doc) {
      // console.log(`[TiptapEditorCollab] Mounted for panelId: ${panelId}`)
    }
  }, [doc, panelId])

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ history: false }),
      Highlight,
      Underline,
      Annotation,
      Placeholder.configure({ placeholder: placeholder || 'Start typing...' }),
      Collaboration.configure({ document: doc }),
      ...(provider ? [
        CollaborationCursor.configure({ provider, user: { name: 'User', color: '#667eea' } }),
      ] : []),
    ],
    content, // collab path should typically pass '' and let Y.Doc drive content
    editable: isEditable,
    onCreate: ({ editor }) => {
      editor.registerPlugin(AnnotationDecorations())
      editor.registerPlugin(PerformanceMonitor())
      // Prevent annotation marks from leaking at boundaries (IME-safe)
      editor.registerPlugin(ClearStoredMarksAtBoundary())
    },
    onUpdate: ({ editor }) => { onUpdate?.(editor.getHTML()) },
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
  })

  useImperativeHandle(ref, () => ({
    getHTML: () => editor?.getHTML() || '',
    focus: () => editor?.commands.focus(),
    setEditable: (editable: boolean) => editor?.setEditable(editable),
    executeCommand: (command: string, value?: any) => {
      const map: Record<string, any> = {
        bold: () => editor?.chain().focus().toggleBold().run(),
        italic: () => editor?.chain().focus().toggleItalic().run(),
        underline: () => editor?.chain().focus().toggleUnderline().run(),
      }
      map[command]?.(value)
    },
    insertAnnotation: (type: string, annotationId: string, branchId: string) => {
      editor?.chain().focus().setMark('annotation', { id: annotationId, type, branchId }).run()
    },
  }))

  return <EditorContent editor={editor} />
})

export default TiptapEditorCollab
