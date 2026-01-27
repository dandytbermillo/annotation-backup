/**
 * Quick test script for Gemini Flash API
 */

import { GoogleGenerativeAI } from '@google/generative-ai'
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'

async function test() {
  // Check for API key
  let apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY

  if (!apiKey) {
    // Try secrets file
    try {
      const secretsPath = join(process.cwd(), 'config', 'secrets.json')
      if (existsSync(secretsPath)) {
        const secrets = JSON.parse(readFileSync(secretsPath, 'utf-8'))
        apiKey = secrets.GEMINI_API_KEY || secrets.GOOGLE_API_KEY
        if (apiKey) console.log('✓ Found API key in secrets.json')
      }
    } catch (e) {
      // ignore
    }
  }

  if (!apiKey) {
    console.log('✗ ERROR: No Gemini API key found')
    console.log('  Checked: GEMINI_API_KEY, GOOGLE_API_KEY, config/secrets.json')
    console.log('')
    console.log('  To fix, add to .env.local:')
    console.log('    GEMINI_API_KEY=your-api-key')
    console.log('')
    console.log('  Get a free key at: https://aistudio.google.com/app/apikey')
    return
  }

  console.log('Testing Gemini Flash (gemini-2.0-flash)...')
  const genAI = new GoogleGenerativeAI(apiKey)
  const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' })

  const prompt = `Options:
0: Links Panel D
1: Links Panel E
2: Links Panels

User said: "the second one"

Which option does the user want? Return JSON only: {"choiceIndex": N, "confidence": 0.0-1.0, "decision": "select"}`

  try {
    const start = Date.now()
    const result = await model.generateContent(prompt)
    const text = result.response.text()
    console.log('✓ SUCCESS! Latency:', Date.now() - start, 'ms')
    console.log('Response:', text)
  } catch (err) {
    console.log('✗ FAILED:', err.message)
  }
}

test()
