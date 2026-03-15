/**
 * Anchored-Note Intent Resolver — Client Helper (6x.7 Phase A)
 *
 * Bounded LLM resolver for classifier-miss cases when an active note
 * anchor exists. Follows the same pattern as grounding-llm-fallback.ts.
 *
 * Returns raw parsed response regardless of confidence — the dispatcher
 * applies the 0.75 threshold for routing decisions.
 */

import { debugLog } from '@/lib/utils/debug-logger'

// =============================================================================
// Types
// =============================================================================

export type AnchoredNoteResolverRequest = {
  userInput: string
  noteAnchor: { itemId: string; title: string | null }
  activeSurface?: 'note' | 'other'
}

export type AnchoredNoteResolverResult =
  | {
      decision: 'anchored_note_content'
      confidence: number
      reason: string
      intentType: 'summary' | 'question' | 'find_text'
    }
  | {
      decision: 'anchored_note_navigation' | 'ambiguous'
      confidence: number
      reason: string
    }

export type AnchoredNoteResolverClientResult = {
  success: boolean
  response?: AnchoredNoteResolverResult
  error?: string
  latencyMs: number
}

// =============================================================================
// Constants
// =============================================================================

const RESOLVER_TIMEOUT_MS = 2500 // slightly > server's 2000ms

// =============================================================================
// Client Helper
// =============================================================================

/**
 * Call the anchored-note intent resolver.
 *
 * Returns raw parsed response as success: true regardless of confidence.
 * The 0.75 threshold is applied only in the dispatcher.
 *
 * On timeout/error/malformed: returns success: false — never throws.
 */
export async function callAnchoredNoteResolver(
  request: AnchoredNoteResolverRequest,
): Promise<AnchoredNoteResolverClientResult> {
  const startTime = Date.now()

  // Client-only guard
  if (typeof window === 'undefined') {
    return { success: false, error: 'client_only', latencyMs: 0 }
  }

  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), RESOLVER_TIMEOUT_MS)

    const response = await fetch('/api/chat/anchored-note-resolver', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
      signal: controller.signal,
    })

    clearTimeout(timeoutId)

    if (!response.ok) {
      const latencyMs = Date.now() - startTime
      void debugLog({
        component: 'AnchoredNoteResolver',
        action: 'resolver_http_error',
        metadata: { status: response.status, latencyMs },
      })
      return { success: false, error: `HTTP ${response.status}`, latencyMs }
    }

    const data = await response.json()
    const latencyMs = Date.now() - startTime

    // Server returns { success, response?, error?, latencyMs }
    if (!data.success || !data.response) {
      void debugLog({
        component: 'AnchoredNoteResolver',
        action: 'resolver_server_error',
        metadata: { error: data.error, latencyMs },
      })
      return { success: false, error: data.error ?? 'unknown_server_error', latencyMs }
    }

    const result = data.response as AnchoredNoteResolverResult

    // Validate intentType for content decisions
    if (result.decision === 'anchored_note_content' && !(result as any).intentType) {
      return { success: false, error: 'content decision missing intentType', latencyMs }
    }

    void debugLog({
      component: 'AnchoredNoteResolver',
      action: 'resolver_complete',
      metadata: {
        decision: result.decision,
        confidence: result.confidence,
        intentType: (result as any).intentType,
        latencyMs,
      },
    })

    return { success: true, response: result, latencyMs }

  } catch (err) {
    const latencyMs = Date.now() - startTime
    const isTimeout = (err as Error).name === 'AbortError'
    void debugLog({
      component: 'AnchoredNoteResolver',
      action: isTimeout ? 'resolver_timeout' : 'resolver_error',
      metadata: { error: (err as Error).message, latencyMs },
    })
    return {
      success: false,
      error: isTimeout ? 'timeout' : (err as Error).message,
      latencyMs,
    }
  }
}
