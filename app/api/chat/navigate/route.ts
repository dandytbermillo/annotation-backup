import { NextRequest, NextResponse } from 'next/server'
import OpenAI from 'openai'
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'

import { debugLog } from '@/lib/utils/debug-logger'
import { serverPool } from '@/lib/db/pool'
import { buildIntentMessages, type ConversationContext, type SessionState } from '@/lib/chat/intent-prompt'
import {
  parseIntentResponse,
  type IntentResponse,
} from '@/lib/chat/intent-schema'
import { resolveIntent, type IntentResolutionResult } from '@/lib/chat/intent-resolver'
import { getSuggestions, type SuggestionResult, type DynamicSuggestionContext } from '@/lib/chat/typo-suggestions'
import { panelRegistry } from '@/lib/panels/panel-registry'
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
const MAX_CONTEXT_RETRIES = 1  // Max retries for need_context loop

// =============================================================================
// Context Helpers
// =============================================================================

/**
 * Build expanded context based on LLM's request.
 * Per llm-context-retrieval-general-answers-plan.md:
 * Server fetches additional context from chat history.
 */
function buildExpandedContext(
  contextRequest: string,
  originalContext: ConversationContext | undefined,
  fullChatHistory?: Array<{ role: string; content: string }>
): ConversationContext {
  const base = originalContext || {}
  const lower = contextRequest.toLowerCase()

  // Determine what additional context to include based on the request
  let expandedMessages: string[] = []

  if (fullChatHistory && fullChatHistory.length > 0) {
    // Extract messages based on request type
    if (lower.includes('assistant') || lower.includes('response')) {
      // Get assistant messages
      expandedMessages = fullChatHistory
        .filter(m => m.role === 'assistant')
        .map(m => `[Assistant]: ${m.content}`)
        .slice(-10) // Last 10 assistant messages
    } else if (lower.includes('user') || lower.includes('message')) {
      // Get user messages
      expandedMessages = fullChatHistory
        .filter(m => m.role === 'user')
        .map(m => `[User]: ${m.content}`)
        .slice(-10)
    } else {
      // Get full conversation (interleaved)
      expandedMessages = fullChatHistory
        .slice(-20) // Last 20 messages total
        .map(m => `[${m.role === 'user' ? 'User' : 'Assistant'}]: ${m.content}`)
    }
  }

  return {
    ...base,
    // Override recentUserMessages with expanded context
    recentUserMessages: expandedMessages.length > 0 ? expandedMessages : base.recentUserMessages,
    // Add a summary indicating this is expanded context
    summary: expandedMessages.length > 0
      ? `Expanded context (${expandedMessages.length} messages) per request: "${contextRequest}"`
      : base.summary,
  }
}

/**
 * Get server time formatted for general_answer responses.
 */
function getServerTimeString(): string {
  const now = new Date()
  return now.toLocaleString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    timeZoneName: 'short',
  })
}

/**
 * Call LLM to parse intent from user message.
 * Returns parsed IntentResponse or error.
 */
async function callLLMForIntent(
  client: OpenAI,
  userMessage: string,
  conversationContext: ConversationContext | undefined,
  userId: string | null
): Promise<{ intent: IntentResponse; error?: string }> {
  const messages = await buildIntentMessages(userMessage, conversationContext, userId)

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

    const content = completion.choices[0]?.message?.content
    if (!content) {
      return {
        intent: {
          intent: 'unsupported',
          args: { reason: 'No response from assistant' },
        },
      }
    }

    try {
      const rawJson = JSON.parse(content)
      return { intent: parseIntentResponse(rawJson) }
    } catch {
      return {
        intent: {
          intent: 'unsupported',
          args: { reason: 'Could not understand the request' },
        },
      }
    }
  } catch (error) {
    clearTimeout(timeoutId)

    if (error instanceof Error && error.name === 'AbortError') {
      return {
        intent: { intent: 'unsupported', args: { reason: 'Request timeout' } },
        error: 'timeout',
      }
    }

    throw error
  }
}

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

    // Extract conversation context (optional), session state, pending options, visibility, and chatContext
    const conversationContext: ConversationContext | undefined = context ? {
      summary: context.summary,
      recentUserMessages: context.recentUserMessages,
      lastAssistantQuestion: context.lastAssistantQuestion,
      sessionState: context.sessionState,
      pendingOptions: context.pendingOptions,
      // Panel visibility context (from client)
      visiblePanels: context.visiblePanels,
      focusedPanelId: context.focusedPanelId,
      // Chat context for LLM clarification answers (per llm-chat-context-first-plan.md)
      chatContext: context.chatContext,
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
    // Pass userId to load DB widget manifests (server-side)
    const client = getOpenAIClient()

    // Initial LLM call
    let llmResult = await callLLMForIntent(client, userMessage, conversationContext, userId)

    if (llmResult.error === 'timeout') {
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

    let intent: IntentResponse = llmResult.intent

    // Step 1.5: Handle need_context loop
    // Per llm-context-retrieval-general-answers-plan.md:
    // If LLM returns need_context, fetch expanded context and re-call LLM (max 1 retry)
    let contextRetryCount = 0
    const fullChatHistory = context?.fullChatHistory as Array<{ role: string; content: string }> | undefined

    while (intent.intent === 'need_context' && contextRetryCount < MAX_CONTEXT_RETRIES) {
      contextRetryCount++
      const contextRequest = intent.args.contextRequest || 'full conversation'

      void debugLog({
        component: 'ChatNavigation',
        action: 'need_context_retry',
        metadata: {
          retryCount: contextRetryCount,
          contextRequest,
          hasFullHistory: !!fullChatHistory,
          historyLength: fullChatHistory?.length || 0,
        },
      })

      // Build expanded context based on LLM's request
      const expandedContext = buildExpandedContext(contextRequest, conversationContext, fullChatHistory)

      // Re-call LLM with expanded context
      llmResult = await callLLMForIntent(client, userMessage, expandedContext, userId)

      if (llmResult.error === 'timeout') {
        return NextResponse.json(
          {
            error: 'Request timeout',
            resolution: {
              success: false,
              action: 'error',
              message: 'Request timed out while fetching additional context. Please try again.',
            } satisfies IntentResolutionResult,
          },
          { status: 504 }
        )
      }

      intent = llmResult.intent
    }

    // If still need_context after max retries, ask user for clarification
    if (intent.intent === 'need_context') {
      intent = {
        intent: 'unsupported',
        args: {
          reason: "I couldn't find enough context to answer that. Could you provide more details or rephrase your question?",
        },
      }
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

    // Deterministic fallback: detect preview keywords in raw input
    // Per panel-intent-registry-plan.md "Routing Precedence":
    // If raw input includes "list", "preview", "in the chatbox", or "in chat",
    // force preview mode even if the LLM chose a drawer-style intent.
    const PREVIEW_KEYWORDS_REGEX = /\b(list|preview)\b|in the chatbox|in chat/i
    const forcePreviewMode = PREVIEW_KEYWORDS_REGEX.test(userMessage)

    const resolutionContext = {
      userId,
      currentEntryId: currentEntryId || undefined,
      currentEntryName,
      currentWorkspaceId: currentWorkspaceId || undefined,
      homeEntryId,
      sessionState: conversationContext?.sessionState,
      visiblePanels: context?.visiblePanels,
      // Panel write confirmation bypass (from confirm_panel_write flow)
      bypassPanelWriteConfirmation: context?.bypassPanelWriteConfirmation,
      pendingPanelIntent: context?.pendingPanelIntent,
      // Deterministic preview mode fallback
      forcePreviewMode,
      // Pending options for reshow_options intent
      pendingOptions: conversationContext?.pendingOptions,
    }

    const resolution = await resolveIntent(intent, resolutionContext)

    // Step 3: Handle general_answer with time replacement
    // Per llm-context-retrieval-general-answers-plan.md:
    // For time questions, replace placeholder with actual server time
    if (resolution.action === 'general_answer' && resolution.generalAnswerType === 'time') {
      const serverTime = getServerTimeString()
      // Replace placeholder or provide the time directly
      if (resolution.message === 'TIME_PLACEHOLDER' || resolution.message.includes('TIME_PLACEHOLDER')) {
        resolution.message = `It's currently ${serverTime}.`
      } else {
        // LLM might have guessed a time - replace with accurate server time
        resolution.message = `It's currently ${serverTime}.`
      }
    }

    // Generate friendly suggestions for unsupported intents (typo fallback)
    // Build dynamic context from panel registry (includes DB-loaded widgets after buildIntentMessages)
    const suggestionContext: DynamicSuggestionContext = {
      manifests: panelRegistry.getAll(),
      visiblePanels: context?.visiblePanels,
    }

    let suggestions: SuggestionResult | null = null
    const normalizedInput = userMessage.toLowerCase().replace(/\s+/g, ' ').trim()
    const VERB_REGEX = /\b(open|show|view|display|list|go|back|rename|delete|create|add|remove|close)\b/i
    const hasVerb = VERB_REGEX.test(normalizedInput)

    // Verify query guard: "did I open/rename/delete..." should go to LLM, not typo fallback
    // These are verify_action or verify_request intents that the LLM should handle
    const isVerifyQuery = /^did\s+i\b/i.test(normalizedInput)

    if (!resolution.success && resolution.action === 'error') {
      suggestions = getSuggestions(userMessage, suggestionContext)
      if (suggestions) {
        // Replace generic error with friendly suggestion
        resolution.message = suggestions.message
      }
    } else if (!hasVerb && !isVerifyQuery) {
      // If the input has no verb and is not a verify query, don't let the LLM guess.
      // Only override when the input is not an exact match to a known command.
      const typoSuggestion = getSuggestions(userMessage, suggestionContext)
      const topCandidate = typoSuggestion?.candidates[0]
      const isExactMatch = Boolean(
        topCandidate &&
        topCandidate.score >= 0.99 &&
        normalizedInput === topCandidate.command
      )

      if (typoSuggestion && !isExactMatch) {
        suggestions = typoSuggestion
        resolution.success = false
        resolution.action = 'error'
        resolution.message = typoSuggestion.message
      }
    }

    return NextResponse.json({
      intent,
      resolution,
      // Include suggestions for UI to render buttons
      suggestions: suggestions?.showButtons ? {
        type: suggestions.type,
        candidates: suggestions.candidates.map(c => ({
          label: c.label,
          intentName: c.intentName,
          panelId: c.panelId,
          primaryAction: c.primaryAction,
        })),
      } : undefined,
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
