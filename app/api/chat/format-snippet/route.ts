import { NextRequest, NextResponse } from 'next/server'
import OpenAI from 'openai'
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'

/**
 * HS3 Snippet Formatter (Bounded LLM Formatting)
 *
 * Purpose: Format/summarize retrieved snippets for human-like responses.
 * Output: Plain text (not JSON) - the formatted response ready for display.
 *
 * Per general-doc-retrieval-routing-plan.md (v5):
 * - Only called for found/weak status with long snippets or step requests
 * - Must not introduce new facts
 * - Must only rewrite/summarize provided snippets
 * - On timeout/error, caller falls back to raw snippet
 */

// =============================================================================
// OpenAI Client (shared pattern with classify-route)
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
// Formatting Prompts by Style
// =============================================================================

type FormatStyle = 'short' | 'medium' | 'steps'

function getSystemPrompt(style: FormatStyle): string {
  const baseConstraint = `You are a helpful assistant that formats documentation snippets.
Your task is to rewrite the provided excerpt in a clear, conversational tone.

CRITICAL CONSTRAINTS:
- Use ONLY information from the provided excerpt
- Do NOT add facts, features, or details not in the excerpt
- Do NOT invent or assume information
- If the excerpt doesn't contain the answer, say "I don't see that info in this section."
- Keep the same meaning, just improve readability`

  const styleInstructions: Record<FormatStyle, string> = {
    short: `
OUTPUT STYLE: Short (1-2 sentences)
- Provide a concise summary in 1-2 sentences
- Focus on the key point only
- No bullet points or lists`,

    medium: `
OUTPUT STYLE: Medium (2-3 sentences + 1 key detail)
- Provide 2-3 sentences covering the main points
- Include one specific detail or example from the excerpt
- Keep it conversational`,

    steps: `
OUTPUT STYLE: Steps (3-7 numbered steps)

CRITICAL FORMAT REQUIREMENT:
Each numbered step MUST be on its own line. Use a line break after each step.

CORRECT format:
1. First step here
2. Second step here
3. Third step here

WRONG format (DO NOT do this):
1. First step here 2. Second step here 3. Third step here

Rules:
- Keep each step concise and actionable
- Include only steps mentioned in the excerpt
- If the excerpt doesn't have clear steps, summarize the key points instead`
  }

  return `${baseConstraint}
${styleInstructions[style]}

Return ONLY the formatted text, no preamble or explanation.`
}

function getUserPrompt(snippet: string, userQuery?: string, docTitle?: string): string {
  const parts: string[] = []

  if (userQuery) {
    parts.push(`User's question: "${userQuery}"`)
  }

  if (docTitle) {
    parts.push(`Source: ${docTitle}`)
  }

  parts.push(`Excerpt to format:\n---\n${snippet}\n---`)

  return parts.join('\n\n')
}

// =============================================================================
// Request/Response Types
// =============================================================================

interface FormatSnippetRequest {
  snippet: string
  style: FormatStyle
  userQuery?: string
  docTitle?: string
}

interface FormatSnippetResponse {
  ok: boolean
  latencyMs: number
  formatted?: string
  error?: string
  inputLen?: number
  outputLen?: number
}

// =============================================================================
// Route Handler
// =============================================================================

export async function POST(request: NextRequest): Promise<NextResponse<FormatSnippetResponse>> {
  const startTime = Date.now()

  try {
    const body = await request.json() as FormatSnippetRequest
    const { snippet, style, userQuery, docTitle } = body

    // Validate required fields
    if (!snippet || typeof snippet !== 'string') {
      return NextResponse.json({
        ok: false,
        latencyMs: Date.now() - startTime,
        error: 'missing_snippet',
      })
    }

    if (!style || !['short', 'medium', 'steps'].includes(style)) {
      return NextResponse.json({
        ok: false,
        latencyMs: Date.now() - startTime,
        error: 'invalid_style',
      })
    }

    const openai = getOpenAIClient()

    const response = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      temperature: 0.3, // Slightly higher than classifier for natural phrasing
      max_tokens: 500,  // Enough for step-by-step responses
      messages: [
        { role: 'system', content: getSystemPrompt(style) },
        { role: 'user', content: getUserPrompt(snippet, userQuery, docTitle) },
      ],
    })

    const formatted = response.choices[0]?.message?.content?.trim() || ''
    const latencyMs = Date.now() - startTime

    if (!formatted) {
      return NextResponse.json({
        ok: false,
        latencyMs,
        error: 'empty_response',
        inputLen: snippet.length,
      })
    }

    return NextResponse.json({
      ok: true,
      latencyMs,
      formatted,
      inputLen: snippet.length,
      outputLen: formatted.length,
    })
  } catch (error) {
    console.error('[format-snippet] Error:', error)
    return NextResponse.json({
      ok: false,
      latencyMs: Date.now() - startTime,
      error: error instanceof Error ? error.message : 'unknown_error',
    })
  }
}
