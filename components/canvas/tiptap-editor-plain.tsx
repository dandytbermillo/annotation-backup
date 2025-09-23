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

import '@/styles/tiptap-editor.css'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Highlight from '@tiptap/extension-highlight'
import Underline from '@tiptap/extension-underline'
import Placeholder from '@tiptap/extension-placeholder'
import { CollapsibleBlock } from '@/lib/extensions/collapsible-block'
import { useEffect, useImperativeHandle, forwardRef, useState, useMemo, useRef } from 'react'
import { Mark, mergeAttributes } from '@tiptap/core'
// import { AnnotationDecorations } from './annotation-decorations'
// import { AnnotationDecorationsHoverOnly } from './annotation-decorations-hover-only' // Replaced with hover-icon.ts
// import { AnnotationDecorationsSimple } from './annotation-decorations-simple'
import { attachHoverIcon } from './hover-icon'
import { showAnnotationTooltip, hideAnnotationTooltipSoon, initializeTooltip } from './annotation-tooltip'
import { PerformanceMonitor } from './performance-decorations'
import { ClearStoredMarksAtBoundary } from './clear-stored-marks-plugin'
import { AnnotationStartBoundaryFix } from './annotation-start-boundary-fix'
import { WebKitAnnotationCursorFix } from './webkit-annotation-cursor-fix'
import { AnnotationArrowNavigationFix } from './annotation-arrow-navigation-fix'
// import { BrowserSpecificCursorFix } from './browser-specific-cursor-fix'
// import { WebKitAnnotationClickFix } from './webkit-annotation-click-fix'
// import { SafariInlineBlockFix } from './safari-inline-block-fix'
// import { SafariCursorFixFinal } from './safari-cursor-fix-final'
// import { SafariNotionFix } from './safari-notion-fix'
import { SafariProvenFix } from './safari-proven-fix'
import { SafariManualCursorFix } from './safari-manual-cursor-fix'
import { ReadOnlyGuard } from './read-only-guard'
import type { PlainOfflineProvider, ProseMirrorJSON } from '@/lib/providers/plain-offline-provider'
import { debugLog, createContentPreview } from '@/lib/debug-logger'
import { extractPreviewFromContent } from '@/lib/utils/branch-preview'

const JSON_START_RE = /^\s*[\[{]/

function providerContentIsEmpty(provider: PlainOfflineProvider | undefined, value: any): boolean {
  if (!value) return true
  if (provider && typeof (provider as any).isEmptyContent === 'function') {
    try {
      return (provider as any).isEmptyContent(value)
    } catch {
      // fall back to heuristics
    }
  }
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed.length === 0 || trimmed === '<p></p>'
  }
  if (typeof value === 'object') {
    try {
      const preview = extractPreviewFromContent(value)
      if (preview.trim().length === 0) {
        const content = (value as any).content
        if (!Array.isArray(content) || content.length === 0) return true
        return content.every((node: any) => providerContentIsEmpty(provider, node))
      }
      return false
    } catch {
      const content = (value as any).content
      return Array.isArray(content) && content.length === 0
    }
  }
  return false
}

function coerceStoredContent(value: any): ProseMirrorJSON | string | null {
  if (!value) return null
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return null
    if (JSON_START_RE.test(trimmed)) {
      try {
        return JSON.parse(trimmed)
      } catch {
        return trimmed
      }
    }
    return value
  }
  if (typeof value === 'object') {
    try {
      return JSON.parse(JSON.stringify(value))
    } catch {
      return value as ProseMirrorJSON
    }
  }
  return null
}

function normalizePreview(value: string | undefined | null): string {
  return (value || '').replace(/\s+/g, ' ').trim().toLowerCase()
}

function extractPreviewSafe(content: ProseMirrorJSON | string | null): string {
  if (!content) return ''
  return extractPreviewFromContent(content)?.toString() ?? ''
}

function isPlaceholderDocument(
  content: ProseMirrorJSON | string | null,
  branchEntry: any
): boolean {
  const preview = normalizePreview(extractPreviewSafe(content))
  if (!preview) return true

  if (preview.includes('start writing your') && preview.endsWith('...')) {
    return true
  }

  return false
}

const PENDING_SAVE_MAX_AGE_MS = 5 * 60 * 1000

type PendingRestoreState = {
  content: ProseMirrorJSON | string
  version: number
  key: string
}

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
    
    // Include all the attributes needed for hover icon
    const attrs: any = { 
      class: className,
      'data-type': type
    }
    
    // Add branch-related attributes
    if (mark.attrs.branchId) {
      attrs['data-branch'] = mark.attrs.branchId
      attrs['data-branch-id'] = mark.attrs.branchId
    }
    
    return ['span', mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, attrs), 0]
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
  onContentLoaded?: (payload: { content: ProseMirrorJSON | string | null; version: number }) => void
}

export interface TiptapEditorPlainHandle {
  getHTML: () => string
  getJSON: () => ProseMirrorJSON
  focus: () => void
  setEditable: (editable: boolean) => void
  executeCommand: (command: string, value?: any) => void
  insertAnnotation: (type: string, annotationId: string, branchId: string) => void
  setPerformanceMode?: (enabled: boolean) => void
}

const TiptapEditorPlain = forwardRef<TiptapEditorPlainHandle, TiptapEditorPlainProps>(
  ({ content, isEditable, noteId, panelId, onUpdate, onSelectionChange, placeholder, provider, onCreateAnnotation, onContentLoaded }, ref) => {
    // Fix #3: Track loading state
    const [isContentLoading, setIsContentLoading] = useState(true)
    
    // Track editable state for read-only guard
    const isEditableRef = useRef(isEditable)
    const [loadedContent, setLoadedContent] = useState<ProseMirrorJSON | string | null>(null)
    const pendingRestoreAttemptedRef = useRef(false)
    const pendingPromotionRef = useRef<PendingRestoreState | null>(null)
    const hasHydratedRef = useRef(false)
    const fallbackSourceRef = useRef<'preview' | 'content' | null>(null)
    const previewFallbackContentRef = useRef<ProseMirrorJSON | string | null>(null)
    const normalizeContent = useMemo(
      () => (value: any) => {
        if (!value) return ''
        if (typeof value === 'string') return value
        try {
          return JSON.stringify(value)
        } catch {
          return ''
        }
      },
      []
    )
    
    useEffect(() => {
      if (typeof window !== 'undefined') {
        const existingSession = window.localStorage.getItem('debug-logger-session-id')
        if (!existingSession) {
          debugLog('TiptapEditorPlain', 'SESSION_INIT', {
            noteId,
            panelId,
            metadata: { autoInitialized: true }
          })
        }
      }
    }, [noteId, panelId])

    useEffect(() => {
      hasHydratedRef.current = false
    }, [noteId, panelId])

    // Load content from provider when noteId/panelId changes
    // SIMPLIFIED APPROACH - match the working example
    useEffect(() => {
      if (!provider || !noteId) {
        setIsContentLoading(false)
        pendingPromotionRef.current = null
        return
      }

      pendingRestoreAttemptedRef.current = false
      let isActive = true
      const pendingKey = `pending_save_${noteId}_${panelId}`
      let pendingPayload: { content: ProseMirrorJSON | string; version: number } | null = null

      if (typeof window !== 'undefined') {
        try {
          const raw = localStorage.getItem(pendingKey)
          debugLog('TiptapEditorPlain', 'PENDING_PAYLOAD_RAW', {
            noteId,
            panelId,
            metadata: { hasRaw: !!raw }
          })
          if (raw) {
            const parsed = JSON.parse(raw) as { content?: any; timestamp?: number; version?: number }
            debugLog('TiptapEditorPlain', 'PENDING_PAYLOAD_PARSED', {
            noteId,
            panelId,
            metadata: { hasContent: !!parsed?.content, version: parsed?.version }
          })
            const timestamp = typeof parsed.timestamp === 'number' ? parsed.timestamp : 0
            if (timestamp) {
              const age = Date.now() - timestamp
              if (age < PENDING_SAVE_MAX_AGE_MS && Object.prototype.hasOwnProperty.call(parsed, 'content')) {
                pendingPayload = {
                  content: parsed.content as ProseMirrorJSON | string,
                  version: typeof parsed.version === 'number' ? parsed.version : 0
                }
              } else if (age >= PENDING_SAVE_MAX_AGE_MS) {
                localStorage.removeItem(pendingKey)
              }
            } else {
              localStorage.removeItem(pendingKey)
            }
          }
        } catch (error) {
          console.error('[TiptapEditorPlain] Failed to parse pending save snapshot:', error)
          localStorage.removeItem(pendingKey)
        }
      }

      if (pendingPayload) {
        debugLog('TiptapEditorPlain', 'PENDING_PAYLOAD_DETECTED', {
          noteId,
          panelId,
          metadata: { version: pendingPayload.version }
        })
        pendingRestoreAttemptedRef.current = true
        pendingPromotionRef.current = { ...pendingPayload, key: pendingKey }
        setLoadedContent(pendingPayload.content)
        setIsContentLoading(false)
        onContentLoaded?.({ content: pendingPayload.content, version: pendingPayload.version })
      } else {
        pendingPromotionRef.current = null
        setIsContentLoading(true)
      }

      debugLog('TiptapEditorPlain', 'START_LOAD', {
        noteId,
        panelId,
        metadata: { component: 'editor', action: 'start_load' }
      })

      const branchEntry = typeof window !== 'undefined'
        ? (window as any).canvasDataStore?.get?.(panelId)
        : null

      provider.loadDocument(noteId, panelId).then(() => {
        if (!isActive) return

        let remoteContent: ProseMirrorJSON | string | null = null
        try {
          remoteContent = provider.getDocument(noteId, panelId)
        } catch {}

        let resolvedContent: ProseMirrorJSON | string | null = remoteContent

        fallbackSourceRef.current = null
        previewFallbackContentRef.current = null

        const treatAsPlaceholder = branchEntry
          ? isPlaceholderDocument(resolvedContent, branchEntry)
          : false

        const needsFallback = !resolvedContent
          || providerContentIsEmpty(provider, resolvedContent)
          || treatAsPlaceholder
        if (needsFallback && typeof window !== 'undefined') {
          try {
            const fallbackRaw = branchEntry?.content || branchEntry?.metadata?.htmlSnapshot
            let fallback = coerceStoredContent(fallbackRaw)

            if (!fallback || providerContentIsEmpty(provider, fallback)) {
              const previewText = branchEntry?.preview || branchEntry?.metadata?.preview
              if (typeof previewText === 'string' && previewText.trim().length > 0) {
                fallback = {
                  type: 'doc',
                  content: [{
                    type: 'paragraph',
                    content: [{ type: 'text', text: previewText.trim() }]
                  }]
                }
                fallbackSourceRef.current = 'preview'
                previewFallbackContentRef.current = fallback
              }
            }

            if (fallback && !providerContentIsEmpty(provider, fallback)) {
              debugLog('TiptapEditorPlain', 'FALLBACK_DOC_RESTORED', {
                noteId,
                panelId,
                contentPreview: createContentPreview(fallback),
                metadata: { source: fallbackSourceRef.current ?? 'content', hadPreview: !!fallbackRaw }
              })
              resolvedContent = fallback

              // Persist fallback to server only if it came from stored content
              if (fallbackSourceRef.current !== 'preview') {
                fallbackSourceRef.current = 'content'
                previewFallbackContentRef.current = null
                provider.saveDocument(noteId, panelId, fallback, false, { skipBatching: true }).catch(err => {
                  console.error('[TiptapEditorPlain] Failed to persist fallback content:', err)
                })
              }
            }
          } catch (fallbackError) {
            console.warn('[TiptapEditorPlain] Failed to derive fallback content:', fallbackError)
            debugLog('TiptapEditorPlain', 'FALLBACK_DOC_ERROR', {
              noteId,
              panelId,
              metadata: { reason: fallbackError instanceof Error ? fallbackError.message : String(fallbackError) }
            })
          }
        }

        if (!resolvedContent) {
          resolvedContent = { type: 'doc', content: [] }
        }

        let remoteVersion = 0
        try {
          remoteVersion = provider.getDocumentVersion(noteId, panelId)
        } catch {}

        debugLog('TiptapEditorPlain', 'CONTENT_LOADED', {
          noteId,
          panelId,
          contentPreview: createContentPreview(resolvedContent),
          metadata: { hasContent: !!remoteContent, contentType: typeof resolvedContent }
        })

        const promoted = pendingPromotionRef.current
        if (promoted) {
          const pendingVersion = typeof promoted.version === 'number' ? promoted.version : 0
          const sameContent = normalizeContent(resolvedContent) === normalizeContent(promoted.content)
          const remoteNotOlder = remoteVersion >= pendingVersion
          debugLog('TiptapEditorPlain', 'REMOTE_LOAD_WITH_PENDING', {
            noteId,
            panelId,
            metadata: { remoteVersion, pendingVersion, remoteNotOlder, sameContent }
          })

          if (remoteNotOlder && sameContent) {
            setLoadedContent(resolvedContent)
            onContentLoaded?.({ content: resolvedContent, version: remoteVersion })
            localStorage.removeItem(promoted.key)
            pendingPromotionRef.current = null
            setIsContentLoading(false)
            return
          }

          debugLog('TiptapEditorPlain', 'PROMOTE_PENDING_SNAPSHOT', {
            noteId,
            panelId,
            metadata: { remoteVersion, pendingVersion, sameContent }
          })

          const targetVersion = remoteNotOlder ? remoteVersion + 1 : Math.max(remoteVersion + 1, pendingVersion)
          const promotedIsPlaceholder = branchEntry
            ? isPlaceholderDocument(promoted.content, branchEntry)
            : false

          fallbackSourceRef.current = promotedIsPlaceholder ? 'preview' : null
          previewFallbackContentRef.current = promotedIsPlaceholder ? promoted.content : null

          setLoadedContent(promoted.content)
          setIsContentLoading(false)

          if (promotedIsPlaceholder) {
            debugLog('TiptapEditorPlain', 'FALLBACK_PREVIEW_DISPLAYED', {
              noteId,
              panelId,
              contentPreview: createContentPreview(promoted.content),
              metadata: { source: 'pending-preview' }
            })
            localStorage.removeItem(promoted.key)
            pendingPromotionRef.current = null
          } else {
            onContentLoaded?.({
              content: promoted.content,
              version: targetVersion
            })
            provider.saveDocument(noteId, panelId, promoted.content, false, { skipBatching: true })
              .then(() => {
                localStorage.removeItem(promoted.key)
                pendingPromotionRef.current = null
              })
              .catch(err => {
                console.error('[TiptapEditorPlain] Failed to persist pending restore:', err)
              })
          }
          return
        }

        const notifyLoad = fallbackSourceRef.current !== 'preview'
        setLoadedContent(resolvedContent)
        setIsContentLoading(false)
        if (notifyLoad) {
          onContentLoaded?.({ content: resolvedContent, version: remoteVersion })
          fallbackSourceRef.current = null
          previewFallbackContentRef.current = null
        } else {
          debugLog('TiptapEditorPlain', 'FALLBACK_PREVIEW_DISPLAYED', {
            noteId,
            panelId,
            contentPreview: createContentPreview(resolvedContent),
            metadata: { source: 'provider-preview' }
          })
        }
      }).catch(error => {
        console.error(`[TiptapEditorPlain-${panelId}] Failed to load content:`, error)
        if (!pendingPromotionRef.current) {
          setLoadedContent({ type: 'doc', content: [] })
          onContentLoaded?.({ content: { type: 'doc', content: [] }, version: 0 })
        }
        setIsContentLoading(false)
      })

      return () => {
        isActive = false
      }
    }, [provider, noteId, panelId, normalizeContent, onContentLoaded])
    
    // Check for pending saves in localStorage and restore when provider cache is behind
    useEffect(() => {
      if (!provider || !noteId || !panelId) return
      if (isContentLoading) return
      if (pendingRestoreAttemptedRef.current) return

      pendingRestoreAttemptedRef.current = true
      debugLog('TiptapEditorPlain', 'SECONDARY_PENDING_RESTORE_CHECK', {
        noteId,
        panelId
      })

      const pendingKey = `pending_save_${noteId}_${panelId}`
      const pendingData = localStorage.getItem(pendingKey)
      if (!pendingData) return

      try {
        const { content: pendingContent, timestamp, version: pendingVersion = 0 } = JSON.parse(pendingData)
        if (typeof timestamp !== 'number') {
          localStorage.removeItem(pendingKey)
          return
        }
        const age = Date.now() - timestamp
        if (age >= PENDING_SAVE_MAX_AGE_MS) {
          localStorage.removeItem(pendingKey)
          return
        }

        let providerVersion = 0
        let existingDoc: any = null
        try {
          providerVersion = provider.getDocumentVersion(noteId, panelId)
          existingDoc = provider.getDocument(noteId, panelId)
        } catch {}

        const sameContent = normalizeContent(existingDoc) === normalizeContent(pendingContent)

        debugLog('TiptapEditorPlain', 'FALLBACK_PENDING_RESTORE', {
          noteId,
          panelId,
          metadata: { providerVersion, pendingVersion, sameContent }
        })

        if (providerVersion >= pendingVersion) {
          if (!sameContent) {
            debugLog('TiptapEditorPlain', 'FALLBACK_DISCARD_PENDING', {
              noteId,
              panelId,
              metadata: { providerVersion, pendingVersion, reason: 'provider-newer' }
            })
            localStorage.removeItem(pendingKey)
            return
          }
          debugLog('TiptapEditorPlain', 'FALLBACK_PENDING_MATCH', {
            noteId,
            panelId,
            metadata: { providerVersion, pendingVersion }
          })
          localStorage.removeItem(pendingKey)
          return
        }

        provider.saveDocument(noteId, panelId, pendingContent, false, { skipBatching: true })
          .then(() => {
            localStorage.removeItem(pendingKey)
            setLoadedContent(pendingContent)
            if (onContentLoaded) {
              onContentLoaded({ content: pendingContent, version: Math.max(providerVersion, pendingVersion) })
            }
          })
          .catch(err => {
            console.error('[TiptapEditorPlain] Failed to restore pending save:', err)
          })
      } catch (error) {
        console.error('[TiptapEditorPlain] Failed to parse pending save:', error)
        localStorage.removeItem(pendingKey)
      }
    }, [provider, noteId, panelId, isContentLoading, normalizeContent, onContentLoaded])
    
    // CRITICAL: Always use undefined as initial content when we have a provider
    // This prevents the editor from being recreated when loading state changes
    // Content will ALWAYS be set via useEffect after loading
    const initialContent = provider ? undefined : (content || '')
    
    const editor = useEditor({
      extensions: [
        StarterKit.configure({
          history: true, // Enable history for plain mode
        }),
        Highlight,
        Underline,
        Annotation,
        CollapsibleBlock,
        Placeholder.configure({
          placeholder: placeholder || 'Start typing...',
        }),
      ],
      content: initialContent,
      editable: isEditable, // Use the prop value instead of hardcoding true
      autofocus: isEditable ? 'end' : false, // Auto-focus at end if editable
      immediatelyRender: false, // Prevent immediate render to avoid content loss
      onCreate: ({ editor }) => {
        debugLog('TiptapEditorPlain', 'EDITOR_CREATED', {
          noteId,
          panelId,
          contentPreview: initialContent ? createContentPreview(initialContent) : undefined,
          metadata: { initialContentType: typeof initialContent }
        })
        // Register ProseMirror plugins
        debugLog('TiptapEditorPlain', 'EDITOR_CREATE_CONFIG', {
          noteId,
          panelId,
          contentPreview: initialContent ? createContentPreview(initialContent) : undefined,
          metadata: {
            isEditable,
            autofocus: isEditable ? 'end' : false,
            initialContentType: typeof initialContent
          }
        })
        // Browser detection for compatibility
        
        // WebKit-specific fix FIRST to handle clicks before other plugins
        // Register WebKit-specific fix
        try {
          const plugin = WebKitAnnotationCursorFix()
          editor.registerPlugin(plugin)
          // WebKitAnnotationCursorFix registered
        } catch (error) {
          console.error('[TiptapEditorPlain] Failed to register WebKitAnnotationCursorFix:', error)
        }
        
        // Use direct DOM listener with CAPTURE phase (based on patch solution)
        // Attach hover icon with capture phase
        
        // Initialize tooltip first
        initializeTooltip()
        
        // Attach the hover icon using capture phase for edit mode reliability
        const hoverIcon = attachHoverIcon({
          view: editor.view,
          annotationSelector: '.annotation',
          offset: 8,            // Very close to text (overlapping)
          editingOffset: 12,    // Still close in edit mode
          hideWhileTyping: true // Fade during typing
        })
        
        // Connect hover icon to tooltip
        let tooltipTimeout: NodeJS.Timeout | null = null
        
        hoverIcon.element.addEventListener('mouseenter', () => {
          // Small delay before showing tooltip to allow clicking
          tooltipTimeout = setTimeout(() => {
            const branchId = hoverIcon.element.getAttribute('data-branch-id')
            const type = hoverIcon.element.getAttribute('data-annotation-type') || 'note'
            
            if (branchId) {
              // Show tooltip for branch
              showAnnotationTooltip(branchId, type, hoverIcon.element)
            }
          }, 300) // 300ms delay allows time to click
        })
        
        hoverIcon.element.addEventListener('mouseleave', () => {
          // Cancel tooltip if leaving quickly (allows click)
          if (tooltipTimeout) {
            clearTimeout(tooltipTimeout)
            tooltipTimeout = null
          }
          debugLog('TiptapEditorPlain', 'HIDE_TOOLTIP', {
          noteId,
          panelId,
          metadata: { reason: 'hover leave' }
        })
          hideAnnotationTooltipSoon()
        })
        
        // Click handler to open panel
        hoverIcon.element.addEventListener('click', (e) => {
          e.stopPropagation()
          e.preventDefault()
          
          // Cancel tooltip timeout on click
          if (tooltipTimeout) {
            clearTimeout(tooltipTimeout)
            tooltipTimeout = null
          }
          
          const branchId = hoverIcon.element.getAttribute('data-branch-id')
          if (branchId) {
            debugLog('TiptapEditorPlain', 'OPEN_BRANCH_PANEL', {
          noteId,
          panelId,
          metadata: { branchId }
        })
            window.dispatchEvent(new CustomEvent('create-panel', { 
              detail: { panelId: branchId } 
            }))
            
            // Hide tooltip after opening panel
            hideAnnotationTooltipSoon()
          }
        })
        
        // Store cleanup function
        editor.on('destroy', () => {
          // Clean up hover icon
          hoverIcon.destroy()
        })
        
        // KEEP DISABLED: Old Safari-specific plugins that interfere
        // - SafariProvenFix: deprecated webkitUserModify property causes issues  
        // - SafariManualCursorFix: interferes with natural clicks
        // editor.registerPlugin(SafariProvenFix())
        // editor.registerPlugin(SafariManualCursorFix(isEditableRef))
        
        editor.registerPlugin(PerformanceMonitor())
        editor.registerPlugin(AnnotationStartBoundaryFix())
        editor.registerPlugin(AnnotationArrowNavigationFix())
        editor.registerPlugin(ReadOnlyGuard(isEditableRef))
        // Note: ClearStoredMarksAtBoundary not needed since we're using default inclusive behavior
        
        // DISABLED: Do not clear content in onCreate as it interferes with async loading
        // Content is managed by the loadedContent state and provider
        // if (!isContentLoading && !provider) {
        //   const currentContent = editor.getHTML()
        //   if (!currentContent || currentContent === '<p></p>' || currentContent.trim() === '') {
        //     editor.commands.clearContent()
        //   }
        // }
        
        // Auto-focus if editable and content is empty or placeholder
        // But only if we're not loading content from provider
        if (isEditable && !isContentLoading) {
          const text = editor.getText()
          const isEmptyOrPlaceholder = !text || 
            text.includes('Start writing your note') ||
            text.includes('Start writing your explore') ||
            text.includes('Start writing your promote')
          
          if (isEmptyOrPlaceholder) {
            // Auto-focus empty/placeholder panel
            setTimeout(() => {
              // Only focus, don't clear content
              editor.commands.focus('end')
            }, 200)
          }
        }
      },
      onUpdate: ({ editor }) => {
        const json = editor.getJSON()
        const isEmptyDoc = providerContentIsEmpty(provider, json)

        if (!hasHydratedRef.current) {
          if (isEmptyDoc) {
            return
          }
          hasHydratedRef.current = true
        }

        const pendingKey = `pending_save_${noteId}_${panelId}`
        if (typeof window !== 'undefined') {
          try {
            let providerVersion = 0
            if (provider) {
              try {
                providerVersion = provider.getDocumentVersion(noteId, panelId)
              } catch {}
            }
            window.localStorage.setItem(pendingKey, JSON.stringify({
              content: json,
              timestamp: Date.now(),
              noteId,
              panelId,
              version: providerVersion,
            }))
          } catch (err) {
            console.warn('[TiptapEditorPlain] Failed to persist pending snapshot during update:', err)
          }
        }

        // Hash current content to detect real changes
        const contentStr = JSON.stringify(json)
        ;(window as any).__lastContentHash = (window as any).__lastContentHash || new Map()
        const key = `${noteId}:${panelId}`
        const prev = (window as any).__lastContentHash.get(key)
        if (prev === contentStr) return
        (window as any).__lastContentHash.set(key, contentStr)

        // CRITICAL: Don't save empty content if we're still loading
        if (isContentLoading) {
          // Skip save - still loading content
          return
        }

        // Log when we're about to save empty content
        if (isEmptyDoc) {
          console.warn(`[TiptapEditorPlain-${panelId}] WARNING: Saving empty content for note ${noteId}, panel ${panelId}`)
          debugLog('TiptapEditorPlain', 'EMPTY_CONTENT_SAVE', {
            noteId,
            panelId,
            contentPreview: createContentPreview(json),
            metadata: { 
              isLoading: isContentLoading,
              hasLoadedContent: !!loadedContent,
              trigger: 'onUpdate'
            }
          })
        }

        // Store the latest content globally for emergency saves
        ;(window as any).__latestContent = (window as any).__latestContent || new Map()
        ;(window as any).__latestContent.set(key, json)
        
        // Debounce saves to reduce version churn
        ;(window as any).__debouncedSave = (window as any).__debouncedSave || new Map()
        const existing = (window as any).__debouncedSave.get(key)
        if (existing) clearTimeout(existing)
        const timer = setTimeout(() => {
          if (provider && noteId) {
            // Skip batching for document saves to ensure timely persistence
            provider.saveDocument(noteId, panelId, json, false, { skipBatching: true })
              .catch(err => {
                console.error('[TiptapEditorPlain] Failed to save content:', err)
              })
          }
          onUpdate?.(json)
        }, 300) // Reduced to 300ms for faster saves
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
      // IMPORTANT: Don't recreate editor when noteId changes
      // We'll update content via useEffect instead
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
        // Removed handleClick to allow normal text editing when clicking annotations
        // The branch window will only open via the hover icon click
        // handleClick: (view, pos, event) => {
        //   const target = event.target as HTMLElement
        //   if (target.classList.contains('annotation') || target.closest('.annotation')) {
        //     const annotationElement = target.classList.contains('annotation') ? target : target.closest('.annotation') as HTMLElement
        //     const branchId = annotationElement.getAttribute('data-branch') || annotationElement.getAttribute('data-branch-id')
        //     
        //     if (branchId) {
        //       window.dispatchEvent(new CustomEvent('create-panel', { detail: { panelId: branchId } }))
        //     }
        //     
        //     return true
        //   }
        //   return false
        // },
      },
    })
    
    // Save content before browser unload or visibility change
    useEffect(() => {
      const saveCurrentContent = async (isSync = false) => {
        if (editor && provider && noteId) {
          const key = `${noteId}:${panelId}`
          const pendingSave = (window as any).__debouncedSave?.get(key)
          if (pendingSave) {
            clearTimeout(pendingSave)
            ;(window as any).__debouncedSave.delete(key)
          }
          
          const json = editor.getJSON()
          
          // Always save to localStorage synchronously as backup
          const pendingKey = `pending_save_${noteId}_${panelId}`
          try {
            localStorage.setItem(pendingKey, JSON.stringify({
              content: json,
              timestamp: Date.now(),
              noteId,
              panelId
            }))
          } catch (e) {
            console.warn('[TiptapEditorPlain] Failed to save to localStorage:', e)
          }
          
          if (!isSync) {
            // For visibilitychange, we can await the async save
            try {
              await provider.saveDocument(noteId, panelId, json, false, { skipBatching: true })
            } catch (err) {
              console.error('[TiptapEditorPlain] Failed to save content:', err)
            }
          } else {
            // For beforeunload, fire and forget (browser won't wait)
            provider.saveDocument(noteId, panelId, json, false, { skipBatching: true }).catch(() => {
              // Keep localStorage backup if save fails
            })
          }
          
          // Flush any pending batch operations
          if ('batchManager' in provider && provider.batchManager) {
            (provider.batchManager as any).flushAll?.()
          }
        }
      }
      
      // visibilitychange fires earlier and allows async operations
      const handleVisibilityChange = () => {
        if (document.visibilityState === 'hidden') {
          saveCurrentContent(false) // async save
        }
      }
      
      // beforeunload as last resort (sync localStorage only)
      const handleBeforeUnload = () => {
        saveCurrentContent(true) // sync localStorage save
      }
      
      document.addEventListener('visibilitychange', handleVisibilityChange)
      window.addEventListener('beforeunload', handleBeforeUnload)
      
      return () => {
        document.removeEventListener('visibilitychange', handleVisibilityChange)
        window.removeEventListener('beforeunload', handleBeforeUnload)
      }
    }, [editor, provider, noteId, panelId])
    
    // REMOVED: Complex note switching cleanup - not needed with simplified approach
    // The provider handles saving through the onUpdate handler with debouncing

    // Update editable state when prop changes
    useEffect(() => {
      // Update the ref for the read-only guard
      isEditableRef.current = isEditable
      // Update the editor's editable state
      if (editor) {
        // Update editable state
        editor.setEditable(isEditable)
        // Auto-focus when becoming editable
        if (isEditable) {
          // Small delay to ensure DOM is ready
          setTimeout(() => {
            editor.commands.focus('end')
          }, 100)
        }
      }
    }, [isEditable, editor])

    // Update editor content when loaded content changes
    useEffect(() => {
      // Content update effect triggered
      
      if (editor && loadedContent && !isContentLoading) {
        debugLog('TiptapEditorPlain', 'APPLY_LOADED_CONTENT', {
          noteId,
          panelId,
          hasPending: !!pendingPromotionRef.current,
          isString: typeof loadedContent === 'string'
        })
        // Use a slight delay to ensure editor is fully ready
        setTimeout(() => {
          if (editor && !editor.isDestroyed) {
            const beforeContent = editor.getJSON()
            
            editor.commands.setContent(loadedContent, false)
            // Force a view update
            editor.view.updateState(editor.view.state)
            
            const afterContent = editor.getJSON()

            const treatedAsPreview = fallbackSourceRef.current === 'preview'
            const appliedIsEmpty = providerContentIsEmpty(provider, loadedContent)
            if (!treatedAsPreview && !appliedIsEmpty) {
              hasHydratedRef.current = true
            } else if (treatedAsPreview) {
              hasHydratedRef.current = false
            }
            
            debugLog('TiptapEditorPlain', 'CONTENT_SET_IN_EDITOR', {
              noteId,
              panelId,
              contentPreview: createContentPreview(afterContent),
              metadata: { 
                beforeEmpty: !beforeContent.content || beforeContent.content.length === 0,
                afterEmpty: !afterContent.content || afterContent.content.length === 0,
                success: true
              }
            })
          } else {
            // Editor destroyed, cannot set content
          }
        }, 0) // Match example: 0ms delay
      } else {
        // Skip content update - conditions not met
      }
    }, [editor, loadedContent, isContentLoading, panelId, noteId]) // Added noteId to dependencies

    // Fix #2 & #5: Handle content updates with composite key awareness
    // CRITICAL: Only use fallback content if we DON'T have a provider
    // If we have a provider, content should ONLY come from loadedContent
    useEffect(() => {
      // NEVER use fallback content when we have a provider
      if (provider) return
      
      if (editor && !isContentLoading && !loadedContent && content !== undefined && content !== '') {
        const currentJSON = editor.getJSON()
        const newContent = typeof content === 'string' 
          ? { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: content }] }] }
          : content
        
        // Only update if content actually changed and is not empty
        const isEmpty = !newContent.content || newContent.content.length === 0 ||
          (newContent.content.length === 1 && newContent.content[0].type === 'paragraph' && !newContent.content[0].content)
        
        if (!isEmpty && JSON.stringify(currentJSON) !== JSON.stringify(newContent)) {
          // Set fallback content (no provider mode)
          editor.commands.setContent(newContent)
        }
      }
    }, [editor, content, isContentLoading, loadedContent, provider, panelId])

    // Add styles for annotations and decorations (same as Yjs version)
    useEffect(() => {
      if (typeof window === 'undefined') return
      
      const style = document.createElement('style')
      style.textContent = `
        .tiptap-editor .annotation {
          background: linear-gradient(135deg, #ffeaa7 0%, #fab1a0 100%);
          padding: 1px 2px; /* Minimal padding to avoid issues */
          border-radius: 2px;
          cursor: text !important;
          /* position: relative; REMOVED - causes Safari cursor bug */
          transition: background 0.2s ease;
          font-weight: 600;
          border-bottom: 1px solid transparent;
          
          /* Keep inline-block for proper rendering */
          display: inline-block !important;
          vertical-align: baseline;
          line-height: inherit;
          
          /* Safari-specific fixes */
          /* -webkit-user-modify: read-write-plaintext-only; REMOVED - deprecated and can interfere */
          -webkit-user-select: text;
          user-select: text;
          caret-color: auto;
        }
        
        .tiptap-editor .annotation:hover {
          /* transform: translateY(-1px); REMOVED - causes Safari cursor bug */
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
          /* position: relative; REMOVED - causes Safari cursor bug */
          display: inline-block;
        }
        
        .tiptap-editor .annotation-hover-target.annotation-hovered {
          /* transform: translateY(-2px) scale(1.02); REMOVED - causes Safari cursor bug */
          filter: brightness(1.1);
          /* z-index: 10; REMOVED - creates stacking context */
        }
        
        .tiptap-editor .annotation-hover-target.annotation-clicked {
          /* animation: annotationClick 0.3s ease-out; REMOVED - uses transform */
        }
        
        /* Simple decoration for annotations without interference */
        .tiptap-editor .annotation-decorated {
          /* Visual indication without affecting cursor placement */
          border-bottom: 2px dotted rgba(255, 165, 0, 0.3);
        }
        
        /* Clean hover effect without icons or layout changes */
        .tiptap-editor .annotation:hover {
          /* Safe hover effects that don't break Safari or text layout */
          filter: brightness(1.15);
          box-shadow: 0 2px 8px rgba(0,0,0,0.1);
        }
        
        /* Different hover effects for different types */
        .tiptap-editor .annotation.annotation-note:hover {
          box-shadow: 0 2px 8px rgba(33, 150, 243, 0.3);
        }
        
        .tiptap-editor .annotation.annotation-explore:hover {
          box-shadow: 0 2px 8px rgba(255, 152, 0, 0.3);
        }
        
        .tiptap-editor .annotation.annotation-promote:hover {
          box-shadow: 0 2px 8px rgba(76, 175, 80, 0.3);
        }
        
        /* Animation removed - uses transform which causes Safari cursor bug
        @keyframes annotationClick {
          0% { transform: scale(1); }
          50% { transform: scale(0.95); }
          100% { transform: scale(1); }
        }
        */
        
        /* Tooltip styles with scrollbar support */
        .annotation-tooltip {
          position: fixed;
          background: white;
          border: 1px solid #e1e8ed;
          border-radius: 8px;
          padding: 12px;
          box-shadow: 0 4px 12px rgba(0,0,0,0.15);
          z-index: 10001;
          max-width: 300px;
          max-height: 400px;
          overflow-y: auto;
          overflow-x: hidden;
          opacity: 0;
          visibility: hidden;
          transition: opacity 0.2s ease, visibility 0.2s ease, transform 0.2s ease;
          transform: translateY(5px);
          pointer-events: none;
        }
        
        .annotation-tooltip::-webkit-scrollbar {
          width: 6px;
        }
        
        .annotation-tooltip::-webkit-scrollbar-track {
          background: #f1f1f1;
          border-radius: 3px;
        }
        
        .annotation-tooltip::-webkit-scrollbar-thumb {
          background: #888;
          border-radius: 3px;
        }
        
        .annotation-tooltip::-webkit-scrollbar-thumb:hover {
          background: #555;
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
          max-height: 200px;
          overflow-y: auto;
        }
        
        .annotation-tooltip .tooltip-footer {
          margin-top: 8px;
          padding-top: 8px;
          border-top: 1px solid #e1e8ed;
          font-size: 12px;
          color: #999;
        }
        
        .annotation-tooltip .tooltip-icon {
          font-size: 16px;
        }
        
        .annotation-tooltip.has-scroll .tooltip-content {
          padding-right: 4px;
          border-bottom: 1px solid #e1e8ed;
          margin-bottom: 4px;
        }
        
        /* Old hover icon styles - kept for compatibility */
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
        
        /* New overlay-based hover icon styles */
        .annotation-hover-icon-overlay {
          display: flex;
          align-items: center;
          justify-content: center;
        }
        
        .annotation-hover-icon-overlay:hover {
          background: #f7fafc !important;
          border-color: #cbd5e0 !important;
        }
        
        .annotation-hover-icon-overlay svg {
          width: 18px;
          height: 18px;
          stroke: #4a5568;
        }
        
        .annotation-hover-icon-overlay:hover svg {
          stroke: #2d3748;
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
          max-height: 400px; /* Set maximum height */
          overflow-y: auto; /* Enable vertical scrolling */
          overflow-x: hidden; /* Hide horizontal scroll */
          opacity: 0;
          visibility: hidden;
          transition: opacity 0.2s ease, visibility 0.2s ease, transform 0.2s ease;
          transform: translateY(5px);
          pointer-events: none;
        }
        
        /* Custom scrollbar styles for tooltip */
        .annotation-tooltip::-webkit-scrollbar {
          width: 6px;
        }
        
        .annotation-tooltip::-webkit-scrollbar-track {
          background: #f1f1f1;
          border-radius: 3px;
        }
        
        .annotation-tooltip::-webkit-scrollbar-thumb {
          background: #888;
          border-radius: 3px;
        }
        
        .annotation-tooltip::-webkit-scrollbar-thumb:hover {
          background: #555;
        }
        
        /* Aggressive WebKit-specific fixes for cursor visibility */
        .tiptap-editor:focus .annotation {
          cursor: text !important;
          -webkit-user-select: text !important;
          user-select: text !important;
        }
        
        /* Safari/WebKit-specific aggressive fixes */
        @supports (-webkit-appearance: none) {
          .tiptap-editor .annotation {
            -webkit-user-modify: read-write-plaintext-only;
            -webkit-user-select: text !important;
            -webkit-touch-callout: none;
            caret-color: black !important;
            -webkit-text-fill-color: initial !important;
          }
          
          /* Force cursor visibility in annotations */
          .tiptap-editor.cursor-in-annotation {
            caret-color: black !important;
          }
          
          /* Remove any pointer events that might interfere */
          .tiptap-editor .annotation::before,
          .tiptap-editor .annotation::after {
            pointer-events: none !important;
          }
        }
        
        /* Ensure proper focus outline in WebKit */
        .editor-focused {
          outline: none !important;
        }
        
        /* WebKit fix active state */
        .webkit-fix-active .annotation {
          -webkit-user-select: text !important;
          user-select: text !important;
          pointer-events: auto !important;
        }
        
        /* Force text cursor on all children of annotations */
        .tiptap-editor .annotation * {
          cursor: text !important;
        }
        
        /* Radical WebKit-only fixes */
        @media screen and (-webkit-min-device-pixel-ratio:0) {
          /* Safari/Chrome specific */
          .tiptap-editor .annotation {
            -webkit-user-modify: read-write !important;
            user-modify: read-write !important;
            -webkit-user-select: text !important;
            user-select: text !important;
            caret-color: black !important;
            color: inherit !important;
            -webkit-text-fill-color: currentColor !important;
          }
          
          /* Force caret visibility when focused */
          .tiptap-editor.webkit-focused .annotation {
            caret-color: black !important;
            animation: webkit-caret-fix 0.1s;
          }
          
          @keyframes webkit-caret-fix {
            0% { opacity: 0.99; }
            100% { opacity: 1; }
          }
          
          /* Remove all pseudo-elements that might interfere */
          .tiptap-editor .annotation::before,
          .tiptap-editor .annotation::after,
          .tiptap-editor .annotation::selection {
            background: transparent !important;
          }
        }
        
        .annotation-tooltip.visible {
          opacity: 1;
          visibility: visible;
          transform: translateY(0);
          pointer-events: auto; /* Important for scrolling */
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
          max-height: 250px; /* Ensure content area has height limit */
          overflow-y: auto; /* Allow content scrolling */
          overflow-x: hidden; /* Hide horizontal scroll */
          word-wrap: break-word; /* Break long words */
          padding-right: 8px; /* Add space for scrollbar */
        }
        
        /* Custom scrollbar for content area */
        .annotation-tooltip .tooltip-content::-webkit-scrollbar {
          width: 4px;
        }
        
        .annotation-tooltip .tooltip-content::-webkit-scrollbar-track {
          background: transparent;
        }
        
        .annotation-tooltip .tooltip-content::-webkit-scrollbar-thumb {
          background: #ccc;
          border-radius: 2px;
        }
        
        .annotation-tooltip .tooltip-content::-webkit-scrollbar-thumb:hover {
          background: #999;
        }
        
        /* Add fade indicator at bottom when scrollable */
        .annotation-tooltip.has-scroll::after {
          content: '';
          position: absolute;
          bottom: 0;
          left: 0;
          right: 0;
          height: 20px;
          background: linear-gradient(to bottom, transparent, white);
          pointer-events: none;
          border-radius: 0 0 8px 8px;
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

        /* Collapsible block animations */
        @keyframes collapsibleFadeIn {
          from {
            opacity: 0;
            transform: translateY(-10px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        .collapsible-block .content {
          animation: collapsibleFadeIn 0.2s ease;
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
        // Update the ref for read-only guard
        isEditableRef.current = editable
        // Actually update the editor's editable state
        if (editor) {
          editor.setEditable(editable)
        }
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
          case 'collapsibleBlock':
            fetch('/api/debug/log', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                component: 'TiptapEditorPlain',
                action: 'executeCommand:collapsibleBlock',
                metadata: {
                  noteId,
                  panelId,
                  command,
                },
              }),
            }).catch(() => {})
            editor.chain().focus().insertCollapsibleBlock().run()
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
      },
      setPerformanceMode: (enabled: boolean) => {
        // In performance mode, defer heavy operations
        if (editor) {
          // Disable/enable certain extensions or features
          // For now, just disable spell check and some rendering
          const editorElement = editor.view.dom as HTMLElement
          if (enabled) {
            editorElement.style.pointerEvents = 'none'
            editorElement.spellcheck = false
            // Could also disable certain plugins here
          } else {
            editorElement.style.pointerEvents = 'auto'
            editorElement.spellcheck = true
          }
        }
      }
    }), [editor, onUpdate, provider, noteId, panelId])

    // Show loading state
    if (isContentLoading && provider) {
      return (
        <div className="tiptap-editor-document" style={{ height: '100%' }}>
          <div className="tiptap-editor-loading">
            Loading content...
          </div>
        </div>
      )
    }

    return (
      <div className="tiptap-editor-document" style={{ height: '100%' }}>
        <div 
          className="tiptap-editor-content"
          style={{ flex: 1 }}
          onFocus={(e) => {
            const target = e.currentTarget.querySelector('[role="textbox"]') as HTMLElement
            if (target) {
              target.classList.add('plain-mode')
            }
          }}
          onBlur={(e) => {
            const target = e.currentTarget.querySelector('[role="textbox"]') as HTMLElement
            if (target) {
              target.classList.remove('plain-mode')
            }
          }}
        >
          <EditorContent editor={editor} style={{ height: '100%' }} />
        </div>
      </div>
    )
  }
)

TiptapEditorPlain.displayName = 'TiptapEditorPlain'

export default TiptapEditorPlain
