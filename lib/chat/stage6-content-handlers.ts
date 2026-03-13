/**
 * Stage 6 Content Extension: Content Tool Handlers (Slice 6x.2)
 *
 * Read-only content-retrieval handlers for the Stage 6 content extension.
 * Slice 1 implements inspect_note_content only.
 *
 * Architecture:
 *   - API route (/api/chat/inspect-note-content) fetches raw text + metadata
 *   - This module handles snippet extraction, shaping, and budget enforcement
 *   - Extraction logic is pure functions, unit-testable without DB
 *
 * Design note: stage6-content-retrieval-and-explanation-design.md
 */

import type {
  S6InspectNoteContentRequest,
  S6InspectNoteContentResponse,
  S6NoteContentSnapshot,
  S6ContentSnippet,
} from './stage6-content-tool-contracts'
import { S6_CONTENT_LIMITS } from './stage6-content-tool-contracts'
import { extractFullText } from '../utils/branch-preview'

// ============================================================================
// Dispatch
// ============================================================================

/**
 * Route a content tool request to the appropriate handler.
 * Slice 1: only inspect_note_content is supported.
 */
export async function handleContentInspect(
  request: S6InspectNoteContentRequest,
): Promise<S6InspectNoteContentResponse> {
  try {
    switch (request.tool) {
      case 'inspect_note_content':
        return await handleInspectNoteContent(request)
      default:
        return {
          tool: 'inspect_note_content',
          status: 'error',
          data: null,
          error: `Unknown content tool: ${(request as Record<string, unknown>).tool}`,
        }
    }
  } catch (err) {
    return {
      tool: 'inspect_note_content',
      status: 'error',
      data: null,
      error: `Content handler failed: ${(err as Error).message}`,
    }
  }
}

// ============================================================================
// inspect_note_content
// ============================================================================

async function handleInspectNoteContent(
  request: S6InspectNoteContentRequest,
): Promise<S6InspectNoteContentResponse> {
  const now = Date.now()

  // Fetch raw content from server
  const raw = await fetchNoteContent(request.itemId)

  if (!raw.success) {
    return {
      tool: 'inspect_note_content',
      status: 'error',
      data: null,
      error: raw.error ?? 'Failed to fetch note content',
    }
  }

  const data = raw.data
  if (!data) {
    return {
      tool: 'inspect_note_content',
      status: 'error',
      data: null,
      error: 'item_not_found',
    }
  }

  // Resolve text: prefer document_text, fallback to extractFullText(content)
  const fullText = data.documentText || extractFullText(data.content) || ''

  if (!fullText.trim()) {
    // Note exists but has no content
    return {
      tool: 'inspect_note_content',
      status: 'ok',
      data: {
        itemId: data.itemId,
        title: data.title,
        snippets: [],
        totalSnippetCount: 0,
        truncated: false,
        version: data.version,
        capturedAtMs: now,
      },
    }
  }

  // Extract snippets
  const charLimit = Math.min(
    request.charLimit ?? S6_CONTENT_LIMITS.DEFAULT_CHARS_PER_SNIPPET,
    S6_CONTENT_LIMITS.MAX_CHARS_PER_SNIPPET,
  )

  const allSnippets = extractSnippetsFromText(fullText, charLimit)

  // Apply per-call limits
  const maxSnippets = S6_CONTENT_LIMITS.MAX_SNIPPETS_PER_CALL
  const maxChars = S6_CONTENT_LIMITS.MAX_CHARS_PER_CALL

  const { snippets, truncated } = applyCallLimits(allSnippets, maxSnippets, maxChars)

  const snapshot: S6NoteContentSnapshot = {
    itemId: data.itemId,
    title: data.title,
    snippets,
    totalSnippetCount: allSnippets.length,
    truncated: truncated || snippets.length < allSnippets.length,
    version: data.version,
    capturedAtMs: now,
  }

  return {
    tool: 'inspect_note_content',
    status: 'ok',
    data: snapshot,
  }
}

// ============================================================================
// Snippet Extraction (Pure, Testable)
// ============================================================================

/**
 * Extract bounded snippets from plain text.
 *
 * Strategy:
 * 1. Treat the entire text as a single section (no heading detection)
 * 2. Split into snippets at paragraph boundaries (double newlines)
 * 3. All snippets get sectionRef: null, sectionHeading: null
 *
 * Rationale: document_text is pre-extracted plain text with no heading markers.
 * Attempting heading detection from plain text is unreliable. Proper section
 * detection requires ProseMirror JSON node types (heading nodes), which can
 * be added in a future iteration for the JSONB fallback path.
 */
export function extractSnippetsFromText(
  text: string,
  charLimit: number,
): S6ContentSnippet[] {
  const trimmed = text.trim()
  if (!trimmed) return []

  return splitTextIntoSnippets(trimmed, charLimit)
}

/**
 * Split text into bounded snippets at paragraph/sentence boundaries.
 * All snippets get sectionRef: null, sectionHeading: null (no heading
 * detection from plain text — see extractSnippetsFromText comment).
 */
function splitTextIntoSnippets(
  content: string,
  charLimit: number,
): S6ContentSnippet[] {
  const snippets: S6ContentSnippet[] = []
  let remaining = content
  let snippetIndex = 0

  while (remaining.length > 0) {
    let text: string
    let truncated = false

    if (remaining.length <= charLimit) {
      text = remaining
      remaining = ''
    } else {
      // Try to break at a paragraph/sentence boundary
      const breakPoint = findBreakPoint(remaining, charLimit)
      text = remaining.slice(0, breakPoint).trimEnd()
      remaining = remaining.slice(breakPoint).trimStart()
      truncated = true
    }

    if (text.trim()) {
      snippets.push({
        snippetId: `s${snippetIndex}`,
        sectionRef: null,
        sectionHeading: null,
        text: text.trim(),
        truncated,
      })
      snippetIndex++
    }
  }

  return snippets
}

/**
 * Find the best break point within charLimit.
 * Prefer: paragraph boundary > sentence boundary > word boundary > hard cut.
 */
function findBreakPoint(text: string, limit: number): number {
  const slice = text.slice(0, limit)

  // Try paragraph boundary (double newline)
  const lastParagraph = slice.lastIndexOf('\n\n')
  if (lastParagraph > limit * 0.3) return lastParagraph + 2

  // Try single newline
  const lastNewline = slice.lastIndexOf('\n')
  if (lastNewline > limit * 0.3) return lastNewline + 1

  // Try sentence boundary
  const sentenceMatch = slice.match(/[.!?]\s+/g)
  if (sentenceMatch) {
    let lastSentenceEnd = 0
    let searchFrom = 0
    for (const m of sentenceMatch) {
      const idx = slice.indexOf(m, searchFrom)
      if (idx >= 0) {
        lastSentenceEnd = idx + m.length
        searchFrom = lastSentenceEnd
      }
    }
    if (lastSentenceEnd > limit * 0.3) return lastSentenceEnd
  }

  // Try word boundary
  const lastSpace = slice.lastIndexOf(' ')
  if (lastSpace > limit * 0.5) return lastSpace + 1

  // Hard cut
  return limit
}

// ============================================================================
// Per-call limit enforcement
// ============================================================================

/**
 * Apply MAX_SNIPPETS_PER_CALL and MAX_CHARS_PER_CALL limits.
 * Returns the bounded snippet list and whether truncation occurred.
 */
export function applyCallLimits(
  snippets: S6ContentSnippet[],
  maxSnippets: number,
  maxChars: number,
): { snippets: S6ContentSnippet[]; truncated: boolean } {
  const result: S6ContentSnippet[] = []
  let totalChars = 0
  let wasTruncated = false

  for (const snippet of snippets) {
    if (result.length >= maxSnippets) {
      wasTruncated = true
      break
    }

    if (totalChars + snippet.text.length > maxChars) {
      // Remaining budget
      const remaining = maxChars - totalChars
      if (remaining > 50) {
        // Enough room for a meaningful truncated snippet
        result.push({
          ...snippet,
          text: snippet.text.slice(0, remaining).trimEnd(),
          truncated: true,
        })
        totalChars += remaining
      }
      wasTruncated = true
      break
    }

    result.push(snippet)
    totalChars += snippet.text.length
  }

  return { snippets: result, truncated: wasTruncated }
}

// ============================================================================
// API Client
// ============================================================================

interface RawNoteContent {
  success: boolean
  error?: string
  data?: {
    itemId: string
    title: string
    documentText: string | null
    content: unknown
    version: number
    createdAt: string
  }
}

/**
 * Fetch raw note content from the server-side API route.
 * Fail-open: returns { success: false } on network/server errors.
 */
async function fetchNoteContent(itemId: string): Promise<RawNoteContent> {
  try {
    const res = await fetch('/api/chat/inspect-note-content', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ itemId }),
    })

    if (!res.ok) {
      return { success: false, error: `HTTP ${res.status}` }
    }

    return await res.json()
  } catch (err) {
    return { success: false, error: (err as Error).message }
  }
}
