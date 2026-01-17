import { NextRequest, NextResponse } from 'next/server'
import OpenAI from 'openai'
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'

/**
 * Semantic Route Classifier (Gated Fallback)
 *
 * Purpose: Classify borderline queries when deterministic routing returns "llm".
 * Output: Strict JSON contract (domain, intent, confidence, rewrite, entities).
 *
 * Per general-doc-retrieval-routing-plan.md (v5):
 * - Only called when deterministic routing returns llm
 * - Timeout + safe fallback on errors
 * - Does NOT select content, only routes intent
 */

// =============================================================================
// OpenAI Client
// =============================================================================

function getOpenAIApiKey(): string | null {
  const envKey = process.env.OPENAI_API_KEY
  if (envKey && envKey.startsWith('sk-') && envKey.length > 40 && !envKey.includes('paste')) {
    return envKey
  }

  try {
    const secretsPath = join(process.cwd(), 'config', 'secrets.json')
    if (existsSync(secretsPath)) {
      const secrets = JSON.parse(readFileSync(secretsPath, 'utf-8'))
      if (secrets.OPENAI_API_KEY) {
        return secrets.OPENAI_API_KEY
      }
    }
  } catch {
    // Ignore file read errors
  }

  return null
}

function getOpenAIClient(): OpenAI {
  const apiKey = getOpenAIApiKey()
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY not found')
  }
  return new OpenAI({ apiKey })
}

// =============================================================================
// Classifier
// =============================================================================

const CLASSIFIER_SYSTEM_PROMPT = `Return JSON ONLY, no prose.

You are a routing classifier for an app assistant.
Classify the user's message into a domain + intent.
If unsure, set needs_clarification=true and keep confidence low.

Output schema (strict JSON):
{
  "domain": "app" | "general",
  "intent": "doc_explain" | "action" | "search_notes" | "other",
  "confidence": 0.0,
  "rewrite": "optional normalized query",
  "entities": {
    "docTopic": "optional",
    "widgetName": "optional",
    "noteQuery": "optional"
  },
  "needs_clarification": true | false,
  "clarify_question": "optional"
}

Rules:
- Domain "general" for non-app questions.
- Use "doc_explain" for explanation/definition/describe requests about app features.
- Use "action" for commands that should execute a UI action.
- Use "search_notes" if user asks to search their notes/files (even if not implemented).
- If confidence < 0.7, set needs_clarification=true.
- Keep rewrite short and normalized; do not add details.`

type SemanticRouteResult = {
  domain: 'app' | 'general'
  intent: 'doc_explain' | 'action' | 'search_notes' | 'other'
  confidence: number
  rewrite?: string
  entities?: {
    docTopic?: string
    widgetName?: string
    noteQuery?: string
  }
  needs_clarification: boolean
  clarify_question?: string
}

function safeParseJson<T>(value: string): T | null {
  try {
    return JSON.parse(value) as T
  } catch {
    return null
  }
}

export async function POST(request: NextRequest) {
  const startTime = Date.now()

  try {
    const { userMessage, lastDocSlug, lastTopicTokens } = await request.json()

    if (!userMessage || typeof userMessage !== 'string') {
      return NextResponse.json({
        ok: false,
        latencyMs: Date.now() - startTime,
        error: 'missing_user_message',
      })
    }

    const openai = getOpenAIClient()

    const contextParts = [
      lastDocSlug ? `Last doc: "${lastDocSlug}"` : null,
      lastTopicTokens?.length ? `Topic tokens: ${lastTopicTokens.join(', ')}` : null,
    ].filter(Boolean)

    const userContent = `${contextParts.join('\n')}\n\nUser message: "${userMessage}"`

    const response = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      temperature: 0,
      max_tokens: 220,
      messages: [
        { role: 'system', content: CLASSIFIER_SYSTEM_PROMPT },
        { role: 'user', content: userContent },
      ],
    })

    const content = response.choices[0]?.message?.content?.trim() || ''
    const parsed = safeParseJson<SemanticRouteResult>(content)
    const latencyMs = Date.now() - startTime

    if (!parsed) {
      return NextResponse.json({ ok: false, latencyMs, error: 'parse_failed', raw: content })
    }

    return NextResponse.json({ ok: true, latencyMs, result: parsed })
  } catch (error) {
    console.error('[classify-route] Error:', error)
    return NextResponse.json({
      ok: false,
      latencyMs: Date.now() - startTime,
      error: true,
    })
  }
}
