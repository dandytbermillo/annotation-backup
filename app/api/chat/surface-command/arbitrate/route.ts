/**
 * Surface Command Arbitrate — Bounded Candidate Selection
 *
 * Selects among validated surface candidates using Gemini.
 * Operates only on a small bounded candidate set — does not invent new targets.
 *
 * Safety:
 * - 2000ms server-side timeout (fail-open)
 * - Output must be a valid candidate index or null (decline)
 * - Any other output rejected as unusable
 * - App still validates the chosen candidate after arbitration
 */

import { NextRequest, NextResponse } from 'next/server'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'

// =============================================================================
// Types
// =============================================================================

interface ArbitrationCandidate {
  index: number
  surface_type: string
  intent_family: string
  intent_subtype: string
  execution_policy: string
  similarity_score: number
  source_kind: string
}

interface ArbitrationRequest {
  user_query: string
  candidates: ArbitrationCandidate[]
  delivery_state?: {
    presentation_target: string
    destination_source: string
  }
}

interface ArbitrationResponse {
  selected_index: number | null
  latency_ms: number
}

// =============================================================================
// Gemini Client (same key resolution as cross-surface arbiter)
// =============================================================================

const ARBITRATION_TIMEOUT_MS = 2000

function getGeminiApiKey(): string | null {
  const envKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY
  if (envKey && envKey.length > 20) return envKey
  try {
    const secretsPath = join(process.cwd(), 'config', 'secrets.json')
    if (existsSync(secretsPath)) {
      const secrets = JSON.parse(readFileSync(secretsPath, 'utf-8'))
      return secrets.GEMINI_API_KEY || secrets.GOOGLE_API_KEY || null
    }
  } catch { /* ignore */ }
  return null
}

// =============================================================================
// Prompt
// =============================================================================

function buildArbitrationPrompt(req: ArbitrationRequest): string {
  const candidateLines = req.candidates.map(c =>
    `${c.index}. ${c.surface_type}.${c.intent_family}.${c.intent_subtype} — ${c.execution_policy} (score: ${c.similarity_score.toFixed(2)}, source: ${c.source_kind})`
  ).join('\n')

  // Build structured destination section when available
  const ds = req.delivery_state
  const destinationSection = ds?.destination_source === 'explicit'
    ? `\nUser's explicit destination: ${ds.presentation_target}\nThis is an explicit user constraint, not a default. Prefer candidates compatible with this destination.\n`
    : ds?.presentation_target && ds.presentation_target !== 'unspecified'
      ? `\nInferred destination: ${ds.presentation_target} (default, not explicit)\n`
      : ''

  return `You are selecting the most likely user intent from a small set of validated candidates.

User said: "${req.user_query}"
${destinationSection}
Candidates:
${candidateLines}

Important cues in the user's query:
- "in the chat" / "here in chat" / "in chat" → prefer chat-answer/list candidates
- "open" / "show" (without "in the chat") → prefer drawer/display candidates
- "list" → prefer chat-answer/list candidates

Return JSON only: { "selected_index": <candidate number or null> }
Return null if you cannot confidently choose.`
}

// =============================================================================
// Route Handler
// =============================================================================

export async function POST(request: NextRequest): Promise<NextResponse<ArbitrationResponse>> {
  const startTime = Date.now()

  try {
    const body = await request.json() as ArbitrationRequest

    if (!body.user_query?.trim() || !body.candidates?.length) {
      return NextResponse.json({ selected_index: null, latency_ms: Date.now() - startTime })
    }

    const apiKey = getGeminiApiKey()
    if (!apiKey) {
      // Short-circuit: no API key → skip immediately, don't wait for timeout
      return NextResponse.json({ selected_index: null, latency_ms: Date.now() - startTime })
    }

    const genAI = new GoogleGenerativeAI(apiKey)
    const model = genAI.getGenerativeModel({
      model: process.env.SURFACE_ARBITRATION_MODEL || 'gemini-2.0-flash',
      generationConfig: {
        temperature: 0.0,
        maxOutputTokens: 50,
      },
    })

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        const err = new Error('timeout')
        err.name = 'AbortError'
        reject(err)
      }, ARBITRATION_TIMEOUT_MS)
    })

    const result = await Promise.race([
      model.generateContent({
        contents: [{ role: 'user', parts: [{ text: buildArbitrationPrompt(body) }] }],
      }),
      timeoutPromise,
    ])

    let responseText = result.response.text().trim()

    // Strip markdown code fences
    if (responseText.startsWith('```')) {
      responseText = responseText.replace(/^```\w*\n?/, '').replace(/\n?```$/, '').trim()
    }

    // Parse JSON
    let parsed: { selected_index?: number | null }
    try {
      parsed = JSON.parse(responseText)
    } catch {
      return NextResponse.json({ selected_index: null, latency_ms: Date.now() - startTime })
    }

    // Validate: selected_index must be null or a valid candidate index
    if (parsed.selected_index === null || parsed.selected_index === undefined) {
      return NextResponse.json({ selected_index: null, latency_ms: Date.now() - startTime })
    }

    const validIndices = new Set(body.candidates.map(c => c.index))
    if (!validIndices.has(parsed.selected_index)) {
      // Invalid index — reject as unusable
      return NextResponse.json({ selected_index: null, latency_ms: Date.now() - startTime })
    }

    return NextResponse.json({
      selected_index: parsed.selected_index,
      latency_ms: Date.now() - startTime,
    })
  } catch (error) {
    const isTimeout = error instanceof Error && error.name === 'AbortError'
    if (!isTimeout) {
      console.error('[surface-command/arbitrate] Error:', error)
    }
    return NextResponse.json({ selected_index: null, latency_ms: Date.now() - startTime })
  }
}
