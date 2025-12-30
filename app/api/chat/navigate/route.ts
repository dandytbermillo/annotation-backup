import { NextRequest, NextResponse } from 'next/server'
import OpenAI from 'openai'
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'

import { debugLog } from '@/lib/utils/debug-logger'
import { serverPool } from '@/lib/db/pool'
import { buildIntentMessages, type ConversationContext, type SessionState } from '@/lib/chat/intent-prompt'
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

/**
 * Get OpenAI API key from multiple sources (in priority order):
 * 1. Environment variable (process.env.OPENAI_API_KEY)
 * 2. Config file (config/secrets.json) - gitignored, for local dev
 */
function getOpenAIApiKey(): string | null {
  // Try environment variable first (but validate it's a real key, not a placeholder)
  const envKey = process.env.OPENAI_API_KEY
  if (envKey && envKey.startsWith('sk-') && envKey.length > 40 && !envKey.includes('paste')) {
    return envKey
  }

  // Fallback to config file (for when env vars don't load properly or are placeholders)
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
    throw new Error('OPENAI_API_KEY not found in env or config/secrets.json')
  }
  return new OpenAI({ apiKey })
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
// Context Helpers
// =============================================================================

/**
 * Fetch Home entry ID for the user (for "already on Home" detection)
 */
async function fetchHomeEntryId(userId: string): Promise<string | undefined> {
  try {
    const result = await serverPool.query(
      `SELECT id FROM items
       WHERE is_system = TRUE AND name = 'Home' AND user_id = $1 AND deleted_at IS NULL
       LIMIT 1`,
      [userId]
    )
    return result.rows[0]?.id
  } catch {
    return undefined
  }
}

/**
 * Fetch entry name by ID (for better UX messages)
 */
async function fetchEntryName(entryId: string): Promise<string | undefined> {
  try {
    const result = await serverPool.query(
      `SELECT name FROM items WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
      [entryId]
    )
    return result.rows[0]?.name
  } catch {
    return undefined
  }
}

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
    const { message, currentEntryId, currentWorkspaceId, context } = body

    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      return NextResponse.json(
        { error: 'Message is required' },
        { status: 400 }
      )
    }

    const userMessage = message.trim()

    // Extract conversation context (optional) and session state
    const conversationContext: ConversationContext | undefined = context ? {
      summary: context.summary,
      recentUserMessages: context.recentUserMessages,
      lastAssistantQuestion: context.lastAssistantQuestion,
      sessionState: context.sessionState,
    } : undefined

    // Check if OpenAI is configured
    const apiKey = getOpenAIApiKey()
    if (!apiKey) {
      return NextResponse.json(
        {
          error: 'Chat navigation is not configured',
          resolution: {
            success: false,
            action: 'error',
            message: 'Chat navigation is not configured. Please set OPENAI_API_KEY in .env.local or config/secrets.json.',
          } satisfies IntentResolutionResult,
        },
        { status: 503 }
      )
    }

    // Step 1: Parse intent with LLM
    const client = getOpenAIClient()
    const messages = buildIntentMessages(userMessage, conversationContext)

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
    // Conditional context fetch optimization: only fetch what the intent needs
    // - go_home: needs homeEntryId (for "already on Home" detection)
    // - go_to_dashboard: needs currentEntryName (for "already on X's dashboard" message)
    // - All other intents: skip both lookups
    const needsHomeEntry = intent.intent === 'go_home'
    const needsEntryName = intent.intent === 'go_to_dashboard'

    // Use sessionState.currentEntryName if available, otherwise fetch from DB
    const sessionEntryName = conversationContext?.sessionState?.currentEntryName

    const [homeEntryId, currentEntryName] = await Promise.all([
      needsHomeEntry ? fetchHomeEntryId(userId) : Promise.resolve(undefined),
      needsEntryName && !sessionEntryName && currentEntryId
        ? fetchEntryName(currentEntryId)
        : Promise.resolve(sessionEntryName),
    ])

    const resolutionContext = {
      userId,
      currentEntryId: currentEntryId || undefined,
      currentEntryName,
      currentWorkspaceId: currentWorkspaceId || undefined,
      homeEntryId,
      sessionState: conversationContext?.sessionState,
    }

    const resolution = await resolveIntent(intent, resolutionContext)

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
