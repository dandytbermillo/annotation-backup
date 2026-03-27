/**
 * Surface Command Rewrite — Bounded LLM Typo Correction
 *
 * Pure text correction endpoint for rewrite-assisted retrieval recovery.
 * Uses Gemini to correct obvious typos and simplify queries.
 * No execution, no routing — retrieval aid only.
 *
 * Safety:
 * - 1500ms server-side timeout (fail-open)
 * - One attempt per turn — no retry loops
 * - Returns null on timeout/failure/no-change
 * - Rewritten text is never execution authority
 */

import { NextRequest, NextResponse } from 'next/server'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'

// =============================================================================
// Types
// =============================================================================

interface RewriteRequest {
  raw_query_text: string
}

interface RewriteResponse {
  rewritten_text: string | null
  latency_ms: number
}

// =============================================================================
// Gemini Client (same key resolution as cross-surface arbiter)
// =============================================================================

const REWRITE_TIMEOUT_MS = 1500

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

function buildRewritePrompt(rawQueryText: string): string {
  return `Correct obvious typos and simplify this query.
Preserve the likely intent. Do not add new goals or invent missing entities.
Return only the corrected text, nothing else.
Query: "${rawQueryText}"`
}

// =============================================================================
// Route Handler
// =============================================================================

export async function POST(request: NextRequest): Promise<NextResponse<RewriteResponse>> {
  const startTime = Date.now()

  try {
    const body = await request.json() as RewriteRequest
    const rawQueryText = body.raw_query_text

    if (!rawQueryText?.trim()) {
      return NextResponse.json({ rewritten_text: null, latency_ms: Date.now() - startTime })
    }

    const apiKey = getGeminiApiKey()
    if (!apiKey) {
      console.warn('[surface-command/rewrite] Gemini API key not configured')
      return NextResponse.json({ rewritten_text: null, latency_ms: Date.now() - startTime })
    }

    const genAI = new GoogleGenerativeAI(apiKey)
    const model = genAI.getGenerativeModel({
      model: process.env.SURFACE_REWRITE_MODEL || 'gemini-2.0-flash',
      generationConfig: {
        temperature: 0.0,
        maxOutputTokens: 100,
      },
    })

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        const err = new Error('timeout')
        err.name = 'AbortError'
        reject(err)
      }, REWRITE_TIMEOUT_MS)
    })

    const result = await Promise.race([
      model.generateContent({
        contents: [{ role: 'user', parts: [{ text: buildRewritePrompt(rawQueryText) }] }],
      }),
      timeoutPromise,
    ])

    let rewrittenText = result.response.text().trim()

    // Strip markdown code fences if LLM wraps the response
    if (rewrittenText.startsWith('```')) {
      rewrittenText = rewrittenText.replace(/^```\w*\n?/, '').replace(/\n?```$/, '').trim()
    }

    // Strip surrounding quotes if LLM wraps in quotes
    if (
      (rewrittenText.startsWith('"') && rewrittenText.endsWith('"')) ||
      (rewrittenText.startsWith("'") && rewrittenText.endsWith("'"))
    ) {
      rewrittenText = rewrittenText.slice(1, -1).trim()
    }

    // If rewrite is empty or identical to input, return null
    if (!rewrittenText || rewrittenText.toLowerCase() === rawQueryText.toLowerCase()) {
      return NextResponse.json({ rewritten_text: null, latency_ms: Date.now() - startTime })
    }

    return NextResponse.json({ rewritten_text: rewrittenText, latency_ms: Date.now() - startTime })
  } catch (error) {
    const isTimeout = error instanceof Error && error.name === 'AbortError'
    if (!isTimeout) {
      console.error('[surface-command/rewrite] Error:', error)
    }
    return NextResponse.json({ rewritten_text: null, latency_ms: Date.now() - startTime })
  }
}
