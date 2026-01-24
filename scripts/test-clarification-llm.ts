#!/usr/bin/env npx ts-node
/**
 * Manual test script for clarification LLM fallback
 *
 * Usage:
 *   CLARIFICATION_LLM_FALLBACK=true OPENAI_API_KEY=sk-xxx npx ts-node scripts/test-clarification-llm.ts
 *
 * Or if you have .env.local configured:
 *   npx ts-node -r dotenv/config scripts/test-clarification-llm.ts dotenv_config_path=.env.local
 */

import {
  callClarificationLLM,
  shouldCallLLMFallback,
  hasClearNaturalChoiceCue,
  isLLMFallbackEnabled,
} from '../lib/chat/clarification-llm-fallback'

async function main() {
  console.log('='.repeat(60))
  console.log('Clarification LLM Fallback - Manual Test')
  console.log('='.repeat(60))
  console.log()

  // Check feature flag
  console.log('1. Feature Flag Check')
  console.log(`   CLARIFICATION_LLM_FALLBACK=${process.env.CLARIFICATION_LLM_FALLBACK}`)
  console.log(`   isLLMFallbackEnabled(): ${isLLMFallbackEnabled()}`)
  console.log()

  if (!isLLMFallbackEnabled()) {
    console.log('⚠️  Feature flag is OFF. Set CLARIFICATION_LLM_FALLBACK=true to test.')
    console.log()
  }

  // Test clear natural choice detection
  console.log('2. Clear Natural Choice Cue Detection')
  const cueTests = [
    'the one about settings',
    'go with the first',
    'pick the workspace option',
    'links panel',
    'second',
    'asdfgh',
  ]
  for (const input of cueTests) {
    const hasCue = hasClearNaturalChoiceCue(input)
    console.log(`   "${input}" → ${hasCue ? '✓ HAS CUE' : '✗ no cue'}`)
  }
  console.log()

  // Test trigger conditions
  console.log('3. Trigger Condition Tests')
  const triggerTests = [
    { attemptCount: 0, input: 'anything' },
    { attemptCount: 1, input: 'random' },
    { attemptCount: 1, input: 'the one about settings' },
    { attemptCount: 2, input: 'gibberish' },
  ]
  for (const { attemptCount, input } of triggerTests) {
    const shouldCall = shouldCallLLMFallback(attemptCount, input)
    console.log(`   attemptCount=${attemptCount}, input="${input}" → ${shouldCall ? '✓ CALL LLM' : '✗ skip'}`)
  }
  console.log()

  // Test actual LLM call (if enabled)
  if (isLLMFallbackEnabled() && process.env.OPENAI_API_KEY) {
    console.log('4. Live LLM Call Tests')
    console.log()

    const options = [
      { label: 'Links Panel D', sublabel: '3 links' },
      { label: 'Links Panel E', sublabel: '5 links' },
      { label: 'Settings Panel', sublabel: 'app configuration' },
    ]

    const testCases = [
      'the one about settings',
      'go with the links one that has more',
      'the panel with 3 links',
      'something completely unrelated like weather',
    ]

    for (const userInput of testCases) {
      console.log(`   Testing: "${userInput}"`)
      const result = await callClarificationLLM({ userInput, options })

      if (result.success && result.response) {
        const { decision, choiceIndex, confidence, reason } = result.response
        console.log(`   → decision: ${decision}`)
        console.log(`   → choiceIndex: ${choiceIndex}${choiceIndex >= 0 ? ` (${options[choiceIndex]?.label})` : ''}`)
        console.log(`   → confidence: ${confidence}`)
        console.log(`   → reason: ${reason}`)
        console.log(`   → latency: ${result.latencyMs}ms`)
      } else {
        console.log(`   → ERROR: ${result.error} (${result.latencyMs}ms)`)
      }
      console.log()
    }
  } else {
    console.log('4. Live LLM Call Tests')
    console.log('   ⚠️  Skipped - requires CLARIFICATION_LLM_FALLBACK=true and OPENAI_API_KEY')
    console.log()
  }

  console.log('='.repeat(60))
  console.log('Test complete')
}

main().catch(console.error)
