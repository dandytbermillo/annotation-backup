import { NextRequest, NextResponse } from 'next/server'
import { serverPool } from '@/lib/db/pool'
import { getChatUserId } from '@/app/api/chat/user-id'
import OpenAI from 'openai'
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'

// Configuration
const SUMMARY_THRESHOLD = 10 // Trigger summary when this many messages since last summary
const RECENT_WINDOW = 6 // Keep this many recent messages out of summary
const MAX_SUMMARY_LENGTH = 500
const MAX_CHUNK_SIZE = 40 // Max messages per summarization chunk (token budget)
const MAX_CONTENT_LENGTH = 200 // Max chars per message content in prompt
const OPENAI_TIMEOUT_MS = 10000

/**
 * Get OpenAI API key from environment or config file
 */
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

/**
 * Check if an OpenAI error is retryable (429, timeout, transient server errors).
 * Non-retryable errors (bad config, auth, invalid model) should surface as 500.
 */
function isRetryableOpenAIError(err: unknown): boolean {
  const msg = (err as Error).message || ''
  const name = (err as Error).name || ''
  // 429 rate limit
  if (msg.includes('429') || msg.includes('rate_limit')) return true
  // Timeout / connection errors
  if (name === 'AbortError' || msg.includes('timeout') || msg.includes('ECONNRESET')) return true
  // OpenAI 5xx server errors
  if (msg.includes('500') || msg.includes('502') || msg.includes('503') || msg.includes('529')) return true
  return false
}

/**
 * POST /api/chat/conversations/[conversationId]/summary
 * Trigger async summarization of older messages.
 *
 * Uses incremental bounded summarization:
 * - Summarizes one chunk at a time (MAX_CHUNK_SIZE messages)
 * - Only advances summary_until_message_id to the last message actually included
 * - Preserves prior summary as context for continuity
 * - Never marks messages as summarized that the model didn't see
 *
 * Body (optional):
 *   - force: boolean (skip threshold check)
 *
 * Returns:
 *   - updated: boolean
 *   - summary: string | null
 *   - messagesSummarized: number
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ conversationId: string }> }
) {
  try {
    // v1: Single-user, always use server-side constant
    const userId = getChatUserId()

    const { conversationId } = await params
    const body = await request.json().catch(() => ({}))
    const force = body.force === true

    // Verify conversation exists and belongs to user
    const convResult = await serverPool.query(
      `SELECT id, summary, summary_until_message_id FROM chat_conversations WHERE id = $1 AND user_id = $2`,
      [conversationId, userId]
    )

    if (convResult.rows.length === 0) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
    }

    const conversation = convResult.rows[0]
    const currentSummaryUntilId = conversation.summary_until_message_id

    // Count messages since last summary
    let countQuery: string
    let countParams: string[]

    if (currentSummaryUntilId) {
      // Get the created_at of the last summarized message
      const lastSummarizedResult = await serverPool.query(
        `SELECT created_at FROM chat_messages WHERE id = $1`,
        [currentSummaryUntilId]
      )

      if (lastSummarizedResult.rows.length > 0) {
        const lastSummarizedAt = lastSummarizedResult.rows[0].created_at
        countQuery = `
          SELECT COUNT(*) as count FROM chat_messages
          WHERE conversation_id = $1 AND created_at > $2
        `
        countParams = [conversationId, lastSummarizedAt]
      } else {
        // Summary reference is stale, count all
        countQuery = `SELECT COUNT(*) as count FROM chat_messages WHERE conversation_id = $1`
        countParams = [conversationId]
      }
    } else {
      // No summary yet, count all
      countQuery = `SELECT COUNT(*) as count FROM chat_messages WHERE conversation_id = $1`
      countParams = [conversationId]
    }

    const countResult = await serverPool.query(countQuery, countParams)
    const messagesSinceSummary = parseInt(countResult.rows[0].count, 10)

    // Check if we need to summarize
    if (!force && messagesSinceSummary < SUMMARY_THRESHOLD) {
      return NextResponse.json({
        updated: false,
        summary: conversation.summary,
        messagesSummarized: 0,
        reason: `Only ${messagesSinceSummary} messages since last summary (threshold: ${SUMMARY_THRESHOLD})`,
      })
    }

    // Get all messages to summarize (excluding recent window)
    const messagesResult = await serverPool.query(
      `
      SELECT id, role, content, created_at
      FROM chat_messages
      WHERE conversation_id = $1
      ORDER BY created_at ASC
      `,
      [conversationId]
    )

    const allMessages = messagesResult.rows

    if (allMessages.length <= RECENT_WINDOW) {
      return NextResponse.json({
        updated: false,
        summary: conversation.summary,
        messagesSummarized: 0,
        reason: `Not enough messages to summarize (${allMessages.length} <= ${RECENT_WINDOW})`,
      })
    }

    // Messages eligible for summarization (excluding recent window)
    const messagesToSummarize = allMessages.slice(0, -RECENT_WINDOW)

    // Check OpenAI availability
    const apiKey = getOpenAIApiKey()
    if (!apiKey) {
      return NextResponse.json({
        updated: false,
        summary: conversation.summary,
        messagesSummarized: 0,
        reason: 'OpenAI API key not configured',
      })
    }

    // Incremental bounded summarization:
    // Only summarize one chunk at a time. The chunk starts from where we left off.
    // If there's no prior summary, start from the oldest messages.
    // If there IS a prior summary, start from the first unsummarized message.
    let chunkStart = 0
    if (currentSummaryUntilId) {
      const lastSummarizedIndex = messagesToSummarize.findIndex(m => m.id === currentSummaryUntilId)
      if (lastSummarizedIndex >= 0) {
        chunkStart = lastSummarizedIndex + 1
      }
    }

    // Take the next bounded chunk
    const chunk = messagesToSummarize.slice(chunkStart, chunkStart + MAX_CHUNK_SIZE)

    if (chunk.length === 0) {
      return NextResponse.json({
        updated: false,
        summary: conversation.summary,
        messagesSummarized: 0,
        reason: 'No new messages to summarize in this chunk',
      })
    }

    // The last message actually included in the prompt — this is where we advance to
    const lastMessageInChunk = chunk[chunk.length - 1]

    // Build prompt
    const conversationText = chunk
      .map((m) => `${m.role}: ${(m.content as string).slice(0, MAX_CONTENT_LENGTH)}`)
      .join('\n')

    const existingSummary = conversation.summary
      ? `Previous summary: ${conversation.summary}\n\nNew messages to incorporate:\n`
      : ''

    const prompt = `${existingSummary}${conversationText}

Summarize this chat navigation conversation in 2-3 sentences. Focus on:
- What the user navigated to (workspaces, notes, dashboard)
- Any workspaces created, renamed, or deleted
- Key intents and outcomes

Keep the summary under ${MAX_SUMMARY_LENGTH} characters.`

    // Call OpenAI for summarization (with timeout to avoid blocking UI)
    const client = new OpenAI({ apiKey, timeout: OPENAI_TIMEOUT_MS })
    let completion
    try {
      completion = await client.chat.completions.create({
        model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
        temperature: 0.3,
        max_tokens: 150,
        messages: [
          {
            role: 'system',
            content: 'You are a helpful assistant that summarizes chat navigation conversations concisely.',
          },
          { role: 'user', content: prompt },
        ],
      })
    } catch (err) {
      if (isRetryableOpenAIError(err)) {
        const errMsg = (err as Error).message || 'Unknown error'
        console.warn(`[chat/summary] Retryable error: ${errMsg.slice(0, 100)}`)
        return NextResponse.json({
          updated: false,
          summary: conversation.summary,
          messagesSummarized: 0,
          reason: `Retryable error — will retry next turn: ${errMsg.slice(0, 80)}`,
        })
      }
      // Non-retryable errors (bad config, auth, invalid model) → surface as 500
      throw err
    }

    const newSummary = completion.choices[0]?.message?.content?.trim() || ''

    if (!newSummary) {
      return NextResponse.json({
        updated: false,
        summary: conversation.summary,
        messagesSummarized: 0,
        reason: 'Failed to generate summary',
      })
    }

    // Update conversation with new summary
    // Only advance summary_until_message_id to the last message actually in the prompt
    const updateResult = await serverPool.query(
      `
      UPDATE chat_conversations
      SET summary = $1, summary_until_message_id = $2, updated_at = now()
      WHERE id = $3
        AND (summary_until_message_id IS NULL OR summary_until_message_id = $4)
      RETURNING id
      `,
      [
        newSummary.slice(0, MAX_SUMMARY_LENGTH),
        lastMessageInChunk.id,
        conversationId,
        currentSummaryUntilId,
      ]
    )

    if (updateResult.rows.length === 0) {
      return NextResponse.json({
        updated: false,
        summary: conversation.summary,
        messagesSummarized: 0,
        reason: 'Concurrent update detected, summary not applied',
      })
    }

    return NextResponse.json({
      updated: true,
      summary: newSummary.slice(0, MAX_SUMMARY_LENGTH),
      messagesSummarized: chunk.length,
    })
  } catch (error) {
    console.error('[chat/summary] Error:', error)
    return NextResponse.json(
      { error: 'Failed to update summary' },
      { status: 500 }
    )
  }
}
