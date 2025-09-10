"use client"

/**
 * TipTap Editor for Plain Mode - Option A (offline, single-user, no Yjs)
 * 
 * This editor variant operates without Yjs collaboration features.
 * It implements all 10 critical fixes from the Yjs version while
 * using standard TipTap history instead of CRDT-based collaboration.
 * 
 * @module components/canvas/tiptap-editor-plain
 */

import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Highlight from '@tiptap/extension-highlight'
import Underline from '@tiptap/extension-underline'
import Placeholder from '@tiptap/extension-placeholder'
import { useEffect, useImperativeHandle, forwardRef, useState, useMemo } from 'react'
import { Mark, mergeAttributes } from '@tiptap/core'
import { AnnotationDecorations } from './annotation-decorations'
import { PerformanceMonitor } from './performance-decorations'
import { ClearStoredMarksAtBoundary } from './clear-stored-marks-plugin'
import { AnnotationStartBoundaryFix } from './annotation-start-boundary-fix'
import type { PlainOfflineProvider, ProseMirrorJSON } from '@/lib/providers/plain-offline-provider'

// Custom annotation mark extension (same as Yjs version)
const Annotation = Mark.create({
  name: 'annotation',
  
  // Configuration for proper boundary behavior
  // inclusive: true (default) - allows typing at end to extend
  keepOnSplit: false, // Prevent Enter from carrying annotation to new line
  
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
    // Recognize both explicit annotation-id spans and seeded annotation spans
    return [
      { tag: 'span[data-annotation-id]' },
      { tag: 'span.annotation[data-branch]' },
      { tag: 'span[data-branch]' },
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

interface TiptapEditorPlainProps {
  content?: string | ProseMirrorJSON
  isEditable: boolean
  noteId: string
  panelId: string
  onUpdate?: (content: ProseMirrorJSON) => void
  onSelectionChange?: (text: string, range: Range | null) => void
  placeholder?: string
  provider?: PlainOfflineProvider
  onCreateAnnotation?: (type: string, selectedText: string) => { id: string; branchId: string } | null
}

export interface TiptapEditorPlainHandle {
  getHTML: () => string
  getJSON: () => ProseMirrorJSON
  focus: () => void
  setEditable: (editable: boolean) => void
  executeCommand: (command: string, value?: any) => void
  insertAnnotation: (type: string, annotationId: string, branchId: string) => void
}

const TiptapEditorPlain = forwardRef<TiptapEditorPlainHandle, TiptapEditorPlainProps>(
  ({ content, isEditable, noteId, panelId, onUpdate, onSelectionChange, placeholder, provider, onCreateAnnotation }, ref) => {
    // Fix #3: Track loading state
    const [isContentLoading, setIsContentLoading] = useState(true)
    const [loadedContent, setLoadedContent] = useState<ProseMirrorJSON | string | null>(null)
    
    // Load content from provider when noteId/panelId changes
    useEffect(() => {
      if (!provider || !noteId) {
        setIsContentLoading(false)
        return
      }
      
      console.log(`[TiptapEditorPlain] Loading content for noteId: ${noteId}, panelId: ${panelId}`)
      setIsContentLoading(true)
      
      // Load content from provider asynchronously
      provider.loadDocument(noteId, panelId).then(loadedDoc => {
        console.log(`[TiptapEditorPlain] Loaded document:`, loadedDoc)
        if (loadedDoc) {
          // loadDocument returns the content directly (ProseMirrorJSON or HtmlString)
          setLoadedContent(loadedDoc)
        } else {
          // No content found, use empty document
          setLoadedContent({ type: 'doc', content: [] })
        }
        setIsContentLoading(false)
      }).catch(error => {
        console.error('[TiptapEditorPlain] Failed to load content:', error)
        setLoadedContent({ type: 'doc', content: [] })
        setIsContentLoading(false)
      })
    }, [provider, noteId, panelId])
    
    // Don't use any initial content if we're loading from provider
    // This prevents the editor from being initialized with empty content
    const initialContent = isContentLoading && provider ? undefined : (loadedContent || content || '')
    
    const editor = useEditor({
      extensions: [
        StarterKit.configure({
          history: true, // Enable history for plain mode
        }),
        Highlight,
        Underline,
        Annotation,
        Placeholder.configure({
          placeholder: placeholder || 'Start typing...',
        }),
      ],
      content: initialContent,
      editable: isEditable,
      onCreate: ({ editor }) => {
        // Register ProseMirror plugins
        editor.registerPlugin(AnnotationDecorations())
        editor.registerPlugin(PerformanceMonitor())
        // Fix for annotation start boundary
        editor.registerPlugin(AnnotationStartBoundaryFix())
        // Note: ClearStoredMarksAtBoundary not needed since we're using default inclusive behavior
        
        // Don't clear content or set loading false here if we're still loading
        if (!isContentLoading) {
          // Fix #1: Prevent duplicate "Start writing..."
          const currentContent = editor.getHTML()
          if (!currentContent || currentContent === '<p></p>' || currentContent.trim() === '') {
            editor.commands.clearContent()
          }
        }
      },
      onUpdate: ({ editor }) => {
        const json = editor.getJSON()
        // Hash current content to detect real changes
        const contentStr = JSON.stringify(json)
        ;(window as any).__lastContentHash = (window as any).__lastContentHash || new Map()
        const key = `${noteId}:${panelId}`
        const prev = (window as any).__lastContentHash.get(key)
        if (prev === contentStr) return
        (window as any).__lastContentHash.set(key, contentStr)

        // Debounce saves to reduce version churn
        ;(window as any).__debouncedSave = (window as any).__debouncedSave || new Map()
        const existing = (window as any).__debouncedSave.get(key)
        if (existing) clearTimeout(existing)
        const timer = setTimeout(() => {
          if (provider && noteId) {
            provider.saveDocument(noteId, panelId, json).catch(err => {
              console.error('[TiptapEditorPlain] Failed to save content:', err)
            })
          }
          onUpdate?.(json)
        }, 800) // 800ms idle before saving
        ;(window as any).__debouncedSave.set(key, timer)
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
          'data-note': noteId,   // Add data-note for tracking
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

    // Update editor content when loaded content changes
    useEffect(() => {
      if (editor && loadedContent && !isContentLoading) {
        console.log('[TiptapEditorPlain] Setting loaded content in editor:', loadedContent)
        // Use a slight delay to ensure editor is fully ready
        setTimeout(() => {
          if (editor && !editor.isDestroyed) {
            editor.commands.setContent(loadedContent, false)
            // Force a view update
            editor.view.updateState(editor.view.state)
          }
        }, 0)
      }
    }, [editor, loadedContent, isContentLoading])

    // Fix #2 & #5: Handle content updates with composite key awareness
    useEffect(() => {
      if (editor && !isContentLoading && !loadedContent && content !== undefined) {
        const currentJSON = editor.getJSON()
        const newContent = typeof content === 'string' 
          ? { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: content }] }] }
          : content
        
        // Only update if content actually changed
        if (JSON.stringify(currentJSON) !== JSON.stringify(newContent)) {
          editor.commands.setContent(newContent)
        }
      }
    }, [editor, content, isContentLoading, loadedContent])

    // Add styles for annotations and decorations (same as Yjs version)
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
        
        /* Additional plain mode specific styles */
        .tiptap-editor.plain-mode {
          border-color: #4caf50;
        }
        
        .tiptap-editor.plain-mode:focus-within {
          border-color: #2e7d32;
          box-shadow: 0 0 0 2px rgba(76, 175, 80, 0.2);
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
      getJSON: () => editor?.getJSON() || { type: 'doc', content: [] },
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
          case 'undo':
            editor.chain().focus().undo().run()
            break
          case 'redo':
            editor.chain().focus().redo().run()
            break
        }
      },
      insertAnnotation: (type: string, annotationId: string, branchId: string) => {
        if (!editor) {
          console.warn('[TiptapEditorPlain] Editor not initialized')
          return
        }

        const { from, to } = editor.state.selection
        
        // Check if there's actually a selection
        if (from === to) {
          console.warn('[TiptapEditorPlain] No text selected for annotation')
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
        const json = editor.getJSON()
        
        // Save to provider if available
        if (provider && noteId) {
          provider.saveDocument(noteId, panelId, json).catch(error => {
            console.error('[TiptapEditorPlain] Failed to save annotation:', error)
          })
        }
        
        onUpdate?.(json)
      }
    }), [editor, onUpdate, provider, noteId, panelId])

    // Show loading state
    if (isContentLoading && provider) {
      return (
        <div className="tiptap-editor-wrapper">
          <div className="tiptap-editor-loading" style={{
            background: '#fafbfc',
            border: '1px solid #e1e8ed',
            borderRadius: '8px',
            padding: '20px',
            minHeight: '250px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#667eea'
          }}>
            Loading content...
          </div>
        </div>
      )
    }

    return (
      <div 
        className="tiptap-editor-wrapper"
        onFocus={(e) => {
          const target = e.currentTarget.querySelector('[role="textbox"]') as HTMLElement
          if (target) {
            target.classList.add('plain-mode')
            target.style.borderColor = '#4caf50'
            target.style.boxShadow = '0 0 0 3px rgba(76, 175, 80, 0.1)'
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

TiptapEditorPlain.displayName = 'TiptapEditorPlain'

export default TiptapEditorPlain
