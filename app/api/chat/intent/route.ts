import { NextRequest, NextResponse } from 'next/server'
import OpenAI from 'openai'

import { buildIntentMessages } from '@/lib/chat/intent-prompt'
import {
  parseIntentResponse,
  SUPPORTED_ACTIONS_TEXT,
  type IntentResponse,
} from '@/lib/chat/intent-schema'
import { resolveNoteWorkspaceUserId } from '@/app/api/note-workspaces/user-id'

// =============================================================================
// OpenAI Client (lazy initialization)
// =============================================================================

let openaiClient: OpenAI | null = null

function getOpenAIClient(): OpenAI {
  if (!openaiClient) {
    const apiKey = process.env.OPENAI_API_KEY
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY environment variable is not set')
    }
    openaiClient = new OpenAI({ apiKey })
  }
  return openaiClient
}

// =============================================================================
// Configuration
// =============================================================================

const LLM_CONFIG = {
  model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
  temperature: 0,
  max_tokens: 150,
  response_format: { type: 'json_object' as const },
}

const TIMEOUT_MS = 8000

// =============================================================================
// POST /api/chat/intent
// =============================================================================

export async function POST(request: NextRequest) {
  try {
    // Get user ID for DB manifest loading
    const userId = resolveNoteWorkspaceUserId(request)

    // Parse request body
    const body = await request.json()
    const { message, context } = body

    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      return NextResponse.json(
        { error: 'Message is required' },
        { status: 400 }
      )
    }

    const userMessage = message.trim()

    // Check if OpenAI is configured
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json(
        {
          error: 'LLM not configured',
          intent: {
            intent: 'unsupported',
            args: { reason: 'Chat navigation is not configured' },
          } satisfies IntentResponse,
        },
        { status: 503 }
      )
    }

    // Call OpenAI
    // Pass userId to load DB manifests (widget manager widgets)
    const client = getOpenAIClient()
    const messages = await buildIntentMessages(
      userMessage,
      context,
      userId === 'invalid' ? null : userId
    )

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS)

    try {
      const completion = await client.chat.completions.create(
        {
          ...LLM_CONFIG,
          messages,
        },
        { signal: controller.signal }
      )

      clearTimeout(timeoutId)

      // Extract response
      const content = completion.choices[0]?.message?.content
      if (!content) {
        return NextResponse.json({
          intent: {
            intent: 'unsupported',
            args: { reason: 'No response from LLM' },
          } satisfies IntentResponse,
          supportedActions: SUPPORTED_ACTIONS_TEXT,
        })
      }

      // Parse and validate JSON response
      let rawJson: unknown
      try {
        rawJson = JSON.parse(content)
      } catch {
        return NextResponse.json({
          intent: {
            intent: 'unsupported',
            args: { reason: 'Invalid response format' },
          } satisfies IntentResponse,
          supportedActions: SUPPORTED_ACTIONS_TEXT,
        })
      }

      // Validate against schema
      const intent = parseIntentResponse(rawJson)

      return NextResponse.json({
        intent,
        supportedActions: intent.intent === 'unsupported' ? SUPPORTED_ACTIONS_TEXT : undefined,
      })
    } catch (error) {
      clearTimeout(timeoutId)

      if (error instanceof Error && error.name === 'AbortError') {
        return NextResponse.json(
          {
            error: 'Request timeout',
            intent: {
              intent: 'unsupported',
              args: { reason: 'Request timed out' },
            } satisfies IntentResponse,
          },
          { status: 504 }
        )
      }

      throw error
    }
  } catch (error) {
    console.error('[chat/intent] Error:', error)

    return NextResponse.json(
      {
        error: 'Failed to parse intent',
        intent: {
          intent: 'unsupported',
          args: { reason: 'Internal error' },
        } satisfies IntentResponse,
        supportedActions: SUPPORTED_ACTIONS_TEXT,
      },
      { status: 500 }
    )
  }
}
