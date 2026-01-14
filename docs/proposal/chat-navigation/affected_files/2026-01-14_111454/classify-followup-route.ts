import { NextRequest, NextResponse } from 'next/server'
import OpenAI from 'openai'
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'

/**
 * Tiny LLM Classifier for Follow-up Intent Detection
 *
 * Asks a simple YES/NO question: Is the user asking for more info about the current topic?
 * Used as fallback when deterministic follow-up detection doesn't match.
 *
 * Per general-doc-retrieval-routing-plan.md (v5):
 * - If follow-up detection misses but lastDocSlug is set, call classifier as backup
 * - Pass lastDocSlug and lastTopicTokens so it can route to the same doc
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

const CLASSIFIER_SYSTEM_PROMPT = `Answer ONLY "YES" or "NO".

The user was just shown documentation about a specific topic. You must determine if the user is asking for MORE information about that SAME topic.

Say YES if the user is asking to:
- Continue the explanation
- Get more details
- Expand on the topic
- Tell them more
- Elaborate further
- Explain more about it
- Go deeper into the topic

Say NO if the user is:
- Asking about a DIFFERENT topic
- Asking a new unrelated question
- Giving a command or action request
- Saying something conversational (thanks, ok, etc.)
- Asking to navigate somewhere`

export async function POST(request: NextRequest) {
  const startTime = Date.now()

  try {
    const { userMessage, lastDocSlug, lastTopicTokens } = await request.json()

    if (!userMessage || !lastDocSlug) {
      return NextResponse.json({ isFollowUp: false, latencyMs: Date.now() - startTime })
    }

    const openai = getOpenAIClient()

    // Build context about what the user was viewing
    const topicContext = lastTopicTokens?.length
      ? `Topic tokens: ${lastTopicTokens.join(', ')}`
      : ''
    const docContext = `The user was viewing documentation: "${lastDocSlug}"`

    const response = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      temperature: 0,
      max_tokens: 10,
      messages: [
        { role: 'system', content: CLASSIFIER_SYSTEM_PROMPT },
        { role: 'user', content: `${docContext}\n${topicContext}\n\nUser message: "${userMessage}"` },
      ],
    })

    const answer = response.choices[0]?.message?.content?.trim().toUpperCase() || ''
    const isFollowUp = answer === 'YES'
    const latencyMs = Date.now() - startTime

    console.log(`[classify-followup] "${userMessage}" → ${isFollowUp ? 'YES' : 'NO'} (${latencyMs}ms)`)

    return NextResponse.json({ isFollowUp, latencyMs })
  } catch (error) {
    console.error('[classify-followup] Error:', error)
    // Default to NO on error - let normal routing handle it
    return NextResponse.json({ isFollowUp: false, latencyMs: Date.now() - startTime, error: true })
  }
}
