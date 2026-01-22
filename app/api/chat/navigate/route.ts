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
import { extractLinkNotesBadge } from '@/lib/chat/ui-helpers'

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
// Clarification Interpretation (Phase 2a.3)
// =============================================================================

/**
 * Interpret user reply to a clarification question as YES/NO/META/UNCLEAR.
 * Uses a dedicated LLM prompt constrained to only return one of those values.
 * Per clarification-meta-response-plan.md: META handles explanation requests.
 */
async function interpretClarificationReply(
  client: OpenAI,
  userReply: string,
  clarificationQuestion: string
): Promise<'YES' | 'NO' | 'META' | 'UNCLEAR'> {
  try {
    const completion = await client.chat.completions.create({
      model: LLM_CONFIG.model,
      temperature: 0,
      max_tokens: 10,
      messages: [
        {
          role: 'system',
          content: `You interpret user responses to clarification questions.
Respond with EXACTLY one word: YES, NO, META, or UNCLEAR.

- YES: User is affirming, agreeing, or wants to proceed. Examples:
  - Direct: "yes", "yeah", "yep", "sure", "ok", "okay", "please do", "go ahead", "I guess so"
  - Question-style affirmations: "can you do that?", "could you?", "would you?", "can you?", "is that possible?"
  - These question forms mean "yes, please do it" in context
- NO: User is declining, rejecting, or wants to cancel (e.g., "no", "nope", "cancel", "never mind", "not really", "no thanks")
- META: User is asking for explanation or clarification about the question itself. Examples:
  - "what do you mean?", "explain", "help me understand"
  - "what are my options?", "what's the difference?"
  - "I'm not sure what that does", "can you tell me more?"
  - "huh?", "what?", "I don't know"
- UNCLEAR: User's intent is truly ambiguous or they're asking a completely different/unrelated question

Do not explain. Just output YES, NO, META, or UNCLEAR.`,
        },
        {
          role: 'user',
          content: `Clarification question: "${clarificationQuestion}"
User replied: "${userReply}"

Is this YES, NO, META, or UNCLEAR?`,
        },
      ],
    })

    const content = completion.choices[0]?.message?.content?.trim().toUpperCase()
    if (content === 'YES' || content === 'NO' || content === 'META' || content === 'UNCLEAR') {
      return content
    }
    return 'UNCLEAR'
  } catch (error) {
    console.error('[ChatNavigation] Clarification interpretation error:', error)
    return 'UNCLEAR'
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
    const { message, currentEntryId, currentWorkspaceId, context, clarificationMode, clarificationQuestion } = body

    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      return NextResponse.json(
        { error: 'Message is required' },
        { status: 400 }
      )
    }

    // Phase 2a.3: Handle clarification-mode interpretation
    // When clarificationMode is true, just interpret the reply as YES/NO/UNCLEAR
    if (clarificationMode && clarificationQuestion) {
      const client = getOpenAIClient()
      const interpretation = await interpretClarificationReply(client, message, clarificationQuestion)

      void debugLog({
        component: 'ChatNavigation',
        action: 'clarification_interpretation',
        metadata: { userReply: message, clarificationQuestion, interpretation },
      })

      return NextResponse.json({
        clarificationInterpretation: interpretation,
      })
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
      // UI context for current screen visibility
      uiContext: context.uiContext,
    } : undefined

    // DEBUG: Log context received from client
    console.log('[ChatNavigateAPI] context_received:', {
      chatContextLastOpenedPanel: context?.chatContext?.lastOpenedPanel?.title ?? null,
      uiContextOpenDrawer: context?.uiContext?.dashboard?.openDrawer?.title ?? null,
      uiContextOpenDrawerId: context?.uiContext?.dashboard?.openDrawer?.panelId ?? null,
      uiContextMode: context?.uiContext?.mode ?? null,
    })
    void debugLog({
      component: 'ChatNavigateAPI',
      action: 'context_received',
      metadata: {
        chatContextLastOpenedPanel: context?.chatContext?.lastOpenedPanel?.title ?? null,
        uiContextOpenDrawer: context?.uiContext?.dashboard?.openDrawer?.title ?? null,
        uiContextMode: context?.uiContext?.mode ?? null,
      },
    })

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

    // DEBUG: Log LLM response for "what panel is open?" questions
    console.log('[ChatNavigateAPI] LLM_intent_response:', {
      intent: intent.intent,
      contextAnswer: intent.args?.contextAnswer ?? null,
      userMessage,
    })

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

    // Deterministic badge detection for Link Notes
    // Per link-notes-generic-disambiguation-fix.md: "Keep deterministic action routing (no LLM dependence)"
    // If user explicitly says "link notes f", extract badge deterministically
    const explicitLinkNotesBadge = extractLinkNotesBadge(userMessage)

    // Deterministic intent override for explicit Link Notes badge
    // If user explicitly said "link notes X" but LLM returned wrong intent, override to show_quick_links
    // This ensures consistent behavior regardless of LLM variance
    if (explicitLinkNotesBadge && intent.intent !== 'show_quick_links') {
      void debugLog({
        component: 'ChatNavigation',
        action: 'deterministic_link_notes_override',
        metadata: {
          originalIntent: intent.intent,
          explicitBadge: explicitLinkNotesBadge,
          userMessage: userMessage.substring(0, 50),
        },
      })
      intent = {
        intent: 'show_quick_links',
        args: {
          ...intent.args,
          quickLinksPanelBadge: explicitLinkNotesBadge,
        },
      }
    }

    const resolutionContext = {
      userId,
      currentEntryId: currentEntryId || undefined,
      currentEntryName,
      currentWorkspaceId: currentWorkspaceId || undefined,
      homeEntryId,
      sessionState: conversationContext?.sessionState,
      visiblePanels: context?.visiblePanels,
      // Visible widgets with panel IDs for exact-match resolution (Step 1 of ambiguity guard)
      visibleWidgets: context?.uiContext?.dashboard?.visibleWidgets,
      // Panel write confirmation bypass (from confirm_panel_write flow)
      bypassPanelWriteConfirmation: context?.bypassPanelWriteConfirmation,
      pendingPanelIntent: context?.pendingPanelIntent,
      // Deterministic preview mode fallback
      forcePreviewMode,
      // Raw user message for deterministic badge extraction fallback
      // (per link-notes-generic-disambiguation-fix.md)
      rawUserMessage: userMessage,
      // Explicit Link Notes badge extracted from user input (deterministic)
      explicitLinkNotesBadge,
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

    // Phase 1: Expanded question detector
    // Matches: starts with question word, ends with "?", contains question phrases,
    // or starts with "tell me/give me" + question cue
    const QUESTION_START_REGEX =
      /^(what|why|how|where|when|who|which|do|does|did|is|are|was|were|can|could|should|would|may|might)\b/i
    const QUESTION_PHRASE_REGEX = /(what's|what is|which one|how many|is there|are there)/i
    // "tell me/give me" + question cue pattern (e.g., "tell me what widgets are visible")
    const TELL_GIVE_WITH_CUE_REGEX = /^(tell me|give me)\b.*\b(what|which|how many|is there|are there)\b/i
    const isQuestionLike =
      QUESTION_START_REGEX.test(normalizedInput) ||
      normalizedInput.endsWith('?') ||
      QUESTION_PHRASE_REGEX.test(normalizedInput) ||
      TELL_GIVE_WITH_CUE_REGEX.test(normalizedInput)

    // Verify query guard: "did I open/rename/delete..." should go to LLM, not typo fallback
    // These are verify_action or verify_request intents that the LLM should handle
    const isVerifyQuery = /^did\s+i\b/i.test(normalizedInput)

    // Explicit Link Notes badge guard
    // Per link-notes-generic-disambiguation-fix.md: When user explicitly says "link notes F",
    // NEVER fuzzy-match to another badge - show clear error if not found
    const hasExplicitLinkNotesBadge = !!explicitLinkNotesBadge

    // Phase 1a: Error Message Preservation
    // Only apply typo fallback when:
    // 1. LLM returned 'unsupported' intent (not a valid intent that failed resolution)
    // 2. AND input is not a question (questions should get LLM's unsupported reason, not typo suggestions)
    // 3. AND no active clarification (Phase 2a.3: let LLM interpret clarification replies)
    // 4. AND no explicit Link Notes badge (don't fuzzy-match badge letters)
    if (!resolution.success && resolution.action === 'error' && intent.intent === 'unsupported' && !isQuestionLike && !context?.lastClarification && !hasExplicitLinkNotesBadge) {
      suggestions = getSuggestions(userMessage, suggestionContext)
      if (suggestions) {
        // Replace generic unsupported message with friendly suggestion
        resolution.message = suggestions.message
      }
    } else if (!hasVerb && !isVerifyQuery && !isQuestionLike && !context?.pendingOptions?.length && !context?.lastClarification) {
      // If the input has no verb and is not a verify query, don't let the LLM guess.
      // Only override when the input is not an exact match to a known command.
      // Phase 2a.2: Skip typo fallback when pendingOptions or lastClarification exist - let LLM handle with context
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

    // Phase 2a.3: Detect clarification questions and add metadata
    // This allows frontend to set clarification state from metadata, not text matching
    type ClarificationMetadata = {
      id: string
      nextAction: 'show_workspace_picker'
      originalIntent: string
    }
    let clarification: ClarificationMetadata | undefined

    // Detect notes-scope clarification (intent-based, not text-based)
    // Conditions:
    // 1. User asked about notes (open notes, which notes, etc.)
    // 2. AND we're on the dashboard (not in a workspace)
    // 3. AND the LLM returned answer_from_context (clarification response)
    const NOTES_QUESTION_PATTERN = /\b(open\s+notes?|which\s+notes?|what\s+notes?|notes?\s+(are\s+)?open|list\s+(the\s+)?notes?)\b/i
    const isNotesQuestion = NOTES_QUESTION_PATTERN.test(userMessage)
    const isOnDashboard = context?.uiContext?.mode === 'dashboard'
    const isAnswerFromContext = intent.intent === 'answer_from_context'

    if (isNotesQuestion && isOnDashboard && isAnswerFromContext) {
      clarification = {
        id: 'notes_scope',
        nextAction: 'show_workspace_picker',
        originalIntent: 'list_open_notes',
      }

      void debugLog({
        component: 'ChatNavigation',
        action: 'notes_scope_clarification_detected',
        metadata: {
          userMessage: userMessage.substring(0, 50),
          uiMode: context?.uiContext?.mode,
          intent: intent.intent,
        },
      })
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
      // Phase 2a.3: Clarification metadata for deterministic handling
      clarification,
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
