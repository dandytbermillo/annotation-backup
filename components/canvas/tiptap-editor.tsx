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
// (removed unused yjs-provider import to avoid bundling Yjs in plain mode)

// Custom annotation mark extension based on the source implementation
const Annotation = Mark.create({
  name: 'annotation',
  
  addOptions() {
    return {
      HTMLAttributes: {},
    }
  },

  addAttributes() {
    return {
      id: {
        default: null,
        parseHTML: element => element.getAttribute('data-annotation-id'),
        renderHTML: attributes => {
          if (!attributes.id) return {}
          return { 'data-annotation-id': attributes.id }
        },
      },
      type: {
        default: null,
        parseHTML: element => element.getAttribute('data-type'),
        renderHTML: attributes => {
          if (!attributes.type) return {}
          return { 'data-type': attributes.type }
        },
      },
      branchId: {
        default: null,
        parseHTML: element => element.getAttribute('data-branch'),
        renderHTML: attributes => {
          if (!attributes.branchId) return {}
          return { 'data-branch': attributes.branchId }
        },
      },
      'data-branch': {
        default: null,
        parseHTML: element => element.getAttribute('data-branch'),
        renderHTML: attributes => {
          if (!attributes['data-branch']) return {}
          return { 'data-branch': attributes['data-branch'] }
        },
      },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'span[data-annotation-id]',
      },
    ]
  },

  renderHTML({ HTMLAttributes, mark }) {
    const type = mark.attrs.type || 'note'
    const className = `annotation annotation-${type}`
    
    return ['span', mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, { 
      class: className,
      style: 'cursor: pointer;'
    }), 0]
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

const TiptapEditor = forwardRef<TiptapEditorHandle, TiptapEditorProps>(
  ({ content, isEditable, panelId, onUpdate, onSelectionChange, placeholder, ydoc, provider, onCreateAnnotation }, ref) => {
    // Create or use existing YDoc for this editor
    const doc = ydoc || new Y.Doc()
    
    // Debug: Log Y.Doc info
    useEffect(() => {
      if (ydoc) {
        console.log(`[TiptapEditor] Using Y.Doc for panelId: ${panelId}`, {
          guid: doc.guid,
          hasContent: doc.getXmlFragment('prosemirror').length > 0,
          fragmentContent: doc.getXmlFragment('prosemirror').toString().substring(0, 50),
          _persistenceDocKey: (doc as any)._persistenceDocKey
        });
      }
    }, [ydoc, panelId])
    
    // Check which fragment field to use (for migration compatibility)
    const fragmentField = doc.getMap('_meta').get('fragmentField') || 'prosemirror'
    
    // Set up persistence if no provider is given (for local-only editing)
    useEffect(() => {
      if (!provider && !ydoc && typeof window !== 'undefined' && typeof indexedDB !== 'undefined') {
        const persistence = new IndexeddbPersistence(`annotation-${panelId}`, doc)
        return () => {
          persistence.destroy()
        }
      }
    }, [doc, panelId, provider, ydoc])

    const editor = useEditor({
      extensions: [
        StarterKit.configure({
          history: false, // Disable history when using Yjs
        }),
        Highlight,
        Underline,
        Annotation,
        Placeholder.configure({
          placeholder: placeholder || 'Start typing...',
        }),
        ...(ydoc ? [
          Collaboration.configure({
            document: doc,
            field: fragmentField, // Use dynamic field based on migration status
          }),
        ] : []),
        ...(provider ? [
          CollaborationCursor.configure({
            provider: provider,
            user: {
              name: 'User',
              color: '#667eea',
            },
          }),
        ] : []),
      ],
      // Only set initial content if NOT using Y.js collaboration
      // When using Y.js, content comes from the Y.Doc
      content: ydoc ? undefined : content,
      editable: isEditable,
      onCreate: ({ editor }) => {
        console.log('[TipTapEditor] onCreate callback called')
        // Register ProseMirror plugins (hover icon + perf monitor)
        const annotationPlugin = AnnotationDecorations()
        const perfPlugin = PerformanceMonitor()
        console.log('[TipTapEditor] Registering annotation plugin:', annotationPlugin)
        editor.registerPlugin(annotationPlugin)
        editor.registerPlugin(perfPlugin)
        console.log('[TipTapEditor] Plugins registered successfully')
      },
      onUpdate: ({ editor }) => {
        const html = editor.getHTML()
        console.log(`[TiptapEditor] onUpdate fired for panelId: ${panelId}, html length: ${html.length}`)
        onUpdate?.(html)
      },
      onSelectionUpdate: ({ editor }) => {
        const { from, to } = editor.state.selection
        const text = editor.state.doc.textBetween(from, to, ' ')
        
        if (text.trim().length > 0 && onSelectionChange) {
          // Create a DOM range for compatibility with existing annotation system
          const view = editor.view
          const domRange = document.createRange()
          
          try {
            const start = view.domAtPos(from)
            const end = view.domAtPos(to)
            domRange.setStart(start.node, start.offset)
            domRange.setEnd(end.node, end.offset)
            onSelectionChange(text, domRange)
          } catch (e) {
            // Fallback if DOM position fails
            onSelectionChange(text, null)
          }
        } else {
          onSelectionChange?.('', null)
        }
      },
      editorProps: {
        attributes: {
          class: 'prose prose-lg max-w-none focus:outline-none tiptap-editor',
          'data-panel': panelId, // Add data-panel attribute for annotation toolbar
          style: `
            background: #fafbfc;
            border: 1px solid #e1e8ed;
            border-radius: 8px;
            padding: 20px;
            min-height: 250px;
            font-family: 'Georgia', serif;
            line-height: 1.8;
            font-size: 15px;
            color: #2c3e50;
          `,
        },
        handleClick: (view, pos, event) => {
          // Handle clicks on annotation spans
          const target = event.target as HTMLElement
          if (target.classList.contains('annotation') || target.closest('.annotation')) {
            const annotationElement = target.classList.contains('annotation') ? target : target.closest('.annotation') as HTMLElement
            const branchId = annotationElement.getAttribute('data-branch') || annotationElement.getAttribute('data-branch-id')
            
            if (branchId) {
              // Dispatch event to open panel
              window.dispatchEvent(new CustomEvent('create-panel', { detail: { panelId: branchId } }))
            }
            
            // Prevent text selection on click
            return true
          }
          return false
        },
      },
    })

    // Update editable state when prop changes
    useEffect(() => {
      if (editor && editor.isEditable !== isEditable) {
        editor.setEditable(isEditable)
      }
    }, [editor, isEditable])

    // Update content when it changes externally
    // BUT only if NOT using Y.js collaboration (content should come from Y.Doc)
    useEffect(() => {
      if (editor && !ydoc && content !== editor.getHTML() && !editor.isFocused) {
        editor.commands.setContent(content)
      }
    }, [editor, content, ydoc])

    // Add styles for annotations and decorations
    useEffect(() => {
      if (typeof window === 'undefined') return
      
      const style = document.createElement('style')
      style.textContent = `
        .tiptap-editor .annotation {
          background: linear-gradient(135deg, #ffeaa7 0%, #fab1a0 100%);
          padding: 2px 6px;
          border-radius: 4px;
          cursor: pointer;
          position: relative;
          transition: all 0.3s ease;
          font-weight: 600;
          border-bottom: 2px solid transparent;
        }
        
        .tiptap-editor .annotation:hover {
          transform: translateY(-1px);
          box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        }
        
        .tiptap-editor .annotation.annotation-note {
          background: linear-gradient(135deg, #e3f2fd 0%, #bbdefb 100%);
          border-bottom-color: #2196f3;
          color: #1565c0;
        }
        
        .tiptap-editor .annotation.annotation-explore {
          background: linear-gradient(135deg, #fff3e0 0%, #ffcc80 100%);
          border-bottom-color: #ff9800;
          color: #ef6c00;
        }
        
        .tiptap-editor .annotation.annotation-promote {
          background: linear-gradient(135deg, #e8f5e8 0%, #c8e6c9 100%);
          border-bottom-color: #4caf50;
          color: #2e7d32;
        }
        
        /* Enhanced hover effects for decorations */
        .tiptap-editor .annotation-hover-target {
          position: relative;
          display: inline-block;
        }
        
        .tiptap-editor .annotation-hover-target.annotation-hovered {
          transform: translateY(-2px) scale(1.02);
          filter: brightness(1.1);
          z-index: 10;
        }
        
        .tiptap-editor .annotation-hover-target.annotation-clicked {
          animation: annotationClick 0.3s ease-out;
        }
        
        @keyframes annotationClick {
          0% { transform: scale(1); }
          50% { transform: scale(0.95); }
          100% { transform: scale(1); }
        }
        
        /* Hover icon styles */
        .annotation-hover-icon {
          width: 22px;
          height: 22px;
          border-radius: 50%;
          background: rgba(0, 0, 0, 0.85);
          color: #fff;
          font-size: 12px;
          line-height: 22px;
          text-align: center;
          border: 1px solid rgba(255, 255, 255, 0.15);
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
          cursor: pointer;
          user-select: none;
          transition: transform 0.2s ease, box-shadow 0.2s ease;
        }
        
        .annotation-hover-icon:hover {
          transform: scale(1.1);
          box-shadow: 0 6px 16px rgba(0, 0, 0, 0.4);
        }
        
        /* Tooltip styles */
        .annotation-tooltip {
          position: fixed;
          background: white;
          border: 1px solid #e1e8ed;
          border-radius: 8px;
          padding: 12px;
          box-shadow: 0 4px 12px rgba(0,0,0,0.15);
          z-index: 10001;
          max-width: 300px;
          opacity: 0;
          visibility: hidden;
          transition: opacity 0.2s ease, visibility 0.2s ease, transform 0.2s ease;
          transform: translateY(5px);
          pointer-events: none;
        }
        
        .annotation-tooltip.visible {
          opacity: 1;
          visibility: visible;
          transform: translateY(0);
          pointer-events: auto;
        }
        
        .annotation-tooltip .tooltip-header {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-bottom: 8px;
          font-weight: 600;
        }
        
        .annotation-tooltip .tooltip-content {
          color: #666;
          font-size: 14px;
          line-height: 1.4;
        }
        
        .annotation-tooltip .tooltip-footer {
          margin-top: 8px;
          padding-top: 8px;
          border-top: 1px solid #e1e8ed;
          font-size: 12px;
          color: #999;
        }
        }
        
        .annotation-tooltip .tooltip-icon {
          font-size: 16px;
        }
        
        .annotation-tooltip .tooltip-content {
          font-size: 12px;
          line-height: 1.5;
          color: rgba(255, 255, 255, 0.9);
          margin-bottom: 8px;
        }
        
        .annotation-tooltip .tooltip-footer {
          font-size: 11px;
          color: rgba(255, 255, 255, 0.7);
          font-style: italic;
          border-top: 1px solid rgba(255, 255, 255, 0.2);
          padding-top: 8px;
        }
        
        /* Glowing effect for annotations */
        .tiptap-editor .annotation-hover-target::after {
          content: '';
          position: absolute;
          inset: -2px;
          border-radius: 6px;
          opacity: 0;
          transition: opacity 0.3s ease;
          pointer-events: none;
        }
        
        .tiptap-editor .annotation-hover-target.annotation-hovered::after {
          opacity: 1;
        }
        
        .tiptap-editor .annotation-hover-target[data-annotation-type="note"]::after {
          box-shadow: 0 0 12px rgba(33, 150, 243, 0.5);
        }
        
        .tiptap-editor .annotation-hover-target[data-annotation-type="explore"]::after {
          box-shadow: 0 0 12px rgba(255, 152, 0, 0.5);
        }
        
        .tiptap-editor .annotation-hover-target[data-annotation-type="promote"]::after {
          box-shadow: 0 0 12px rgba(76, 175, 80, 0.5);
        }
        
        /* Ripple effect */
        .tiptap-editor .annotation-hover-target {
          overflow: hidden;
        }
        
        .annotation-ripple {
          position: absolute;
          border-radius: 50%;
          background: rgba(255, 255, 255, 0.6);
          transform: scale(0);
          animation: ripple 0.6s ease-out;
          pointer-events: none;
        }
        
        @keyframes ripple {
          to {
            transform: scale(4);
            opacity: 0;
          }
        }
        
        /* Enhanced focus states */
        .tiptap-editor .annotation-hover-target:focus-visible {
          outline: 2px solid #667eea;
          outline-offset: 2px;
        }
      `
      document.head.appendChild(style)
      
      return () => {
        document.head.removeChild(style)
      }
    }, [])

    // Expose editor methods via ref
    useImperativeHandle(ref, () => ({
      getHTML: () => editor?.getHTML() || '',
      focus: () => {
        editor?.commands.focus()
      },
      setEditable: (editable: boolean) => {
        editor?.setEditable(editable)
      },
      executeCommand: (command: string, value?: any) => {
        if (!editor) return
        
        switch (command) {
          case 'bold':
            editor.chain().focus().toggleBold().run()
            break
          case 'italic':
            editor.chain().focus().toggleItalic().run()
            break
          case 'underline':
            editor.chain().focus().toggleUnderline().run()
            break
          case 'heading':
            editor.chain().focus().toggleHeading({ level: value || 2 }).run()
            break
          case 'bulletList':
            editor.chain().focus().toggleBulletList().run()
            break
          case 'orderedList':
            editor.chain().focus().toggleOrderedList().run()
            break
          case 'blockquote':
            editor.chain().focus().toggleBlockquote().run()
            break
          case 'highlight':
            editor.chain().focus().toggleHighlight().run()
            break
          case 'removeFormat':
            editor.chain().focus().clearNodes().unsetAllMarks().run()
            break
        }
      },
      insertAnnotation: (type: string, annotationId: string, branchId: string) => {
        if (!editor) {
          console.warn('Editor not initialized')
          return
        }

        const { from, to } = editor.state.selection
        
        // Check if there's actually a selection
        if (from === to) {
          console.warn('No text selected for annotation')
          return
        }
        
        // Apply the annotation mark
        editor
          .chain()
          .focus()
          .setMark('annotation', {
            id: annotationId,
            type,
            branchId,
            'data-branch': branchId,
          })
          .run()
        
        // Trigger update to save content
        const html = editor.getHTML()
        onUpdate?.(html)
      }
    }), [editor, onUpdate])

    return (
      <div 
        className="tiptap-editor-wrapper"
        onFocus={(e) => {
          const target = e.currentTarget.querySelector('[role="textbox"]') as HTMLElement
          if (target) {
            target.style.borderColor = '#667eea'
            target.style.boxShadow = '0 0 0 3px rgba(102, 126, 234, 0.1)'
          }
        }}
        onBlur={(e) => {
          const target = e.currentTarget.querySelector('[role="textbox"]') as HTMLElement
          if (target) {
            target.style.borderColor = '#e1e8ed'
            target.style.boxShadow = 'none'
          }
        }}
      >
        <EditorContent editor={editor} />
      </div>
    )
  }
)

TiptapEditor.displayName = 'TiptapEditor'

export default TiptapEditor 
