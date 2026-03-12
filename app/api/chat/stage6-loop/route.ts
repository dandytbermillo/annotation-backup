/**
 * Stage 6: Agent Tool Loop — Server Route (Slice 6.3)
 *
 * POST /api/chat/stage6-loop
 *
 * Runs the multi-turn LLM tool loop for Stage 6. Receives pre-computed
 * client-side snapshots and the loop input, runs Gemini in a loop
 * (inspect → decide → inspect → …), and returns an S6LoopResult.
 *
 * Shadow mode: the caller (client-side controller) decides whether to
 * execute the returned action. This route only decides, never executes.
 *
 * Feature flag: STAGE6_SHADOW_ENABLED (server-side)
 */

import { NextRequest, NextResponse } from 'next/server'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { serverPool } from '@/lib/db/pool'
import { resolveNoteWorkspaceUserId } from '@/app/api/note-workspaces/user-id'
import type {
  S6LoopInput,
  S6LoopResult,
  S6LoopOutcome,
  S6LoopTelemetry,
  S6EscalationReason,
  S6InspectDashboardResponse,
  S6InspectActiveWidgetResponse,
  S6InspectVisibleItemsResponse,
} from '@/lib/chat/stage6-tool-contracts'
import { S6_INSPECT_LIMITS } from '@/lib/chat/stage6-tool-contracts'
import type { S6ActionResult } from '@/lib/chat/stage6-tool-contracts'
import {
  validateOpenPanel,
  validateOpenWidgetItem,
  validateNavigateEntry,
} from '@/lib/chat/stage6-action-validators'
import type { ActionValidationSnapshots } from '@/lib/chat/stage6-action-validators'
import { SchemaType } from '@google/generative-ai'
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'

// ============================================================================
// Types
// ============================================================================

interface ClientSnapshots {
  dashboard: S6InspectDashboardResponse
  activeWidget: S6InspectActiveWidgetResponse
  visibleItems: S6InspectVisibleItemsResponse
}

interface ParsedLLMResponse {
  type: string
  tool?: string
  action?: string
  widgetId?: string
  itemId?: string
  panelSlug?: string
  entryId?: string
  reason?: string
  candidateIds?: string[]
  query?: string
  limit?: number
  windowDays?: number
}

// ============================================================================
// Configuration
// ============================================================================

const LLM_TIMEOUT_PER_TURN_MS = 3000

/**
 * Gemini response schema for structured JSON output.
 * Flat object with `type` as a required enum discriminant.
 * All action/inspect fields are optional — validated per-type after parse.
 */
const S6_RESPONSE_SCHEMA: import('@google/generative-ai').ObjectSchema = {
  type: SchemaType.OBJECT,
  properties: {
    type: {
      type: SchemaType.STRING,
      format: 'enum' as const,
      enum: ['inspect', 'action', 'clarify', 'abort'],
      description: 'Response type: inspect a tool, take an action, clarify with user, or abort',
    },
    tool: {
      type: SchemaType.STRING,
      description: 'Inspect tool name (required when type=inspect)',
    },
    action: {
      type: SchemaType.STRING,
      format: 'enum' as const,
      enum: ['open_panel', 'open_widget_item', 'navigate_entry'],
      description: 'Action type (required when type=action)',
    },
    panelSlug: {
      type: SchemaType.STRING,
      description: 'Widget ID from inspect_dashboard (required for open_panel)',
    },
    widgetId: {
      type: SchemaType.STRING,
      description: 'Widget ID (required for open_widget_item)',
    },
    itemId: {
      type: SchemaType.STRING,
      description: 'Item ID from inspect results (required for open_widget_item)',
    },
    entryId: {
      type: SchemaType.STRING,
      description: 'Entry ID from inspect results (required for navigate_entry)',
    },
    candidateIds: {
      type: SchemaType.ARRAY,
      items: { type: SchemaType.STRING },
      description: 'IDs of ambiguous candidates (required when type=clarify)',
    },
    reason: {
      type: SchemaType.STRING,
      description: 'Explanation for the decision',
    },
    query: {
      type: SchemaType.STRING,
      description: 'Search query (for inspect_search)',
    },
    limit: {
      type: SchemaType.INTEGER,
      description: 'Max results (for inspect_search)',
    },
    windowDays: {
      type: SchemaType.INTEGER,
      description: 'Days to look back (for inspect_recent_items)',
    },
  },
  required: ['type'],
}

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

// ============================================================================
// Prompt
// ============================================================================

function buildSystemPrompt(maxRounds: number): string {
  return `You are a navigation agent for a dashboard application. A previous routing system could not resolve the user's request. You can inspect the dashboard state, then decide what to do.

INSPECTION TOOLS (read-only, use to gather info):
- {"type":"inspect","tool":"inspect_dashboard"} — returns all open panels/widgets with their IDs and labels
- {"type":"inspect","tool":"inspect_active_widget"} — returns the focused widget's details
- {"type":"inspect","tool":"inspect_visible_items"} — returns items visible across all open widgets
- {"type":"inspect","tool":"inspect_recent_items","windowDays":7} — returns recently accessed items
- {"type":"inspect","tool":"inspect_search","query":"search text","limit":10} — searches item names

TERMINAL ACTIONS (choose exactly one when ready):
- {"type":"action","action":"open_panel","panelSlug":"<widgetId from inspect_dashboard>","reason":"..."}
- {"type":"action","action":"open_widget_item","widgetId":"...","itemId":"...","reason":"..."}
- {"type":"action","action":"navigate_entry","entryId":"...","reason":"..."}
- {"type":"clarify","candidateIds":["id1","id2"],"reason":"..."}
- {"type":"abort","reason":"..."}

RULES:
1. Respond with ONLY valid JSON. No markdown, no explanation.
2. Start with the most relevant inspect tool. Use inspect_dashboard first when the request refers to a panel or dashboard element. Use inspect_recent_items or inspect_search first when the request refers to a previously accessed item or content.
3. For open_panel: the panelSlug MUST be a widgetId value copied exactly from inspect_dashboard results. Panels are the widgets shown on the dashboard.
4. ALL target IDs (panelSlug, widgetId, itemId, entryId) MUST be copied character-for-character from tool results. NEVER fabricate, guess, or modify IDs.
5. ACT when exactly one target matches the user's intent — do not clarify single matches.
6. CLARIFY only when 2+ targets match with no distinguishing signal.
7. ABORT only when no target matches at all after inspecting available state.
8. You may call at most ${maxRounds} inspection tools before deciding.`
}

function buildUserMessage(input: S6LoopInput): string {
  const lines: string[] = []

  lines.push(`User request: "${input.userInput}"`)
  lines.push(`Escalation reason: ${input.escalationReason}`)

  if (input.groundingCandidates.length > 0) {
    lines.push(`Grounding candidates:`)
    for (const c of input.groundingCandidates) {
      lines.push(`  - ID="${c.id}" Label="${c.label}" Source="${c.source}"${c.widgetId ? ` Widget="${c.widgetId}"` : ''}`)
    }
  } else {
    lines.push(`No grounding candidates available.`)
  }

  lines.push(`Dashboard: ${input.dashboardSnapshot.dashboardName} (${input.dashboardSnapshot.widgetCount} widgets)`)
  for (const w of input.dashboardSnapshot.widgets) {
    lines.push(`  - Widget="${w.widgetId}" Label="${w.label}" Items=${w.itemCount}`)
  }

  lines.push(`\nWhat do you do? JSON only.`)
  return lines.join('\n')
}

// ============================================================================
// JSON Parser (same as grounding-llm route)
// ============================================================================

function safeParseJson(value: string): ParsedLLMResponse | null {
  try {
    let cleaned = value.trim()
    if (cleaned.startsWith('```json')) cleaned = cleaned.slice(7)
    else if (cleaned.startsWith('```')) cleaned = cleaned.slice(3)
    if (cleaned.endsWith('```')) cleaned = cleaned.slice(0, -3)
    return JSON.parse(cleaned.trim()) as ParsedLLMResponse
  } catch {
    return null
  }
}

/**
 * Validate required fields per response type.
 * Returns null if valid, or an error string describing what's missing.
 */
function validateResponseStructure(parsed: ParsedLLMResponse): string | null {
  const VALID_TYPES = ['inspect', 'action', 'clarify', 'abort']
  if (!VALID_TYPES.includes(parsed.type)) {
    return `Invalid type "${parsed.type}". Must be one of: ${VALID_TYPES.join(', ')}`
  }

  if (parsed.type === 'inspect') {
    const VALID_TOOLS = ['inspect_dashboard', 'inspect_active_widget', 'inspect_visible_items', 'inspect_recent_items', 'inspect_search']
    if (!parsed.tool || !VALID_TOOLS.includes(parsed.tool)) {
      return `type=inspect requires a valid "tool" field. Valid tools: ${VALID_TOOLS.join(', ')}`
    }
    if (parsed.tool === 'inspect_search' && !parsed.query) {
      return 'inspect_search requires a "query" field'
    }
  }

  if (parsed.type === 'action') {
    const VALID_ACTIONS = ['open_panel', 'open_widget_item', 'navigate_entry']
    if (!parsed.action || !VALID_ACTIONS.includes(parsed.action)) {
      return `type=action requires a valid "action" field. Valid actions: ${VALID_ACTIONS.join(', ')}`
    }
    if (parsed.action === 'open_panel' && !parsed.panelSlug) {
      return 'open_panel requires a "panelSlug" field (use a widgetId from inspect_dashboard)'
    }
    if (parsed.action === 'open_widget_item' && (!parsed.widgetId || !parsed.itemId)) {
      return 'open_widget_item requires "widgetId" and "itemId" fields'
    }
    if (parsed.action === 'navigate_entry' && !parsed.entryId) {
      return 'navigate_entry requires an "entryId" field'
    }
  }

  if (parsed.type === 'clarify') {
    if (!parsed.candidateIds || parsed.candidateIds.length === 0) {
      return 'type=clarify requires a non-empty "candidateIds" array'
    }
  }

  return null
}

// ============================================================================
// Server-Side Inspect Handlers
// ============================================================================

async function handleServerInspect(
  tool: string,
  params: ParsedLLMResponse,
  clientSnapshots: ClientSnapshots,
  userId: string,
): Promise<unknown> {
  switch (tool) {
    case 'inspect_dashboard':
      return clientSnapshots.dashboard.status === 'ok'
        ? clientSnapshots.dashboard.data
        : null
    case 'inspect_active_widget':
      return clientSnapshots.activeWidget.status === 'ok'
        ? clientSnapshots.activeWidget.data
        : null
    case 'inspect_visible_items':
      return clientSnapshots.visibleItems.status === 'ok'
        ? clientSnapshots.visibleItems.data
        : null
    case 'inspect_recent_items':
      return await queryRecentItems(userId, params.windowDays)
    case 'inspect_search':
      return await querySearchItems(userId, params.query ?? '', params.limit)
    default:
      return { error: `Unknown tool: ${tool}` }
  }
}

async function queryRecentItems(userId: string, windowDays?: number) {
  const days = Math.min(
    windowDays ?? S6_INSPECT_LIMITS.RECENT_ITEMS_DEFAULT_DAYS,
    S6_INSPECT_LIMITS.RECENT_ITEMS_MAX_DAYS,
  )
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000)

  const { rows } = await serverPool.query(
    `SELECT id, name, last_accessed_at
     FROM items
     WHERE user_id = $1 AND type = 'note' AND deleted_at IS NULL
       AND last_accessed_at IS NOT NULL AND last_accessed_at > $2
     ORDER BY last_accessed_at DESC
     LIMIT 25`,
    [userId, cutoff.toISOString()],
  )

  return {
    items: rows.map((r: Record<string, unknown>) => ({
      id: r.id,
      label: r.name,
      widgetId: '',
      lastAccessedAt: r.last_accessed_at,
    })),
    windowDays: days,
    capturedAtMs: Date.now(),
  }
}

async function querySearchItems(userId: string, query: string, limit?: number) {
  const maxResults = Math.min(
    limit ?? S6_INSPECT_LIMITS.SEARCH_DEFAULT_RESULTS,
    S6_INSPECT_LIMITS.SEARCH_MAX_RESULTS,
  )

  if (!query.trim()) {
    return { query, results: [], totalMatches: 0, capturedAtMs: Date.now() }
  }

  const pattern = `%${query}%`
  const { rows } = await serverPool.query(
    `SELECT id, name
     FROM items
     WHERE user_id = $1 AND deleted_at IS NULL AND name ILIKE $2
     ORDER BY CASE WHEN name ILIKE $2 THEN 0 ELSE 1 END, length(name)
     LIMIT $3`,
    [userId, pattern, maxResults],
  )

  const queryLower = query.toLowerCase()
  return {
    query,
    results: rows.map((r: Record<string, unknown>) => {
      const name = r.name as string
      const nameLower = name.toLowerCase()
      let score = 0.4
      if (nameLower === queryLower) score = 1.0
      else if (nameLower.startsWith(queryLower)) score = 0.9
      else if (nameLower.includes(queryLower)) score = 0.7
      return {
        id: r.id,
        label: name,
        widgetId: '',
        snippet: name.slice(0, S6_INSPECT_LIMITS.SEARCH_SNIPPET_MAX_CHARS),
        score,
      }
    }),
    totalMatches: rows.length,
    capturedAtMs: Date.now(),
  }
}

// ============================================================================
// Result Builder
// ============================================================================

function buildLoopResult(
  outcome: S6LoopOutcome,
  inspectRoundsUsed: number,
  toolTrace: string[],
  startTime: number,
  escalationReason: S6EscalationReason,
  parsed?: ParsedLLMResponse | null,
  abortReason?: string,
): S6LoopResult {
  const durationMs = Date.now() - startTime

  const telemetry: S6LoopTelemetry = {
    s6_loop_entered: true,
    s6_escalation_reason: escalationReason,
    s6_inspect_rounds: inspectRoundsUsed,
    s6_outcome: outcome,
    s6_duration_ms: durationMs,
    s6_tool_trace: toolTrace,
  }

  const result: S6LoopResult = {
    outcome,
    inspectRoundsUsed,
    durationMs,
    telemetry,
  }

  if (outcome === 'action_executed' && parsed) {
    const actionType = parsed.action as 'open_widget_item' | 'open_panel' | 'navigate_entry'
    const targetId = parsed.itemId || parsed.panelSlug || parsed.entryId || ''
    result.actionResult = { action: actionType, status: 'executed' }
    telemetry.s6_action_type = actionType
    telemetry.s6_action_target_id = targetId
    telemetry.s6_action_status = 'executed'
  }

  if (outcome === 'clarification_accepted' && parsed?.candidateIds) {
    result.clarificationResult = { type: 'clarification_result', status: 'accepted' }
    telemetry.s6_clarify_candidate_count = parsed.candidateIds.length
  }

  if (outcome === 'abort' || abortReason) {
    telemetry.s6_abort_reason = abortReason || parsed?.reason || 'unknown'
  }

  return result
}

/**
 * Build result for a validated action (Slice 6.4).
 * Uses the S6ActionResult from validators instead of assuming success.
 */
function buildLoopResultWithAction(
  outcome: S6LoopOutcome,
  inspectRoundsUsed: number,
  toolTrace: string[],
  startTime: number,
  escalationReason: S6EscalationReason,
  parsed: ParsedLLMResponse,
  actionResult: S6ActionResult,
): S6LoopResult {
  const durationMs = Date.now() - startTime

  const telemetry: S6LoopTelemetry = {
    s6_loop_entered: true,
    s6_escalation_reason: escalationReason,
    s6_inspect_rounds: inspectRoundsUsed,
    s6_outcome: outcome,
    s6_duration_ms: durationMs,
    s6_tool_trace: toolTrace,
    s6_action_type: actionResult.action,
    s6_action_target_id: parsed.itemId || parsed.panelSlug || parsed.entryId || '',
    s6_action_status: actionResult.status,
  }

  if (actionResult.rejectionReason) {
    telemetry.s6_action_rejection_reason = actionResult.rejectionReason
  }

  return {
    outcome,
    inspectRoundsUsed,
    durationMs,
    actionResult,
    telemetry,
  }
}

// ============================================================================
// Action Validation (Slice 6.4)
// ============================================================================

/**
 * Dispatch action validation to the appropriate validator.
 * Server-side entry validation is truly fresh (DB query).
 * Client-side panel/widget validation uses pre-computed snapshots.
 */
async function validateAction(
  parsed: ParsedLLMResponse,
  snapshots: ActionValidationSnapshots,
  userId: string,
): Promise<S6ActionResult> {
  switch (parsed.action) {
    case 'open_panel':
      return validateOpenPanel(parsed.panelSlug ?? '', snapshots)

    case 'open_widget_item':
      return validateOpenWidgetItem(
        parsed.widgetId ?? '', parsed.itemId ?? '', snapshots,
      )

    case 'navigate_entry':
      return validateNavigateEntry(
        parsed.entryId ?? '', userId, queryEntryExists,
      )

    default:
      return {
        action: (parsed.action ?? 'unknown') as S6ActionResult['action'],
        status: 'rejected',
        rejectionReason: 'target_not_found',
      }
  }
}

/**
 * DB query for navigate_entry validation.
 * Checks entry existence and user ownership via workspace membership.
 */
async function queryEntryExists(
  entryId: string,
  userId: string,
): Promise<{ exists: boolean; belongsToUser: boolean }> {
  const { rows } = await serverPool.query(
    `SELECT i.id,
            CASE WHEN nw.user_id = $2 THEN true ELSE false END AS belongs_to_user
     FROM items i
     LEFT JOIN note_workspaces nw ON nw.id = (
       SELECT nw2.id FROM note_workspaces nw2
       WHERE nw2.user_id = $2
       LIMIT 1
     )
     WHERE i.id = $1 AND i.deleted_at IS NULL
     LIMIT 1`,
    [entryId, userId],
  )

  if (rows.length === 0) {
    return { exists: false, belongsToUser: false }
  }

  return {
    exists: true,
    belongsToUser: rows[0].belongs_to_user === true,
  }
}

// ============================================================================
// Route Handler
// ============================================================================

export async function POST(request: NextRequest): Promise<NextResponse> {
  const startTime = Date.now()

  // Feature flag
  if (process.env.STAGE6_SHADOW_ENABLED !== 'true') {
    return NextResponse.json(
      buildLoopResult('abort', 0, [], startTime, 'stage4_abstain', null, 'disabled'),
    )
  }

  try {
    // Resolve user ID
    const userId = resolveNoteWorkspaceUserId(request)
    if (userId === 'invalid') {
      return NextResponse.json(
        buildLoopResult('abort', 0, [], startTime, 'stage4_abstain', null, 'invalid_user'),
      )
    }

    // Parse request
    const body = await request.json()
    const loopInput = body.loopInput as S6LoopInput
    const clientSnapshots = body.clientSnapshots as ClientSnapshots

    if (!loopInput?.userInput) {
      return NextResponse.json(
        buildLoopResult('abort', 0, [], startTime, 'stage4_abstain', null, 'invalid_input'),
      )
    }

    // Get Gemini API key
    const apiKey = getGeminiApiKey()
    if (!apiKey) {
      return NextResponse.json(
        buildLoopResult('abort', 0, [], startTime, loopInput.escalationReason, null, 'api_key_missing'),
      )
    }

    // Initialize Gemini
    const genAI = new GoogleGenerativeAI(apiKey)
    const model = genAI.getGenerativeModel({
      model: process.env.STAGE6_LLM_MODEL || 'gemini-2.0-flash',
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 500,
        responseMimeType: 'application/json',
        responseSchema: S6_RESPONSE_SCHEMA,
      },
    })

    // Start multi-turn chat
    const chat = model.startChat()
    const systemPrompt = buildSystemPrompt(loopInput.constraints.maxInspectRounds)
    const userMessage = buildUserMessage(loopInput)

    let inspectRoundsUsed = 0
    let structRetried = false
    const toolTrace: string[] = []

    // First turn: system + context
    let response = await chat.sendMessage(systemPrompt + '\n\n' + userMessage)

    // Multi-round loop
    for (let turn = 0; turn < loopInput.constraints.maxInspectRounds + 2; turn++) {
      // Timeout check
      if (Date.now() - startTime > loopInput.constraints.timeoutMs) {
        return NextResponse.json(
          buildLoopResult('timeout', inspectRoundsUsed, toolTrace, startTime, loopInput.escalationReason),
        )
      }

      const text = response.response.text().trim()
      const parsed = safeParseJson(text)

      if (!parsed || !parsed.type) {
        return NextResponse.json(
          buildLoopResult('abort', inspectRoundsUsed, toolTrace, startTime, loopInput.escalationReason, null, `Unparseable: ${text.slice(0, 100)}`),
        )
      }

      // Structural validation: check required fields per type.
      // On first failure, feed error back to model for one retry.
      // On second failure, abort immediately.
      const structError = validateResponseStructure(parsed)
      if (structError) {
        toolTrace.push(`invalid_${parsed.type}`)
        if (!structRetried) {
          structRetried = true
          response = await chat.sendMessage(
            `Invalid response: ${structError}\nPlease fix and respond with valid JSON.`,
          )
          continue
        }
        return NextResponse.json(
          buildLoopResult('abort', inspectRoundsUsed, toolTrace, startTime, loopInput.escalationReason, null, `Structural: ${structError}`),
        )
      }

      // Track tool usage
      toolTrace.push(parsed.type === 'inspect' ? (parsed.tool ?? 'inspect_unknown') : parsed.type)

      // ── Terminal: action ──
      if (parsed.type === 'action' && parsed.action) {
        const validationSnapshots: ActionValidationSnapshots = {
          dashboard: clientSnapshots.dashboard,
          visibleItems: clientSnapshots.visibleItems,
        }
        const actionResult = await validateAction(
          parsed, validationSnapshots, userId,
        )
        const outcome: S6LoopOutcome = actionResult.status === 'executed'
          ? 'action_executed'
          : 'action_rejected'
        return NextResponse.json(
          buildLoopResultWithAction(outcome, inspectRoundsUsed, toolTrace, startTime, loopInput.escalationReason, parsed, actionResult),
        )
      }

      // ── Terminal: clarify ──
      if (parsed.type === 'clarify') {
        return NextResponse.json(
          buildLoopResult('clarification_accepted', inspectRoundsUsed, toolTrace, startTime, loopInput.escalationReason, parsed),
        )
      }

      // ── Terminal: abort ──
      if (parsed.type === 'abort') {
        return NextResponse.json(
          buildLoopResult('abort', inspectRoundsUsed, toolTrace, startTime, loopInput.escalationReason, parsed),
        )
      }

      // ── Inspect tool ──
      if (parsed.type === 'inspect' && parsed.tool) {
        if (inspectRoundsUsed >= loopInput.constraints.maxInspectRounds) {
          return NextResponse.json(
            buildLoopResult('max_rounds_exhausted', inspectRoundsUsed, toolTrace, startTime, loopInput.escalationReason),
          )
        }

        inspectRoundsUsed++
        const inspectResult = await handleServerInspect(
          parsed.tool, parsed, clientSnapshots, userId,
        )

        // Feed result back to model
        response = await chat.sendMessage(
          `Result of ${parsed.tool}:\n${JSON.stringify(inspectResult, null, 2)}\n\nWhat do you do next? JSON only.`,
        )
        continue
      }

      // Unknown type
      return NextResponse.json(
        buildLoopResult('abort', inspectRoundsUsed, toolTrace, startTime, loopInput.escalationReason, null, `Unknown type: ${parsed.type}`),
      )
    }

    // Fell through loop without terminal decision
    return NextResponse.json(
      buildLoopResult('max_rounds_exhausted', inspectRoundsUsed, toolTrace, startTime, loopInput.escalationReason),
    )
  } catch (err) {
    console.warn('[stage6-loop] Loop error (non-fatal):', (err as Error).message)
    return NextResponse.json(
      buildLoopResult('abort', 0, [], startTime, 'stage4_abstain', null, (err as Error).message),
    )
  }
}
