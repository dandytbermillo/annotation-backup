/**
 * Cross-Surface Semantic Arbiter — Server Route (6x.8 Phase 3)
 *
 * Bounded LLM classifier for uncertain turns across surfaces.
 * Returns typed decision: surface × intentFamily × confidence.
 * No execution — classification only.
 */

import { NextRequest, NextResponse } from 'next/server'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'

// =============================================================================
// Types
// =============================================================================

interface ArbiterRequest {
  userInput: string
  activeNote?: { itemId: string; title: string | null }
  noteReferenceDetected?: boolean
  recentRoutingContext?: {
    lastUserMessage?: string
    lastAssistantMessage?: string
    lastResolvedSurface?: string
    lastResolvedIntentFamily?: string
    lastTurnOutcome?: string
  }
  // Phase 4: cross-surface context
  visiblePanels?: string[]
  workspaceName?: string
  entryName?: string
  // Phase E: medium-confidence surface candidate hint (advisory only)
  surfaceCandidateHint?: {
    surfaceType: string
    containerType: string
    intentFamily: string
    intentSubtype: string
    candidateConfidence: string
    similarityScore: number
    sourceKind: string
  }
}

interface ArbiterResponse {
  surface: 'note' | 'panel_widget' | 'dashboard' | 'workspace' | 'unknown'
  intentFamily: 'read_content' | 'state_info' | 'navigate' | 'mutate' | 'ambiguous'
  confidence: number
  reason: string
  intentSubtype?: 'summary' | 'question' | 'find_text'
}

interface ArbiterResult {
  success: boolean
  response?: ArbiterResponse
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

function buildPrompt(req: ArbiterRequest): string {
  const noteTitle = req.activeNote?.title || 'none'
  const noteStatus = req.activeNote ? `"${noteTitle}" (open)` : req.noteReferenceDetected ? 'referenced but not open' : 'none'

  const panelList = req.visiblePanels?.length ? req.visiblePanels.join(', ') : 'none'
  const workspaceName = req.workspaceName || 'none'
  const entryName = req.entryName || 'none'

  return `You are a UI intent classifier for an annotation application.

The user has the following active context:
- Active note: ${noteStatus}
- Visible panels: ${panelList}
- Current workspace: ${workspaceName}
- Current entry: ${entryName}

Classify the user's request into:

1. surface: which part of the app is the user referring to?
   - "note" — the note/document content
   - "panel_widget" — a panel or widget on the dashboard
   - "dashboard" — the overall dashboard view
   - "workspace" — the workspace/environment
   - "unknown" — cannot determine

2. intentFamily: what does the user want to do?
   - "read_content" — read, summarize, explain, find text in content
   - "state_info" — ask what is open, active, visible, or current
   - "navigate" — open, go to, switch to something
   - "mutate" — edit, add, remove, rename, highlight something
   - "ambiguous" — unclear intent

3. If intentFamily is "read_content", also provide intentSubtype:
   - "summary" — summarize or overview
   - "question" — answer a question about content
   - "find_text" — search or find specific text

IMPORTANT: Imperative verbs like "show", "read", "display", "tell me" do NOT imply navigation
when the object is clearly note content. These are read_content requests:
- "show me the content of that note" → read_content (summary)
- "show the text of this note" → read_content (summary)
- "read that note" → read_content (summary)
- "display the contents of my note" → read_content (summary)

Use "navigate" ONLY when the user is asking to open, go to, switch to, or move somewhere in the UI.

IMPORTANT: Distinguish panel/widget questions from dashboard questions:
- "what panel is open?" → panel_widget, state_info (asking about the specific open panel/drawer)
- "which panel is open?" → panel_widget, state_info
- "which panels are open?" → panel_widget, state_info
- "what panels are visible?" → panel_widget, state_info (asking about visible widgets)
- "what's on the dashboard?" → dashboard, state_info (asking about the overall dashboard)
- "how many widgets are there?" → dashboard, state_info (asking about the dashboard container)

When the user mentions "panel", "panels", or "drawer", classify as panel_widget, NOT dashboard.

Set confidence between 0 and 1. Only use >= 0.75 when intent is clearly one category.
If unclear, return "ambiguous" — do NOT guess.

Respond with JSON only: { "surface": "...", "intentFamily": "...", "confidence": 0.0-1.0, "reason": "...", "intentSubtype": "..." }
${buildRecentContextSection(req)}
${buildSurfaceHintSection(req)}
User said: "${req.userInput}"`
}

function buildRecentContextSection(req: ArbiterRequest): string {
  const rc = req.recentRoutingContext
  if (!rc) return ''
  const parts: string[] = ['\nPrevious turn context (use only to resolve referential language like "that", "it", "again"):']
  if (rc.lastUserMessage) parts.push(`- Previous user: "${rc.lastUserMessage}"`)
  if (rc.lastAssistantMessage) parts.push(`- Previous assistant: "${rc.lastAssistantMessage}"`)
  if (rc.lastResolvedSurface) parts.push(`- Previous surface: ${rc.lastResolvedSurface}`)
  if (rc.lastResolvedIntentFamily) parts.push(`- Previous intent: ${rc.lastResolvedIntentFamily}`)
  if (rc.lastTurnOutcome) parts.push(`- Previous outcome: ${rc.lastTurnOutcome}`)
  parts.push('- Explicit current-turn nouns and verbs always outrank prior context.')
  parts.push('- If prior context does not clarify the current request, ignore it.')
  return parts.join('\n')
}

function buildSurfaceHintSection(req: ArbiterRequest): string {
  const hint = req.surfaceCandidateHint
  if (!hint) return ''
  return `
Semantic retrieval advisory (from prior successful queries):
- A similar query was previously resolved as: surface="${hint.surfaceType}", intent="${hint.intentFamily}.${hint.intentSubtype}"
- Similarity score: ${hint.similarityScore.toFixed(2)}, source: ${hint.sourceKind}
- This is advisory only. Use it if the user's current query is compatible with this classification.
- If the current query clearly does NOT match this surface/intent, ignore this hint.`
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

const VALID_SURFACES = ['note', 'panel_widget', 'dashboard', 'workspace', 'unknown']
const VALID_INTENTS = ['read_content', 'state_info', 'navigate', 'mutate', 'ambiguous']
const VALID_SUBTYPES = ['summary', 'question', 'find_text']

function validateResponse(parsed: ArbiterResponse): string | null {
  if (!parsed.surface || !VALID_SURFACES.includes(parsed.surface)) {
    return `Invalid surface "${parsed.surface}"`
  }
  if (!parsed.intentFamily || !VALID_INTENTS.includes(parsed.intentFamily)) {
    return `Invalid intentFamily "${parsed.intentFamily}"`
  }
  if (typeof parsed.confidence !== 'number' || parsed.confidence < 0 || parsed.confidence > 1) {
    return 'confidence must be a number between 0 and 1'
  }
  if (parsed.intentFamily === 'read_content') {
    if (!parsed.intentSubtype || !VALID_SUBTYPES.includes(parsed.intentSubtype)) {
      return `read_content requires intentSubtype (summary, question, or find_text)`
    }
  }
  return null
}

// =============================================================================
// Route Handler
// =============================================================================

export async function POST(request: NextRequest): Promise<NextResponse<ArbiterResult>> {
  const startTime = Date.now()

  try {
    const body = await request.json() as ArbiterRequest

    if (!body.userInput) {
      return NextResponse.json({
        success: false,
        error: 'Invalid request: userInput required',
        latencyMs: Date.now() - startTime,
      })
    }

    const apiKey = getGeminiApiKey()
    if (!apiKey) {
      return NextResponse.json({
        success: false,
        error: 'Gemini API key not configured',
        latencyMs: Date.now() - startTime,
      })
    }

    const genAI = new GoogleGenerativeAI(apiKey)
    const model = genAI.getGenerativeModel({
      model: process.env.CROSS_SURFACE_ARBITER_MODEL || 'gemini-2.0-flash',
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 200,
      },
    })

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
      const parsed = safeParseJson<ArbiterResponse>(content)

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
