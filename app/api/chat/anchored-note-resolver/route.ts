/**
 * Anchored-Note Intent Resolver — Server Route (6x.7 Phase A)
 *
 * Bounded LLM resolver for anchored-note classifier-miss cases.
 * Decides: read-content vs navigate vs ambiguous.
 *
 * Pattern: same as grounding-llm/route.ts
 */

import { NextRequest, NextResponse } from 'next/server'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'

// =============================================================================
// Types
// =============================================================================

interface ResolverRequest {
  userInput: string
  noteAnchor: { itemId: string; title: string | null }
  activeSurface?: 'note' | 'other'
}

interface ResolverResponse {
  decision: 'anchored_note_content' | 'anchored_note_navigation' | 'ambiguous'
  confidence: number
  reason: string
  intentType?: 'summary' | 'question' | 'find_text'
}

interface ResolverResult {
  success: boolean
  response?: ResolverResponse
  error?: string
  latencyMs: number
}

// =============================================================================
// Gemini Client
// =============================================================================

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

const LLM_TIMEOUT_MS = 2000

function buildPrompt(req: ResolverRequest): string {
  const title = req.noteAnchor.title || 'Untitled'
  return `You are a UI intent classifier. The user has a note open titled "${title}".

Decide whether the user is asking to:
1. READ or UNDERSTAND the note content (summarize, explain, find text, answer questions about it) → "anchored_note_content"
2. NAVIGATE elsewhere (open a panel, go to another entry, switch views) → "anchored_note_navigation"
3. If the intent is UNCLEAR or could be either, return "ambiguous" — do NOT guess.

When returning "anchored_note_content", also include intentType: "summary", "question", or "find_text".
Set confidence between 0 and 1. Only use confidence >= 0.75 when the intent is clearly one or the other.

Respond with JSON only: { "decision": "...", "confidence": 0.0-1.0, "reason": "...", "intentType": "..." }

User said: "${req.userInput}"`
}

// =============================================================================
// JSON Parser
// =============================================================================

function safeParseJson<T>(value: string): T | null {
  try {
    let cleaned = value.trim()
    if (cleaned.startsWith('```json')) cleaned = cleaned.slice(7)
    else if (cleaned.startsWith('```')) cleaned = cleaned.slice(3)
    if (cleaned.endsWith('```')) cleaned = cleaned.slice(0, -3)
    return JSON.parse(cleaned.trim()) as T
  } catch {
    return null
  }
}

// =============================================================================
// Validation
// =============================================================================

const VALID_DECISIONS = ['anchored_note_content', 'anchored_note_navigation', 'ambiguous']
const VALID_INTENT_TYPES = ['summary', 'question', 'find_text']

function validateResponse(parsed: ResolverResponse): string | null {
  if (!parsed.decision || !VALID_DECISIONS.includes(parsed.decision)) {
    return `Invalid decision "${parsed.decision}". Must be one of: ${VALID_DECISIONS.join(', ')}`
  }
  if (typeof parsed.confidence !== 'number' || parsed.confidence < 0 || parsed.confidence > 1) {
    return 'confidence must be a number between 0 and 1'
  }
  if (parsed.decision === 'anchored_note_content') {
    if (!parsed.intentType || !VALID_INTENT_TYPES.includes(parsed.intentType)) {
      return `anchored_note_content requires intentType. Must be one of: ${VALID_INTENT_TYPES.join(', ')}`
    }
  }
  return null
}

// =============================================================================
// Route Handler
// =============================================================================

export async function POST(request: NextRequest): Promise<NextResponse<ResolverResult>> {
  const startTime = Date.now()

  try {
    const body = await request.json() as ResolverRequest

    // Validate request
    if (!body.userInput || !body.noteAnchor?.itemId) {
      return NextResponse.json({
        success: false,
        error: 'Invalid request: userInput and noteAnchor.itemId required',
        latencyMs: Date.now() - startTime,
      })
    }

    // Get API key
    const apiKey = getGeminiApiKey()
    if (!apiKey) {
      return NextResponse.json({
        success: false,
        error: 'Gemini API key not configured',
        latencyMs: Date.now() - startTime,
      })
    }

    // Initialize Gemini
    const genAI = new GoogleGenerativeAI(apiKey)
    const model = genAI.getGenerativeModel({
      model: process.env.ANCHORED_NOTE_RESOLVER_MODEL || 'gemini-2.0-flash',
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 200,
      },
    })

    // Call with enforced timeout via Promise.race
    try {
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => {
          const err = new Error('timeout')
          err.name = 'AbortError'
          reject(err)
        }, LLM_TIMEOUT_MS)
      })

      const result = await Promise.race([
        model.generateContent({
          contents: [{ role: 'user', parts: [{ text: buildPrompt(body) }] }],
        }),
        timeoutPromise,
      ])

      const content = result.response.text().trim()
      const parsed = safeParseJson<ResolverResponse>(content)

      if (!parsed) {
        return NextResponse.json({
          success: false,
          error: `Unparseable response: ${content.slice(0, 100)}`,
          latencyMs: Date.now() - startTime,
        })
      }

      const validationError = validateResponse(parsed)
      if (validationError) {
        return NextResponse.json({
          success: false,
          error: `Validation failed: ${validationError}`,
          latencyMs: Date.now() - startTime,
        })
      }

      return NextResponse.json({
        success: true,
        response: parsed,
        latencyMs: Date.now() - startTime,
      })

    } catch (err) {
      const isTimeout = (err as Error).name === 'AbortError'
      return NextResponse.json({
        success: false,
        error: isTimeout ? 'timeout' : (err as Error).message,
        latencyMs: Date.now() - startTime,
      })
    }

  } catch (err) {
    return NextResponse.json({
      success: false,
      error: (err as Error).message,
      latencyMs: Date.now() - startTime,
    })
  }
}
