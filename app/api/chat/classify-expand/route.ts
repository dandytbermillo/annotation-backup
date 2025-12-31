import { NextRequest, NextResponse } from 'next/server'
import OpenAI from 'openai'
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'

/**
 * Tiny LLM Classifier for "Show All" Preview Expansion
 *
 * Asks a simple YES/NO question: Does the user want to expand the preview list?
 * Used as fallback when keyword heuristic doesn't match.
 */

// =============================================================================
// OpenAI Client (same as navigate route)
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

The user just saw a preview list in a chat interface. You must determine if the user is asking to expand/show the full list from that preview.

Say YES if the user is asking to:
- Show all items
- Open the full list
- See everything
- View all results
- Expand the preview

Say NO if the user is asking for any other action, such as:
- Open a specific workspace or note
- Navigate somewhere
- Create, rename, or delete something
- Ask a question
- Anything unrelated to expanding the preview`

export async function POST(request: NextRequest) {
  try {
    const { userMessage, previewSource, previewCount } = await request.json()

    if (!userMessage) {
      return NextResponse.json({ expand: false }, { status: 200 })
    }

    const openai = getOpenAIClient()

    const contextInfo = previewSource
      ? `The preview shows "${previewSource}" with ${previewCount || 'several'} items.`
      : ''

    const response = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      temperature: 0,
      max_tokens: 10,
      messages: [
        { role: 'system', content: CLASSIFIER_SYSTEM_PROMPT },
        { role: 'user', content: `${contextInfo}\n\nUser message: "${userMessage}"` },
      ],
    })

    const answer = response.choices[0]?.message?.content?.trim().toUpperCase() || ''
    const expand = answer === 'YES'

    return NextResponse.json({ expand })
  } catch (error) {
    console.error('[classify-expand] Error:', error)
    // Default to NO on error - let normal intent parsing handle it
    return NextResponse.json({ expand: false })
  }
}
