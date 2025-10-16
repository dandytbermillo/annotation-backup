// @ts-nocheck
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
import {
  CollapsibleBlockSelection,
  type CollapsibleBlockSelectionStorage,
  type CollapsibleSelectionSnapshot,
} from '@/lib/extensions/collapsible-block-selection'
import { AnnotationUpdater } from '@/lib/extensions/annotation-updater'
import { useEffect, useImperativeHandle, forwardRef, useState, useMemo, useRef, useCallback } from 'react'
import { useCanvas } from './canvas-context'
import { Mark, mergeAttributes } from '@tiptap/core'
import { Plugin, PluginKey } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import { DOMParser } from '@tiptap/pm/model'
// import { AnnotationDecorations } from './annotation-decorations'
// import { AnnotationDecorationsHoverOnly } from './annotation-decorations-hover-only' // Replaced with hover-icon.ts
// import { AnnotationDecorationsSimple } from './annotation-decorations-simple'
import { attachHoverIcon } from './hover-icon'
import { showAnnotationTooltip, hideAnnotationTooltipSoon, initializeTooltip } from './annotation-tooltip'
import { PerformanceMonitor } from './performance-decorations'
import { ClearStoredMarksAtBoundary } from './clear-stored-marks-plugin'
import { AnnotationStartBoundaryFix } from './annotation-start-boundary-fix'
import { WebKitAnnotationCursorFix } from './webkit-annotation-cursor-fix'
import { ensurePanelKey } from '@/lib/canvas/composite-id'
import { AnnotationArrowNavigationFix } from './annotation-arrow-navigation-fix'
// import { BrowserSpecificCursorFix } from './browser-specific-cursor-fix'
// import { WebKitAnnotationClickFix } from './webkit-annotation-click-fix'
// import { SafariInlineBlockFix } from './safari-inline-block-fix'
// import { SafariCursorFixFinal } from './safari-cursor-fix-final'
// import { SafariNotionFix } from './safari-notion-fix'
import { SafariProvenFix } from './safari-proven-fix'
import { SafariManualCursorFix } from './safari-manual-cursor-fix'
import { ReadOnlyGuard } from './read-only-guard'
import type { PlainOfflineProvider, ProseMirrorJSON, HtmlString } from '@/lib/providers/plain-offline-provider'
import { debugLog } from '@/lib/utils/debug-logger'
import { createContentPreview } from '@/lib/debug-logger'
import { extractPreviewFromContent } from '@/lib/utils/branch-preview'

const JSON_START_RE = /^\s*[\[{]/

const EMPTY_COLLAPSIBLE_SELECTION: CollapsibleSelectionSnapshot = {
  mode: 'none',
  anchor: null,
  head: null,
  blocks: [],
}

const trailingParagraphPluginKey = new PluginKey('plainTrailingParagraph')

const ensureTrailingParagraph = (view: EditorView) => {
  const state = view?.state
  if (!state) {
    return
  }

  const { doc, schema } = state
  const paragraphType = schema.nodes?.paragraph
  if (!paragraphType) {
    return
  }

  if (!doc || doc.childCount === 0) {
    return
  }

  const lastNode = doc.lastChild
  if (!lastNode) {
    return
  }

  if (lastNode.type === paragraphType && lastNode.content.size === 0) {
    return
  }

  const tr = state.tr.insert(doc.content.size, paragraphType.create())
  tr.setMeta('addToHistory', false)
  view.dispatch(tr)
}

const createTrailingParagraphPlugin = () =>
  new Plugin({
    key: trailingParagraphPluginKey,
    appendTransaction(transactions, oldState, newState) {
      if (!transactions.some(tr => tr.docChanged)) {
        return null
      }

      const { doc, schema } = newState
      const paragraphType = schema.nodes?.paragraph
      if (!paragraphType) {
        return null
      }
      if (!doc || doc.childCount === 0) {
        return null
      }

      const lastNode = doc.lastChild
      if (!lastNode) {
        return null
      }

      if (lastNode.type === paragraphType && lastNode.content.size === 0) {
        return null
      }

      const tr = newState.tr.insert(doc.content.size, paragraphType.create())
      tr.setMeta('addToHistory', false)
      return tr
    },
  })

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

/**
 * Canonize content to ProseMirrorJSON format
 * Handles both HTML strings and ProseMirrorJSON objects
 */
function canonizeDoc(
  content: ProseMirrorJSON | HtmlString | null | undefined,
  editor?: any
): ProseMirrorJSON | null {
  if (!content) return null

  // Already JSON
  if (typeof content === 'object' && content.type === 'doc') {
    return content as ProseMirrorJSON
  }

  // HTML string - convert to JSON
  if (typeof content === 'string') {
    if (!editor) {
      console.error('[Canonize] Editor required to parse HTML')
      return null
    }

    try {
      const tempDiv = document.createElement('div')
      tempDiv.innerHTML = content

      // CORRECT API: DOMParser.fromSchema
      const parser = DOMParser.fromSchema(editor.state.schema)
      const doc = parser.parse(tempDiv)
      return doc.toJSON() as ProseMirrorJSON
    } catch (err) {
      console.error('[Canonize] Failed to parse HTML:', err)
      return null
    }
  }

  console.warn('[Canonize] Unknown content type:', typeof content)
  return null
}

/**
 * Generate stable hash from content for fast comparison
 */
function hashContent(content: ProseMirrorJSON | null): string {
  if (!content) return ''

  const str = JSON.stringify(content)
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash
  }
  return hash.toString(36)
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
  onCollapsibleSelectionChange?: (snapshot: CollapsibleSelectionSnapshot) => void
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
  getCollapsibleSelection: () => CollapsibleSelectionSnapshot
  clearCollapsibleSelection: () => void
  insertAnnotation: (type: string, annotationId: string, branchId: string) => void
  setPerformanceMode?: (enabled: boolean) => void
}

const TiptapEditorPlain = forwardRef<TiptapEditorPlainHandle, TiptapEditorPlainProps>(
  ({ content, isEditable, noteId, panelId, onUpdate, onSelectionChange, onCollapsibleSelectionChange, placeholder, provider, onCreateAnnotation, onContentLoaded }, ref) => {
    // Get canvas context (optional - may not be available in all contexts)
    let canvasContext: ReturnType<typeof useCanvas> | null = null
    try {
      canvasContext = useCanvas()
    } catch {
      // Component used outside CanvasProvider, that's OK
    }

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
    const collapsibleSelectionRef = useRef<CollapsibleSelectionSnapshot>(EMPTY_COLLAPSIBLE_SELECTION)

    // Track last saved content (canonized to JSON)
    const lastSavedContentRef = useRef<ProseMirrorJSON | null>(null)
    const lastSavedHashRef = useRef<string>('')

    // STATE (not ref) for triggering auto-apply effect
    // Monotonic counter (not timestamp) to guarantee state change
    const [lastSaveTimestamp, setLastSaveTimestamp] = useState(0)

    // Track when we're applying remote updates (suppress onUpdate)
    const isApplyingRemoteUpdateRef = useRef(false)

    // Track pending remote updates blocked by unsaved changes
    const pendingRemoteUpdateRef = useRef<{
      content: ProseMirrorJSON
      version: number
      reason: string
    } | null>(null)

    // Track dismissed notifications
    const notificationDismissedRef = useRef(false)

    // Track notification state
    const [remoteUpdateNotification, setRemoteUpdateNotification] = useState<{
      message: string
      version: number
      hasRemoteUpdate: boolean
      saveError?: string
    } | null>(null)

    // Track notification position for dragging
    const [notificationPosition, setNotificationPosition] = useState({ x: 0, y: 8 })
    const notificationDragRef = useRef<{
      isDragging: boolean
      startX: number
      startY: number
      offsetX: number
      offsetY: number
    }>({ isDragging: false, startX: 0, startY: 0, offsetX: 0, offsetY: 0 })

    // Track if currently saving (prevent double-click)
    const [isSaving, setIsSaving] = useState(false)

    // Track if user has actually typed/edited (not just viewing)
    // This helps distinguish "uninitialized + viewing" from "uninitialized + typed"
    const hasUserEditedRef = useRef(false)

    // Track timestamp when user last edited (for conflict grace period - SECONDARY defense)
    const lastEditTimestampRef = useRef<number>(0)

    // PRIMARY DEFENSE: Track processed conflict versions to prevent duplicate handling
    // Maps panel-version to timestamp when processed
    const processedConflictVersionsRef = useRef<Map<string, number>>(new Map())

    // Track last successfully applied version (prevents processing older conflicts)
    const lastAppliedVersionRef = useRef<number>(0)

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
      hasUserEditedRef.current = false  // Reset edit tracking when content changes
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

      const storeKey = ensurePanelKey(noteId, panelId)
      const branchEntry = typeof window !== 'undefined'
        ? (window as any).canvasDataStore?.get?.(storeKey)
        : null

      provider.loadDocument(noteId, panelId).then(() => {
        if (!isActive) return

        let remoteContent: ProseMirrorJSON | string | null = null
        try {
          remoteContent = provider.getDocument(noteId, panelId)
        } catch {}

        // DEBUG: Cross-browser sync investigation
        console.log(`[🔍 SYNC-DEBUG] Editor loadDocument callback for ${panelId}`, {
          remoteContent: remoteContent ? 'HAS_CONTENT' : 'NULL',
          remoteContentPreview: remoteContent ? JSON.stringify(remoteContent).substring(0, 100) : 'NULL',
          branchEntryContent: branchEntry?.content ? 'HAS_SNAPSHOT' : 'NO_SNAPSHOT',
          providerVersion: provider.getDocumentVersion(noteId, panelId)
        })

        let resolvedContent: ProseMirrorJSON | string | null = remoteContent

        fallbackSourceRef.current = null
        previewFallbackContentRef.current = null

        const treatAsPlaceholder = branchEntry
          ? isPlaceholderDocument(resolvedContent, branchEntry)
          : false

        const needsFallback = !resolvedContent
          || providerContentIsEmpty(provider, resolvedContent)
          || treatAsPlaceholder

        // DEBUG: Cross-browser sync investigation
        console.log(`[🔍 SYNC-DEBUG] Fallback check for ${panelId}`, {
          needsFallback,
          reasons: {
            noContent: !resolvedContent,
            isEmpty: providerContentIsEmpty(provider, resolvedContent),
            isPlaceholder: treatAsPlaceholder
          }
        })

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

            // Track initial load (only if editor exists)
            if (editor) {
              const canonized = canonizeDoc(resolvedContent, editor)
              if (canonized) {
                lastSavedContentRef.current = canonized
                lastSavedHashRef.current = hashContent(canonized)
              }
            }

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

        // DEBUG: Cross-browser sync investigation
        console.log(`[🔍 SYNC-DEBUG] Setting editor content for ${panelId}`, {
          contentSource: fallbackSourceRef.current || 'remote',
          contentPreview: resolvedContent ? JSON.stringify(resolvedContent).substring(0, 100) : 'NULL',
          version: remoteVersion,
          willNotify: notifyLoad
        })

        setLoadedContent(resolvedContent)

        // Track initial load (only if editor exists)
        if (editor) {
          const canonized = canonizeDoc(resolvedContent, editor)
          if (canonized) {
            lastSavedContentRef.current = canonized
            lastSavedHashRef.current = hashContent(canonized)
          }
        }

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
    // Note: editor is NOT in dependencies - canonization calls are guarded with if(editor)

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
        AnnotationUpdater, // Provides updateAnnotationType command
        CollapsibleBlock,
        CollapsibleBlockSelection,
        Placeholder.configure({
          placeholder: placeholder || 'Start typing...',
        }),
      ],
      content: initialContent,
      editable: isEditable, // Use the prop value instead of hardcoding true
      autofocus: false, // Disable autofocus to prevent auto-scroll on load
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
            autofocus: false,
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
              detail: { panelId: branchId, noteId } 
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

        const trailingParagraphPlugin = createTrailingParagraphPlugin()
        editor.registerPlugin(trailingParagraphPlugin)
        ensureTrailingParagraph(editor.view)
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
            // Auto-focus empty/placeholder panel without scrolling
            setTimeout(() => {
              editor.commands.focus('start', { scrollIntoView: false })
            }, 200)
          }
        }

        // Register editor with canvas context for annotation updates
        if (canvasContext && panelId) {
          canvasContext.onRegisterActiveEditor?.(editor, panelId)
        }
      },
      onUpdate: ({ editor }) => {
        // CRITICAL: Skip during remote content updates
        if (isApplyingRemoteUpdateRef.current) {
          return
        }

        const json = editor.getJSON()
        const isEmptyDoc = providerContentIsEmpty(provider, json)

        if (!hasHydratedRef.current) {
          if (isEmptyDoc) {
            return
          }
          hasHydratedRef.current = true
        }

        // Mark that user has actually edited content (not just viewing)
        // CRITICAL: Only set this AFTER hydration is complete to avoid false positives
        // during initial content loading or automated plugin updates
        if (hasHydratedRef.current && !isContentLoading) {
          const wasEdited = hasUserEditedRef.current
          hasUserEditedRef.current = true
          lastEditTimestampRef.current = Date.now()

          // Debug: Log when this flag transitions from false to true
          if (!wasEdited) {
            debugLog({
              component: 'CrossBrowserSync',
              action: 'USER_EDIT_FLAG_SET',
              metadata: {
                noteId,
                panelId,
                hydrated: hasHydratedRef.current,
                loading: isContentLoading,
                applying: isApplyingRemoteUpdateRef.current,
                timestamp: lastEditTimestampRef.current
              }
            })
          }

          // Reset edit flag after period of inactivity (3 seconds)
          // This allows auto-save to complete and prevents flickering during active typing
          // but still clears the flag when user stops editing
          const timerKey = `${noteId}:${panelId}`
          ;(window as any).__editInactivityTimer = (window as any).__editInactivityTimer || new Map()
          const existingTimer = (window as any).__editInactivityTimer.get(timerKey)
          if (existingTimer) clearTimeout(existingTimer)

          const inactivityTimer = setTimeout(() => {
            if (hasUserEditedRef.current) {
              hasUserEditedRef.current = false
              debugLog({
                component: 'CrossBrowserSync',
                action: 'USER_EDIT_FLAG_RESET_INACTIVITY',
                metadata: { noteId, panelId, inactivityMs: 3000 }
              })
            }
          }, 3000) // 3 seconds of no typing = user stopped editing

          ;(window as any).__editInactivityTimer.set(timerKey, inactivityTimer)
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
              .then(() => {
                // Track successful save
                const canonized = canonizeDoc(json, editor)
                if (canonized) {
                  lastSavedContentRef.current = canonized
                  lastSavedHashRef.current = hashContent(canonized)

                  // Update state to trigger auto-apply (monotonic counter)
                  setLastSaveTimestamp(prev => prev + 1)

                  // DON'T reset edit flag after auto-save
                  // User might still be actively editing even though save completed
                  // Only reset when remote update is applied (in applyRemoteUpdateSafely)
                  // This prevents flickering notifications during active typing sessions

                  debugLog({
                    component: 'CrossBrowserSync',
                    action: 'SAVE_HASH_UPDATED',
                    metadata: { noteId, panelId, hash: lastSavedHashRef.current }
                  })
                }

                // Clear notification if no pending update
                if (remoteUpdateNotification?.hasRemoteUpdate && !pendingRemoteUpdateRef.current) {
                  setRemoteUpdateNotification(null)
                }
              })
              .catch(err => {
                console.error('[TiptapEditorPlain] Failed to save content:', err)
                // Don't swallow the error - let it propagate so conflict events can be handled
                // The provider already emitted document:conflict event if this was a conflict
              })
          }
          onUpdate?.(json)
        }, 300) // Reduced to 300ms for faster saves
        ;(window as any).__debouncedSave.set(key, timer)
      },
      onSelectionUpdate: ({ editor }) => {
        const { from, to } = editor.state.selection
        const text = editor.state.doc.textBetween(from, to, ' ')

        // Cancel any pending toolbar show on every selection update
        // This prevents toolbar from showing while user is still dragging
        const existingTimeout = (window as any).__toolbarShowTimeout
        if (existingTimeout) {
          clearTimeout(existingTimeout)
          ;(window as any).__toolbarShowTimeout = null
        }

        // Store current selection info for mouseup handler
        ;(window as any).__pendingSelection = {
          text: text.trim(),
          from,
          to,
          length: text.trim().length
        }

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
        // Prevent ProseMirror from auto-scrolling when content loads
        handleScrollToSelection: () => {
          // Return true to prevent default scroll behavior
          // This stops the editor from scrolling to the end when loading long notes
          return true
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

    // =============================================================================
    // CALLBACKS - Must be defined AFTER editor exists
    // =============================================================================

    /**
     * Check if local changes exist that haven't been saved
     */
    const hasUnsavedChanges = useCallback((): boolean => {
      if (!editor) return false

      try {
        const currentDoc = editor.getJSON()
        const currentCanonized = canonizeDoc(currentDoc, editor)
        if (!currentCanonized) return false

        const currentHash = hashContent(currentCanonized)
        const savedHash = lastSavedHashRef.current

        // CRITICAL: If tracking not initialized, check if user has actually typed
        // This prevents false positives when just viewing (no edits)
        // But protects data if user typed before initialization completed
        if (!savedHash || savedHash === '') {
          if (hasUserEditedRef.current) {
            // User typed before tracking initialized - PROTECT their work
            debugLog({
              component: 'CrossBrowserSync',
              action: 'CHECK_UNINITIALIZED_WITH_EDITS',
              metadata: { noteId, panelId, hasUserEdited: true, result: 'UNSAVED' }
            })
            return true  // ✅ SAFE: Block remote updates, protect user work
          } else {
            // Just viewing, no edits yet - safe to allow updates
            debugLog({
              component: 'CrossBrowserSync',
              action: 'CHECK_UNINITIALIZED_NO_EDITS',
              metadata: { noteId, panelId, hasUserEdited: false, result: 'SAVED' }
            })
            return false  // ✅ NO FALSE POSITIVE: Allow remote updates when just viewing
          }
        }

        const hasChanges = currentHash !== savedHash

        // CRITICAL: If user hasn't actually edited, trust that flag over hash comparison
        // Hash mismatches without user edits = plugin mutations (e.g., trailing-paragraph)
        // These should NOT block remote updates
        if (!hasUserEditedRef.current) {
          debugLog({
            component: 'CrossBrowserSync',
            action: 'HAS_UNSAVED_CHECK',
            metadata: {
              noteId,
              panelId,
              hasChanges,
              currentHash,
              savedHash,
              hasUserEdited: false,
              result: 'NO_USER_EDITS_ALLOW_UPDATE'
            }
          })
          return false  // ✅ NO FALSE POSITIVE: User hasn't typed, allow remote updates
        }

        debugLog({
          component: 'CrossBrowserSync',
          action: 'HAS_UNSAVED_CHECK',
          metadata: {
            noteId,
            panelId,
            hasChanges,
            currentHash,
            savedHash,
            hasUserEdited: hasUserEditedRef.current
          }
        })

        return hasChanges
      } catch (err) {
        console.error('[🔧 CHECK] Error checking unsaved changes:', err)
        return false
      }
    }, [editor, lastSaveTimestamp])

    /**
     * Apply remote content safely with suppression
     * @returns true if successful, false otherwise
     */
    const applyRemoteUpdateSafely = useCallback((
      remoteContent: ProseMirrorJSON,
      version: number,
      reason: string
    ): boolean => {
      if (!editor) {
        return false
      }

      debugLog({
        component: 'CrossBrowserSync',
        action: 'APPLY_START',
        metadata: { noteId, panelId, version, reason }
      })

      try {
        // Set suppression flag
        isApplyingRemoteUpdateRef.current = true

        // Apply the content
        editor.commands.setContent(remoteContent, false)

        // CRITICAL: Hash what TipTap actually rendered, not the raw input
        // TipTap plugins (e.g., trailing-paragraph) mutate the document after setContent()
        // If we hash the input, we'll have a mismatch with editor.getJSON()
        const actualContent = editor.getJSON()
        const canonizedActual = canonizeDoc(actualContent, editor) ?? remoteContent
        const newHash = hashContent(canonizedActual)

        debugLog({
          component: 'CrossBrowserSync',
          action: 'APPLY_HASH_UPDATE',
          metadata: {
            noteId,
            panelId,
            version,
            reason,
            remoteHash: hashContent(remoteContent),
            actualContentHash: hashContent(actualContent),
            canonizedHash: newHash,
            oldHash: lastSavedHashRef.current
          }
        })

        // Update tracking with what's ACTUALLY in the editor now
        lastSavedContentRef.current = canonizedActual
        lastSavedHashRef.current = newHash
        setLastSaveTimestamp(prev => prev + 1)

        // Track successfully applied version (prevents re-processing older conflicts)
        if (version > lastAppliedVersionRef.current) {
          lastAppliedVersionRef.current = version
        }

        // Reset edit flag - content is now synced with remote
        hasUserEditedRef.current = false

        debugLog({
          component: 'CrossBrowserSync',
          action: 'USER_EDIT_FLAG_RESET_APPLY',
          metadata: { noteId, panelId, version, reason }
        })

        // Clear pending update
        pendingRemoteUpdateRef.current = null

        // Clear notification
        setRemoteUpdateNotification(null)

        return true
      } catch (err) {
        console.error('[🔧 APPLY] Failed to apply remote content:', err)
        setRemoteUpdateNotification({
          message: `Failed to apply update: ${err instanceof Error ? err.message : 'Unknown error'}`,
          version,
          hasRemoteUpdate: false,
          saveError: String(err)
        })
        return false
      } finally {
        // Always clear suppression flag
        isApplyingRemoteUpdateRef.current = false
      }
    }, [editor])

    /**
     * Save current content then sync with remote
     */
    const handleSaveAndSync = useCallback(async () => {
      if (!editor || !provider || !noteId || isSaving) {
        return
      }

      setIsSaving(true)

      try {
        // Step 1: Get current content
        const currentJson = editor.getJSON()

        // Step 2: Save to database
        const versionBeforeSave = provider.getDocumentVersion(noteId, panelId)

        await provider.saveDocument(noteId, panelId, currentJson, false, { skipBatching: true })

        const versionAfterSave = provider.getDocumentVersion(noteId, panelId)

        // Step 3: Update tracking
        const canonized = canonizeDoc(currentJson, editor)
        if (canonized) {
          lastSavedContentRef.current = canonized
          lastSavedHashRef.current = hashContent(canonized)
          setLastSaveTimestamp(prev => prev + 1)
        }


        // Step 4: Check for remote updates using public API (fetches from DB, not cache)
        await provider.checkForRemoteUpdates(noteId, panelId)

        // Step 5: Get version after refresh (now fresh from database)
        const versionAfterRefresh = provider.getDocumentVersion(noteId, panelId)

        // Step 6: Compare versions
        if (versionAfterRefresh > versionAfterSave) {
          // Remote changes detected after our save

          // Get fresh content (now in cache after checkForRemoteUpdates)
          const freshContent = provider.getDocument(noteId, panelId)
          const freshCanonized = canonizeDoc(freshContent, editor)
          const freshHash = freshCanonized ? hashContent(freshCanonized) : ''
          const savedHash = lastSavedHashRef.current

          if (freshHash !== savedHash) {
            // Content differs - apply it
            applyRemoteUpdateSafely(
              freshCanonized!,
              versionAfterRefresh,
              'save-and-sync-detected-newer'
            )
          } else {
            setRemoteUpdateNotification(null)
          }
        } else {
          // No new changes, we're synced
          setRemoteUpdateNotification(null)
        }

      } catch (err) {
        console.error('[🔧 SAVE-SYNC] Save and sync failed:', err)
        setRemoteUpdateNotification({
          message: `Save failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
          version: provider.getDocumentVersion(noteId, panelId),
          hasRemoteUpdate: true,
          saveError: String(err)
        })
      } finally {
        setIsSaving(false)
      }
    }, [editor, provider, noteId, panelId, isSaving, applyRemoteUpdateSafely])

    /**
     * Discard local changes and sync with remote
     */
    const handleDiscardAndSync = useCallback(async () => {
      if (!editor || !provider || !noteId) {
        return
      }

      try {

        // Fetch fresh content
        const freshContent = await provider.getDocument(noteId, panelId)
        const freshVersion = provider.getDocumentVersion(noteId, panelId)


        // Apply it
        const canonized = canonizeDoc(freshContent, editor)
        if (canonized) {
          applyRemoteUpdateSafely(canonized, freshVersion, 'discard-and-sync')
        }

      } catch (err) {
        console.error('[🔧 DISCARD] Discard and sync failed:', err)
        setRemoteUpdateNotification({
          message: `Sync failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
          version: provider.getDocumentVersion(noteId, panelId),
          hasRemoteUpdate: true,
          saveError: String(err)
        })
      }
    }, [editor, provider, noteId, panelId, applyRemoteUpdateSafely])

    /**
     * Dismiss notification without syncing
     */
    const handleDismissNotification = useCallback(() => {
      notificationDismissedRef.current = true
      setRemoteUpdateNotification(null)
    }, [])

    /**
     * Initialize tracking when editor loads with content
     * Prevents false positives when switching browsers without editing
     * CRITICAL: Hash what's ACTUALLY in the editor after TipTap has processed it
     */
    useEffect(() => {
      if (!editor || !loadedContent) return

      // Only initialize if not already set
      if (lastSavedHashRef.current === '') {
        // CRITICAL: Get what TipTap actually rendered, not the raw loaded content
        // TipTap plugins (e.g., trailing-paragraph) mutate content after setContent()
        const actualContent = editor.getJSON()
        const canonized = canonizeDoc(actualContent, editor)
        if (canonized) {
          const newHash = hashContent(canonized)

          debugLog({
            component: 'CrossBrowserSync',
            action: 'INIT_HASH_SET',
            metadata: {
              noteId,
              panelId,
              loadedHash: hashContent(loadedContent),
              actualContentHash: hashContent(actualContent),
              canonizedHash: newHash
            }
          })

          lastSavedContentRef.current = canonized
          lastSavedHashRef.current = newHash
          hasUserEditedRef.current = false  // Reset edit flag - content is fresh from database
        }
      }
    }, [editor, loadedContent, noteId, panelId])

    useEffect(() => {
      if (!editor) {
        return
      }

      const storage = editor.storage?.collapsibleBlockSelection as CollapsibleBlockSelectionStorage | undefined
      const initialSnapshot = storage?.snapshot ?? EMPTY_COLLAPSIBLE_SELECTION
      collapsibleSelectionRef.current = initialSnapshot
      onCollapsibleSelectionChange?.(initialSnapshot)

      const handleSelectionChange = (snapshot: CollapsibleSelectionSnapshot) => {
        collapsibleSelectionRef.current = snapshot
        onCollapsibleSelectionChange?.(snapshot)
      }

      editor.on('collapsible-selection-change', handleSelectionChange)

      return () => {
        editor.off('collapsible-selection-change', handleSelectionChange)
      }
    }, [editor, onCollapsibleSelectionChange])

    // Handle document conflicts - update editor when remote version is newer
    useEffect(() => {
      if (!provider || !noteId || !panelId || !editor) return

      console.log(`[🔍 CONFLICT-RESOLUTION] Registering conflict listener for ${panelId}`, {
        noteId,
        panelId,
        hasProvider: !!provider,
        hasEditor: !!editor,
        providerInstanceId: (provider as any)?.instanceId,
        listenersBefore: provider?.listenerCount?.('document:conflict')
      })

      /**
       * ============================================================================
       * CONFLICT HANDLER - Cross-Browser Synchronization Safety
       * ============================================================================
       *
       * PURPOSE:
       * Handles document:conflict events when multiple browsers edit the same panel.
       * Prevents data loss while avoiding false positive notifications.
       *
       * ARCHITECTURE:
       *
       * 1. PRIMARY DEFENSE: Version-Based Deduplication
       *    - Tracks processed conflict versions in processedConflictVersionsRef
       *    - Prevents duplicate handling of the same conflict event
       *    - Ignores conflicts for versions already successfully applied
       *    - SAFE: Based on explicit version numbers, not timing assumptions
       *
       * 2. SECONDARY DEFENSE: Grace Period (Defense-in-Depth)
       *    - Defers conflicts within 2 seconds of user starting to type
       *    - Catches edge cases where version tracking might miss duplicates
       *    - LESS SAFE: Time-based, can ignore legitimate conflicts in theory
       *
       * 3. CONTENT VERIFICATION:
       *    - Checks if remote content matches current editor content (hash comparison)
       *    - Auto-resolves conflicts where content is actually identical
       *    - Updates tracking to prevent repeated checks
       *
       * KNOWN LIMITATIONS & TODOS:
       *
       * TODO: Root cause investigation
       *   - Why are duplicate conflict events firing in the first place?
       *   - Are they queued in PlainOfflineProvider?
       *   - Are they from visibility change polling?
       *   - Can we prevent duplicates at the source?
       *
       * TODO: Conflict resolution queue
       *   - Currently we defer/ignore conflicts, but don't queue them for retry
       *   - Should implement a proper conflict queue that rechecks after grace period
       *   - Risk: Deferred conflicts might never be rechecked if user keeps typing
       *
       * TODO: Monitoring & alerting
       *   - Add metrics for CONFLICT_GRACE_PERIOD_DEFERRED events
       *   - Alert if grace period is frequently triggered (might indicate legitimate conflicts being missed)
       *   - Track CONFLICT_DUPLICATE_IGNORED vs CONFLICT_STALE_VERSION_IGNORED ratios
       *
       * TODO: Version monotonicity enforcement
       *   - Verify versions always increase monotonically
       *   - Add warning if we see version numbers go backwards
       *   - Might indicate clock skew or race conditions
       *
       * SAFETY ASSESSMENT:
       * ✅ Safe: Version-based deduplication (exact version matching)
       * ✅ Safe: Stale version detection (comparing to lastAppliedVersion)
       * ⚠️  Risky: Grace period (can ignore legitimate conflicts within 2 seconds)
       * ✅ Safe: Content hash comparison (verifies actual content differences)
       *
       * TESTING:
       * - Use `node scripts/query-main-panel.js` to monitor conflict handling
       * - Look for CONFLICT_DUPLICATE_IGNORED (good - working as intended)
       * - Watch for CONFLICT_GRACE_PERIOD_DEFERRED (needs monitoring - might hide real conflicts)
       * - Verify CONFLICT_BLOCKED only appears for genuine conflicts
       */
      const handleConflict = (event: {
        noteId: string
        panelId: string
        message: string
        remoteVersion?: number
        remoteContent?: ProseMirrorJSON | HtmlString
      }) => {

        if (event.noteId !== noteId || event.panelId !== panelId) return

        if (!editor || editor.isDestroyed) {
          debugLog({
            component: 'CrossBrowserSync',
            action: 'CONFLICT_EDITOR_DESTROYED',
            metadata: { noteId, panelId, reason: 'editor_destroyed' }
          })
          return
        }

        let freshContent: ProseMirrorJSON | HtmlString | null = null
        try {
          freshContent = provider?.getDocument(noteId, panelId) || null
        } catch (err) {
          debugLog({
            component: 'CrossBrowserSync',
            action: 'CONFLICT_FETCH_ERROR',
            metadata: {
              noteId,
              panelId,
              error: err instanceof Error ? err.message : String(err)
            }
          })
          return
        }

        if (!freshContent) {
          debugLog({
            component: 'CrossBrowserSync',
            action: 'CONFLICT_NO_CONTENT',
            metadata: { noteId, panelId, reason: 'provider_returned_null' }
          })
          return
        }

        const canonizedFresh = canonizeDoc(freshContent, editor)
        if (!canonizedFresh) {
          debugLog({
            component: 'CrossBrowserSync',
            action: 'CONFLICT_CANONIZE_ERROR',
            metadata: { noteId, panelId, reason: 'canonization_failed' }
          })
          return
        }

        // CRITICAL: Check if content is actually different
        const freshHash = hashContent(canonizedFresh)
        const currentHash = lastSavedHashRef.current

        if (freshHash === currentHash) {
          debugLog({
            component: 'CrossBrowserSync',
            action: 'CONFLICT_RESOLVED_AUTO',
            metadata: {
              noteId,
              panelId,
              version: event.remoteVersion || 0,
              hash: freshHash
            }
          })
          return // EXIT - content is the same, no action needed
        }

        // ALSO check if user's CURRENT editor content already matches the fresh content
        // This handles stale conflict events that fire while user is typing
        const currentEditorDoc = editor.getJSON()
        const canonizedCurrent = canonizeDoc(currentEditorDoc, editor)
        if (canonizedCurrent) {
          const currentEditorHash = hashContent(canonizedCurrent)
          if (currentEditorHash === freshHash) {
            debugLog({
              component: 'CrossBrowserSync',
              action: 'CONFLICT_RESOLVED_ALREADY_MATCHES',
              metadata: {
                noteId,
                panelId,
                version: event.remoteVersion || 0,
                hash: freshHash,
                reason: 'user_content_matches_remote'
              }
            })
            // Update tracking to match current state
            lastSavedHashRef.current = freshHash
            lastSavedContentRef.current = canonizedCurrent
            return // EXIT - user's current content already matches remote
          }
        }

        const conflictVersion = event.remoteVersion || 0

        debugLog({
          component: 'CrossBrowserSync',
          action: 'CONFLICT_DIFFERS',
          metadata: {
            noteId,
            panelId,
            version: conflictVersion,
            freshHash,
            currentHash,
            lastAppliedVersion: lastAppliedVersionRef.current
          }
        })

        // ============================================================================
        // PRIMARY DEFENSE: Version-Based Deduplication
        // ============================================================================
        // Prevents processing the same conflict version multiple times
        // This is safer than time-based grace periods

        const versionKey = `${panelId}-${conflictVersion}`

        // 1. Check if we already processed this exact version
        if (processedConflictVersionsRef.current.has(versionKey)) {
          const processedAt = processedConflictVersionsRef.current.get(versionKey)!
          const timeSinceProcessed = Date.now() - processedAt

          debugLog({
            component: 'CrossBrowserSync',
            action: 'CONFLICT_DUPLICATE_IGNORED',
            metadata: {
              noteId,
              panelId,
              version: conflictVersion,
              timeSinceProcessed,
              reason: 'already_processed_this_version'
            }
          })

          return // EXIT - duplicate conflict event, safe to ignore
        }

        // 2. Check if this conflict is for an older version we already applied
        if (conflictVersion > 0 && conflictVersion <= lastAppliedVersionRef.current) {
          debugLog({
            component: 'CrossBrowserSync',
            action: 'CONFLICT_STALE_VERSION_IGNORED',
            metadata: {
              noteId,
              panelId,
              conflictVersion,
              lastAppliedVersion: lastAppliedVersionRef.current,
              reason: 'conflict_for_already_applied_version'
            }
          })

          return // EXIT - conflict is for an older version we already have
        }

        // ============================================================================
        // SECONDARY DEFENSE: Grace Period (Defense-in-Depth)
        // ============================================================================
        // Additional safety for edge cases where version tracking might miss something
        // This prevents showing notifications immediately after user starts typing

        const now = Date.now()
        const timeSinceLastEdit = now - lastEditTimestampRef.current
        const GRACE_PERIOD_MS = 2000 // 2 seconds

        if (hasUserEditedRef.current && timeSinceLastEdit < GRACE_PERIOD_MS) {
          debugLog({
            component: 'CrossBrowserSync',
            action: 'CONFLICT_GRACE_PERIOD_DEFERRED',
            metadata: {
              noteId,
              panelId,
              version: conflictVersion,
              timeSinceLastEdit,
              gracePeriodMs: GRACE_PERIOD_MS,
              reason: 'user_recently_started_typing'
            }
          })

          return // EXIT - user just started typing, defer conflict check
        }

        // ============================================================================
        // Mark this version as processed before showing notification
        // ============================================================================
        processedConflictVersionsRef.current.set(versionKey, Date.now())

        // Clean up old processed versions (keep last 50 to prevent memory leak)
        if (processedConflictVersionsRef.current.size > 50) {
          const entries = Array.from(processedConflictVersionsRef.current.entries())
          entries.sort((a, b) => a[1] - b[1]) // Sort by timestamp
          const toDelete = entries.slice(0, entries.length - 50)
          toDelete.forEach(([key]) => processedConflictVersionsRef.current.delete(key))
        }

        // CRITICAL: Check for unsaved changes (always active)
        if (hasUnsavedChanges()) {
          debugLog({
            component: 'CrossBrowserSync',
            action: 'CONFLICT_BLOCKED',
            metadata: {
              noteId,
              panelId,
              version: event.remoteVersion || 0,
              reason: 'unsaved_changes',
              hasUserEdited: hasUserEditedRef.current,
              message: event.message
            }
          })

          pendingRemoteUpdateRef.current = {
            content: canonizedFresh,
            version: event.remoteVersion || 0,
            reason: 'conflict resolution'
          }

          setRemoteUpdateNotification({
            message: 'Conflict detected. Save your work to resolve.',
            version: event.remoteVersion || 0,
            hasRemoteUpdate: true
          })

          notificationDismissedRef.current = false
          return // EXIT
        }

        // Safe to resolve

        const success = applyRemoteUpdateSafely(canonizedFresh, event.remoteVersion || 0, 'conflict resolution')

        if (success) {
          pendingRemoteUpdateRef.current = null
          notificationDismissedRef.current = false
        }
      }

      // Handle remote updates (when provider loads fresh content from database)
      const handleRemoteUpdate = (event: {
        noteId: string
        panelId: string
        version: number
        content: ProseMirrorJSON | HtmlString
        reason?: string
      }) => {
        // Log IMMEDIATELY to catch all calls
        debugLog({
          component: 'CrossBrowserSync',
          action: 'REMOTE_UPDATE_RECEIVED',
          metadata: {
            noteId: event.noteId,
            panelId: event.panelId,
            version: event.version,
            reason: event.reason,
            matchesThisPanel: event.noteId === noteId && event.panelId === panelId
          }
        })


        if (event.noteId !== noteId || event.panelId !== panelId) {
          return
        }

        if (!editor || editor.isDestroyed) {
          console.warn('[Remote Update] Editor destroyed')
          return
        }

        const canonizedRemote = canonizeDoc(event.content, editor)
        if (!canonizedRemote) {
          console.error('[Remote Update] Failed to canonize')
          return
        }

        // CRITICAL: Check if remote content is actually different
        const remoteHash = hashContent(canonizedRemote)
        const currentHash = lastSavedHashRef.current

        if (remoteHash === currentHash) {
          debugLog({
            component: 'CrossBrowserSync',
            action: 'REMOTE_UPDATE_IDENTICAL',
            metadata: {
              noteId,
              panelId,
              version: event.version,
              reason: event.reason,
              hash: remoteHash
            }
          })
          return // EXIT - content hasn't changed, nothing to do
        }

        debugLog({
          component: 'CrossBrowserSync',
          action: 'REMOTE_UPDATE_DIFFERS',
          metadata: {
            noteId,
            panelId,
            version: event.version,
            reason: event.reason,
            remoteHash,
            currentHash
          }
        })

        // CRITICAL: Check for unsaved changes (always active)
        if (hasUnsavedChanges()) {
          debugLog({
            component: 'CrossBrowserSync',
            action: 'REMOTE_UPDATE_BLOCKED',
            metadata: {
              noteId,
              panelId,
              version: event.version,
              reason: 'unsaved_changes',
              hasUserEdited: hasUserEditedRef.current
            }
          })

          pendingRemoteUpdateRef.current = {
            content: canonizedRemote,
            version: event.version,
            reason: event.reason || 'remote update'
          }

          setRemoteUpdateNotification({
            message: 'Remote changes available. Save your work to sync.',
            version: event.version,
            hasRemoteUpdate: true
          })

          notificationDismissedRef.current = false
          return // EXIT - don't touch editor
        }

        // Safe to apply
        debugLog({
          component: 'CrossBrowserSync',
          action: 'REMOTE_UPDATE_APPLYING',
          metadata: {
            noteId,
            panelId,
            version: event.version,
            reason: event.reason
          }
        })

        const success = applyRemoteUpdateSafely(canonizedRemote, event.version, event.reason || 'remote update')

        if (success) {
          pendingRemoteUpdateRef.current = null
          notificationDismissedRef.current = false
        }
      }

      // Listen for both conflict and remote update events
      provider.on('document:conflict', handleConflict)
      provider.on('document:remote-update', handleRemoteUpdate)

      // Cleanup listeners on unmount
      return () => {
        provider.off('document:conflict', handleConflict)
        provider.off('document:remote-update', handleRemoteUpdate)
      }
    }, [provider, noteId, panelId, editor, onContentLoaded])

    /**
     * Auto-apply pending remote updates after successful save
     * Uses state dependency to trigger
     */
    useEffect(() => {
      if (!pendingRemoteUpdateRef.current || !notificationDismissedRef.current) {
        return
      }

      if (hasUnsavedChanges()) {
        return // Still has unsaved changes
      }

      // Safe to apply now
      const pending = pendingRemoteUpdateRef.current

      const success = applyRemoteUpdateSafely(pending.content, pending.version, 'auto-apply after save')

      if (success) {
        pendingRemoteUpdateRef.current = null
        notificationDismissedRef.current = false
      }

      // STATE dependency triggers this effect after saves
    }, [lastSaveTimestamp, hasUnsavedChanges, applyRemoteUpdateSafely])

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
      const handleVisibilityChange = async () => {
        if (document.visibilityState === 'hidden') {
          // CRITICAL: Only save if there are actual unsaved changes
          // This prevents ghost saves when just viewing (no edits)
          if (hasUnsavedChanges()) {
            debugLog({
              component: 'CrossBrowserSync',
              action: 'VISIBILITY_SAVE_TRIGGERED',
              metadata: { noteId, panelId, reason: 'unsaved_changes_exist' }
            })
            saveCurrentContent(false) // async save
          } else {
            debugLog({
              component: 'CrossBrowserSync',
              action: 'VISIBILITY_SAVE_SKIPPED',
              metadata: { noteId, panelId, reason: 'no_unsaved_changes' }
            })
          }
        } else if (document.visibilityState === 'visible' && provider) {
          // Check for remote updates when page becomes visible
          debugLog({
            component: 'CrossBrowserSync',
            action: 'VISIBILITY_REFRESH',
            metadata: {
              noteId,
              panelId,
              hasUserEdited: hasUserEditedRef.current,
              isContentLoading,
              hasLastSavedHash: lastSavedHashRef.current !== ''
            }
          })

          try {
            // Force refresh from database to check for remote changes
            // This will emit document:remote-update if newer content is found
            await provider.checkForRemoteUpdates(noteId, panelId)
          } catch (err) {
            console.error('[TiptapEditorPlain] Failed to refresh on visibility:', err)
            debugLog({
              component: 'CrossBrowserSync',
              action: 'VISIBILITY_REFRESH_ERROR',
              metadata: {
                noteId,
                panelId,
                error: err instanceof Error ? err.message : String(err)
              }
            })
          }
        }
      }
      
      // beforeunload as last resort (sync localStorage only)
      const handleBeforeUnload = () => {
        // CRITICAL: Only save if there are actual unsaved changes
        // This prevents ghost saves when just viewing (no edits)
        if (hasUnsavedChanges()) {
          debugLog({
            component: 'CrossBrowserSync',
            action: 'BEFOREUNLOAD_SAVE_TRIGGERED',
            metadata: { noteId, panelId, reason: 'unsaved_changes_exist' }
          })
          saveCurrentContent(true) // sync localStorage save
        } else {
          debugLog({
            component: 'CrossBrowserSync',
            action: 'BEFOREUNLOAD_SAVE_SKIPPED',
            metadata: { noteId, panelId, reason: 'no_unsaved_changes' }
          })
        }
      }
      
      document.addEventListener('visibilitychange', handleVisibilityChange)
      window.addEventListener('beforeunload', handleBeforeUnload)
      
      return () => {
        document.removeEventListener('visibilitychange', handleVisibilityChange)
        window.removeEventListener('beforeunload', handleBeforeUnload)
      }
    }, [editor, provider, noteId, panelId, hasUnsavedChanges])

    // Mouse up handler to show toolbar after selection is complete
    useEffect(() => {
      if (!editor) return

      const handleMouseUp = () => {
        const pendingSelection = (window as any).__pendingSelection

        // Only show toolbar if we have a pending selection > 3 characters
        if (!pendingSelection || pendingSelection.length <= 3) {
          return
        }

        const view = editor.view

        try {
          const start = view.domAtPos(pendingSelection.from)
          const end = view.domAtPos(pendingSelection.to)
          const domRange = document.createRange()
          domRange.setStart(start.node, start.offset)
          domRange.setEnd(end.node, end.offset)

          // Get selection bounding rect for positioning
          const rect = domRange.getBoundingClientRect()

          // Mitigation 3: Cancel on keyboard events (copy, cut, typing, etc.)
          const cancelOnKeyboard = (e: KeyboardEvent) => {
            // Allow selection navigation keys (arrows, shift)
            if (e.key === 'Shift' || e.key.startsWith('Arrow')) {
              return
            }

            // Cancel toolbar for any other key (including Cmd+C, Cmd+X, typing, etc.)
            const timeoutId = (window as any).__toolbarShowTimeout
            if (timeoutId) {
              clearTimeout(timeoutId)
              ;(window as any).__toolbarShowTimeout = null
            }

            // Remove this listener after first key
            document.removeEventListener('keydown', cancelOnKeyboard)
          }

          // Mitigation 2: Delay showing toolbar to avoid interference with copy/paste
          const showToolbarDelayed = setTimeout(() => {
            // Remove keyboard listener since we're about to show
            document.removeEventListener('keydown', cancelOnKeyboard)

            // Verify selection still exists and has the same text
            const currentSelection = editor.state.selection
            const currentText = editor.state.doc.textBetween(
              currentSelection.from,
              currentSelection.to,
              ' '
            ).trim()

            if (currentText === pendingSelection.text && currentText.length > 3) {
              // Dispatch event to show toolbar above selection
              window.dispatchEvent(new CustomEvent('show-floating-toolbar-on-selection', {
                detail: {
                  x: rect.left + rect.width / 2,
                  y: rect.top - 10, // Position above selection
                  selectedText: pendingSelection.text,
                  autoOpenFormat: true // Auto-open format panel
                },
                bubbles: true
              }))
            }

            // Clear pending selection
            ;(window as any).__pendingSelection = null
          }, 200) // Mitigation 2: 200ms delay

          // Store timeout ID to allow cancellation
          ;(window as any).__toolbarShowTimeout = showToolbarDelayed

          // Add keyboard listener for cancellation
          document.addEventListener('keydown', cancelOnKeyboard)
        } catch (error) {
          console.warn('[TiptapEditorPlain] Could not show toolbar on selection:', error)
        }
      }

      // Listen on the editor's DOM element
      const editorElement = editor.view.dom
      editorElement.addEventListener('mouseup', handleMouseUp)

      return () => {
        editorElement.removeEventListener('mouseup', handleMouseUp)

        // Clear any pending timeout
        const timeoutId = (window as any).__toolbarShowTimeout
        if (timeoutId) {
          clearTimeout(timeoutId)
        }
      }
    }, [editor])

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

            // CRITICAL: Suppress onUpdate during initial content load to prevent unnecessary save
            isApplyingRemoteUpdateRef.current = true

            debugLog({
              component: 'CrossBrowserSync',
              action: 'LOAD_CONTENT_SUPPRESSION_START',
              metadata: {
                noteId,
                panelId,
                message: 'Suppressing onUpdate during initial load to prevent ghost save'
              }
            })

            editor.commands.setContent(loadedContent, false)
            // Force a view update
            editor.view.updateState(editor.view.state)
            ensureTrailingParagraph(editor.view)

            // CRITICAL: Wait for TipTap's onUpdate to fire before clearing suppression
            // TipTap fires onUpdate asynchronously after DOM updates
            // Use requestAnimationFrame to ensure we clear AFTER the update cycle completes
            requestAnimationFrame(() => {
              requestAnimationFrame(() => {
                // Double RAF ensures we're after both layout and paint
                isApplyingRemoteUpdateRef.current = false

                debugLog({
                  component: 'CrossBrowserSync',
                  action: 'LOAD_CONTENT_SUPPRESSION_END',
                  metadata: {
                    noteId,
                    panelId,
                    message: 'Suppression cleared after TipTap update cycle'
                  }
                })

                // Update hash tracking with the actual rendered content
                const actualContent = editor.getJSON()
                const canonized = canonizeDoc(actualContent as ProseMirrorJSON, editor)
                if (canonized) {
                  const newHash = hashContent(canonized)
                  lastSavedHashRef.current = newHash
                  lastSavedContentRef.current = canonized

                  debugLog({
                    component: 'CrossBrowserSync',
                    action: 'LOAD_HASH_INITIALIZED',
                    metadata: {
                      noteId,
                      panelId,
                      hash: newHash.substring(0, 8)
                    }
                  })
                }

                // Reset user edit flag since this is a fresh load
                hasUserEditedRef.current = false
              })
            })

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
          ensureTrailingParagraph(editor.view)
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

        div[data-collapsible-block][data-collapsible-selected="true"] {
          outline: 2px solid rgba(99, 102, 241, 0.55);
          outline-offset: 2px;
          border-radius: 12px;
          background: rgba(99, 102, 241, 0.08);
        }

        div[data-collapsible-block][data-collapsible-selected="true"] [data-collapsible-header] {
          background: rgba(99, 102, 241, 0.12);
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
          case 'collapsible:collapse':
            editor.chain().focus().collapseSelectedCollapsibleBlocks().run()
            break
          case 'collapsible:expand':
            editor.chain().focus().expandSelectedCollapsibleBlocks().run()
            break
          case 'collapsible:delete':
            editor.chain().focus().deleteSelectedCollapsibleBlocks().run()
            break
          case 'collapsible:duplicate':
            if (editor.commands.duplicateSelectedCollapsibleBlocks) {
              editor.chain().focus().duplicateSelectedCollapsibleBlocks().run()
            }
            break
          case 'collapsible:clearSelection':
            editor.chain().focus().clearCollapsibleBlockSelection().run()
            break
        }
      },
      getCollapsibleSelection: () => collapsibleSelectionRef.current,
      clearCollapsibleSelection: () => {
        if (!editor) return
        editor.commands.clearCollapsibleBlockSelection()
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

    const editorWrapperRef = useRef<HTMLDivElement | null>(null)

    useEffect(() => {
      if (!editor || !editorWrapperRef.current) {
        return
      }

      const wrapper = editorWrapperRef.current

      const handlePointerDown = (event: MouseEvent) => {
        if (event.button !== 0) return
        if (event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) return

        const target = event.target as Element | null
        if (!target) return

        if (
          target.closest('[data-collapsible-header]') ||
          target.closest('[data-collapsible-actions]') ||
          target.closest('[data-preview-icon]') ||
          target.closest('[data-collapsible-arrow]') ||
          target.closest('[data-multi-selection-actions]') ||
          target.closest('button')
        ) {
          return
        }

        const snapshot = (editor.storage as any)?.collapsibleBlockSelection?.snapshot ?? null
        if (snapshot?.blocks?.length) {
          editor.commands.clearCollapsibleBlockSelection()
          debugLog('CollapsibleBlockSelection', 'EDITOR_POINTER_CLEAR', {
            metadata: { targetTag: target.tagName },
          })
        }
      }

      wrapper.addEventListener('pointerdown', handlePointerDown, true)
      return () => {
        wrapper.removeEventListener('pointerdown', handlePointerDown, true)
      }
    }, [editor])

    // Notification drag handlers
    const handleNotificationMouseDown = useCallback((e: React.MouseEvent) => {
      // Only allow dragging from the notification header area (not buttons)
      if ((e.target as HTMLElement).tagName === 'BUTTON') return

      notificationDragRef.current = {
        isDragging: true,
        startX: e.clientX,
        startY: e.clientY,
        offsetX: notificationPosition.x,
        offsetY: notificationPosition.y
      }
      e.preventDefault()
    }, [notificationPosition])

    const handleNotificationMouseMove = useCallback((e: MouseEvent) => {
      if (!notificationDragRef.current.isDragging) return

      const deltaX = e.clientX - notificationDragRef.current.startX
      const deltaY = e.clientY - notificationDragRef.current.startY

      setNotificationPosition({
        x: notificationDragRef.current.offsetX + deltaX,
        y: notificationDragRef.current.offsetY + deltaY
      })
    }, [])

    const handleNotificationMouseUp = useCallback(() => {
      notificationDragRef.current.isDragging = false
    }, [])

    // Add/remove mouse event listeners for dragging
    useEffect(() => {
      if (remoteUpdateNotification?.hasRemoteUpdate) {
        document.addEventListener('mousemove', handleNotificationMouseMove)
        document.addEventListener('mouseup', handleNotificationMouseUp)
        return () => {
          document.removeEventListener('mousemove', handleNotificationMouseMove)
          document.removeEventListener('mouseup', handleNotificationMouseUp)
        }
      }
    }, [remoteUpdateNotification?.hasRemoteUpdate, handleNotificationMouseMove, handleNotificationMouseUp])

    // Show loading state
    if (isContentLoading && provider) {
      return (
        <div
          className="tiptap-editor-document"
          style={{ height: '100%' }}
          ref={editorWrapperRef}
        >
          <div className="tiptap-editor-loading">
            Loading content...
          </div>
        </div>
      )
    }

    return (
      <div
        className="tiptap-editor-document"
        style={{ height: '100%', position: 'relative' }}
        ref={editorWrapperRef}
      >
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

        {/* Remote Update Notification Banner */}
        {remoteUpdateNotification?.hasRemoteUpdate && (
          <div
            onMouseDown={handleNotificationMouseDown}
            style={{
              position: 'absolute',
              top: notificationPosition.y,
              right: notificationPosition.x === 0 ? 8 : undefined,
              left: notificationPosition.x !== 0 ? notificationPosition.x : undefined,
              maxWidth: 400,
              background: remoteUpdateNotification.saveError ? '#fee2e2' : '#fef3c7',
              border: `1px solid ${remoteUpdateNotification.saveError ? '#ef4444' : '#f59e0b'}`,
              borderRadius: 8,
              padding: '12px 16px',
              fontSize: 13,
              zIndex: 1000,
              boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
              cursor: notificationDragRef.current.isDragging ? 'grabbing' : 'grab',
              userSelect: 'none',
            }}
          >
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
              <span style={{
                color: remoteUpdateNotification.saveError ? '#991b1b' : '#92400e',
                flex: 1,
                lineHeight: 1.4
              }}>
                {remoteUpdateNotification.saveError ? '❌' : '⚠️'} {remoteUpdateNotification.message}
              </span>
              <button
                onClick={handleDismissNotification}
                title="Remind me later"
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: remoteUpdateNotification.saveError ? '#991b1b' : '#92400e',
                  cursor: 'pointer',
                  fontSize: 18,
                  padding: 0,
                  lineHeight: 1,
                  opacity: 0.6,
                }}
                onMouseOver={(e) => (e.currentTarget.style.opacity = '1')}
                onMouseOut={(e) => (e.currentTarget.style.opacity = '0.6')}
              >
                ×
              </button>
            </div>

            {/* Error details */}
            {remoteUpdateNotification.saveError && (
              <div style={{
                fontSize: 11,
                color: '#7f1d1d',
                backgroundColor: '#fca5a5',
                padding: '6px 8px',
                borderRadius: 4,
                fontFamily: 'monospace',
              }}>
                {remoteUpdateNotification.saveError}
              </div>
            )}

            {/* Action buttons */}
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={handleSaveAndSync}
                disabled={isSaving}
                style={{
                  background: isSaving ? '#d1d5db' : (remoteUpdateNotification.saveError ? '#ef4444' : '#f59e0b'),
                  color: isSaving ? '#6b7280' : 'white',
                  border: 'none',
                  borderRadius: 4,
                  padding: '6px 12px',
                  fontSize: 12,
                  cursor: isSaving ? 'not-allowed' : 'pointer',
                  fontWeight: 500,
                  flex: 1,
                  transition: 'all 0.2s',
                  opacity: isSaving ? 0.7 : 1,
                }}
                onMouseOver={(e) => {
                  if (!isSaving) {
                    e.currentTarget.style.transform = 'scale(1.02)'
                    e.currentTarget.style.opacity = '0.95'
                  }
                }}
                onMouseOut={(e) => {
                  if (!isSaving) {
                    e.currentTarget.style.transform = 'scale(1)'
                    e.currentTarget.style.opacity = '1'
                  }
                }}
              >
                {isSaving ? '⏳ Saving...' : (remoteUpdateNotification.saveError ? '🔄 Retry Save & Sync' : 'Save & Sync')}
              </button>
              <button
                onClick={handleDiscardAndSync}
                style={{
                  background: 'transparent',
                  color: remoteUpdateNotification.saveError ? '#991b1b' : '#92400e',
                  border: `1px solid ${remoteUpdateNotification.saveError ? '#ef4444' : '#f59e0b'}`,
                  borderRadius: 4,
                  padding: '6px 12px',
                  fontSize: 12,
                  cursor: 'pointer',
                  flex: 1,
                  transition: 'all 0.2s',
                }}
                onMouseOver={(e) => {
                  e.currentTarget.style.background = remoteUpdateNotification.saveError ? '#fef2f2' : '#fffbeb'
                }}
                onMouseOut={(e) => {
                  e.currentTarget.style.background = 'transparent'
                }}
              >
                Discard & Sync
              </button>
            </div>

            {/* Version info */}
            <div style={{
              fontSize: 10,
              color: remoteUpdateNotification.saveError ? '#991b1b' : '#92400e',
              opacity: 0.6,
            }}>
              Remote version: {remoteUpdateNotification.version}
            </div>
          </div>
        )}
      </div>
    )
  }
)

TiptapEditorPlain.displayName = 'TiptapEditorPlain'

export default TiptapEditorPlain
