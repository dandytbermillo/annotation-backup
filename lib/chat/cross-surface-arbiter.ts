/**
 * Cross-Surface Semantic Arbiter — Client Helper (6x.8 Phase 3)
 *
 * Bounded LLM classifier for uncertain turns across surfaces.
 * Returns raw parsed response regardless of confidence — threshold applied by dispatcher.
 */

import { debugLog } from '@/lib/utils/debug-logger'

// =============================================================================
// Types
// =============================================================================

export type CrossSurfaceArbiterRequest = {
  userInput: string
  activeNote?: { itemId: string; title: string | null }
  noteReferenceDetected?: boolean
}

export type CrossSurfaceSemanticDecision = {
  surface: 'note' | 'panel_widget' | 'dashboard' | 'workspace' | 'unknown'
  intentFamily: 'read_content' | 'state_info' | 'navigate' | 'mutate' | 'ambiguous'
  confidence: number
  reason: string
  intentSubtype?: 'summary' | 'question' | 'find_text'
}

export type CrossSurfaceArbiterClientResult = {
  success: boolean
  response?: CrossSurfaceSemanticDecision
  error?: string
  latencyMs: number
}

// =============================================================================
// Constants
// =============================================================================

const ARBITER_TIMEOUT_MS = 2500

// =============================================================================
// Client Helper
// =============================================================================

export async function callCrossSurfaceArbiter(
  request: CrossSurfaceArbiterRequest,
): Promise<CrossSurfaceArbiterClientResult> {
  const startTime = Date.now()

  if (typeof window === 'undefined') {
    return { success: false, error: 'client_only', latencyMs: 0 }
  }

  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), ARBITER_TIMEOUT_MS)

    const response = await fetch('/api/chat/cross-surface-arbiter', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
      signal: controller.signal,
    })

    clearTimeout(timeoutId)

    if (!response.ok) {
      const latencyMs = Date.now() - startTime
      void debugLog({ component: 'CrossSurfaceArbiter', action: 'http_error', metadata: { status: response.status, latencyMs } })
      return { success: false, error: `HTTP ${response.status}`, latencyMs }
    }

    const data = await response.json()
    const latencyMs = Date.now() - startTime

    if (!data.success || !data.response) {
      void debugLog({ component: 'CrossSurfaceArbiter', action: 'server_error', metadata: { error: data.error, latencyMs } })
      return { success: false, error: data.error ?? 'unknown_server_error', latencyMs }
    }

    const result = data.response as CrossSurfaceSemanticDecision

    // Validate intentSubtype for read_content
    if (result.intentFamily === 'read_content' && !result.intentSubtype) {
      return { success: false, error: 'read_content missing intentSubtype', latencyMs }
    }

    void debugLog({
      component: 'CrossSurfaceArbiter',
      action: 'arbiter_complete',
      metadata: { surface: result.surface, intentFamily: result.intentFamily, confidence: result.confidence, latencyMs },
    })

    return { success: true, response: result, latencyMs }

  } catch (err) {
    const latencyMs = Date.now() - startTime
    const isTimeout = (err as Error).name === 'AbortError'
    void debugLog({ component: 'CrossSurfaceArbiter', action: isTimeout ? 'timeout' : 'error', metadata: { error: (err as Error).message, latencyMs } })
    return { success: false, error: isTimeout ? 'timeout' : (err as Error).message, latencyMs }
  }
}
