import { NextRequest, NextResponse } from 'next/server'
import OpenAI from 'openai'

import { debugLog } from '@/lib/utils/debug-logger'
import { buildIntentMessages } from '@/lib/chat/intent-prompt'
import {
  parseIntentResponse,
  SUPPORTED_ACTIONS_TEXT,
  type IntentResponse,
} from '@/lib/chat/intent-schema'
import { resolveIntent, type IntentResolutionResult } from '@/lib/chat/intent-resolver'
import { resolveNoteWorkspaceUserId } from '@/app/api/note-workspaces/user-id'

// =============================================================================
// OpenAI Client
// =============================================================================

// Hardcoded API key for development - bypasses all environment issues
const OPENAI_API_KEY_HARDCODED = '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'

function getOpenAIClient(): OpenAI {
  return new OpenAI({ apiKey: OPENAI_API_KEY_HARDCODED })
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
// POST /api/chat/navigate
//
// Combined endpoint: parse intent + resolve to actionable data
// =============================================================================

export async function POST(request: NextRequest) {
  try {
    // Get user ID
    const userId = resolveNoteWorkspaceUserId(request)
    if (userId === 'invalid') {
      return NextResponse.json({ error: 'Invalid userId' }, { status: 400 })
    }

    // Parse request body
    const body = await request.json()
    const { message, currentEntryId, currentWorkspaceId } = body

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
          error: 'Chat navigation is not configured',
          resolution: {
            success: false,
            action: 'error',
            message: 'Chat navigation is not configured. Please set OPENAI_API_KEY.',
          } satisfies IntentResolutionResult,
        },
        { status: 503 }
      )
    }

    // Step 1: Parse intent with LLM
    const client = getOpenAIClient()
    const messages = buildIntentMessages(userMessage)

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS)

    let intent: IntentResponse

    try {
      const completion = await client.chat.completions.create(
        {
          ...LLM_CONFIG,
          messages,
        },
        { signal: controller.signal }
      )

      clearTimeout(timeoutId)

      const content = completion.choices[0]?.message?.content
      if (!content) {
        intent = {
          intent: 'unsupported',
          args: { reason: 'No response from assistant' },
        }
      } else {
        try {
          const rawJson = JSON.parse(content)
          intent = parseIntentResponse(rawJson)
        } catch {
          intent = {
            intent: 'unsupported',
            args: { reason: 'Could not understand the request' },
          }
        }
      }
    } catch (error) {
      clearTimeout(timeoutId)

      if (error instanceof Error && error.name === 'AbortError') {
        return NextResponse.json(
          {
            error: 'Request timeout',
            resolution: {
              success: false,
              action: 'error',
              message: 'Request timed out. Please try again.',
            } satisfies IntentResolutionResult,
          },
          { status: 504 }
        )
      }

      throw error
    }

    // Step 2: Resolve intent to actionable data
    const context = {
      userId,
      currentEntryId: currentEntryId || undefined,
      currentWorkspaceId: currentWorkspaceId || undefined,
    }

    const resolution = await resolveIntent(intent, context)

    // Add supported actions hint if unsupported
    if (!resolution.success && resolution.action === 'error') {
      resolution.message += ` I can help with: ${SUPPORTED_ACTIONS_TEXT}.`
    }

    return NextResponse.json({
      intent,
      resolution,
    })
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    const errorStack = error instanceof Error ? error.stack : undefined

    void debugLog({
      component: 'ChatNavigation',
      action: 'api_error',
      metadata: {
        error: errorMessage,
        stack: errorStack,
      },
    })

    return NextResponse.json(
      {
        error: 'Failed to process request',
        errorDetails: errorMessage, // Include error details in response for debugging
        resolution: {
          success: false,
          action: 'error',
          message: `Something went wrong: ${errorMessage}`,
        } satisfies IntentResolutionResult,
      },
      { status: 500 }
    )
  }
}
