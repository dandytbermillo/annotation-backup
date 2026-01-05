#!/usr/bin/env node
/**
 * Test Script: Suggestion Rejection Handling
 *
 * Verifies the `isRejectionPhrase` detection logic matches the plan:
 * - Exact: "no", "nope", "not that", "cancel", "never mind"
 * - Or begins with "no,"
 *
 * Run: node docs/proposal/chat-navigation/plan/panels/chat/test-rejection-handling.mjs
 */

// Copy of the isRejectionPhrase function from chat-navigation-panel.tsx
function isRejectionPhrase(input) {
  const normalized = input.toLowerCase().trim()

  // Exact rejection phrases
  const rejectionPhrases = ['no', 'nope', 'not that', 'cancel', 'never mind', 'nevermind']
  if (rejectionPhrases.includes(normalized)) {
    return true
  }

  // Begins with "no,"
  if (normalized.startsWith('no,')) {
    return true
  }

  return false
}

// Test cases
const testCases = [
  // Exact rejection phrases - should return true
  { input: 'no', expected: true, description: 'Exact: "no"' },
  { input: 'No', expected: true, description: 'Case insensitive: "No"' },
  { input: 'NO', expected: true, description: 'Case insensitive: "NO"' },
  { input: 'nope', expected: true, description: 'Exact: "nope"' },
  { input: 'Nope', expected: true, description: 'Case insensitive: "Nope"' },
  { input: 'not that', expected: true, description: 'Exact: "not that"' },
  { input: 'Not That', expected: true, description: 'Case insensitive: "Not That"' },
  { input: 'cancel', expected: true, description: 'Exact: "cancel"' },
  { input: 'Cancel', expected: true, description: 'Case insensitive: "Cancel"' },
  { input: 'never mind', expected: true, description: 'Exact: "never mind"' },
  { input: 'Never Mind', expected: true, description: 'Case insensitive: "Never Mind"' },
  { input: 'nevermind', expected: true, description: 'Exact: "nevermind" (no space)' },

  // "no," prefix - should return true
  { input: 'no, I meant something else', expected: true, description: 'Prefix: "no, I meant..."' },
  { input: 'No, that\'s not it', expected: true, description: 'Prefix: "No, that\'s not it"' },
  { input: 'no,wrong', expected: true, description: 'Prefix: "no,wrong" (no space after comma)' },

  // Whitespace handling
  { input: '  no  ', expected: true, description: 'Trimmed: "  no  "' },
  { input: '\tnope\n', expected: true, description: 'Trimmed with tabs/newlines' },

  // Non-rejection phrases - should return false
  { input: 'yes', expected: false, description: 'Not rejection: "yes"' },
  { input: 'ok', expected: false, description: 'Not rejection: "ok"' },
  { input: 'open recent', expected: false, description: 'Not rejection: "open recent"' },
  { input: 'no way', expected: false, description: 'Not exact match: "no way"' },
  { input: 'nothing', expected: false, description: 'Not exact match: "nothing"' },
  { input: 'note', expected: false, description: 'Not exact match: "note"' },
  { input: 'not', expected: false, description: 'Not exact match: "not"' },
  { input: 'know', expected: false, description: 'Not rejection: "know"' },
  { input: 'I said no', expected: false, description: 'Not at start: "I said no"' },
  { input: 'show me the note', expected: false, description: 'Contains "no" but not rejection' },
  { input: 'announcement', expected: false, description: 'Contains "no" substring' },

  // Edge cases
  { input: '', expected: false, description: 'Empty string' },
  { input: '   ', expected: false, description: 'Whitespace only' },
  { input: 'no.', expected: false, description: 'With period: "no."' },
  { input: 'no!', expected: false, description: 'With exclamation: "no!"' },
  { input: 'no?', expected: false, description: 'With question mark: "no?"' },
]

// Run tests
console.log('=== Suggestion Rejection Handling Test ===\n')
console.log('Testing isRejectionPhrase() function\n')

let passed = 0
let failed = 0

for (const { input, expected, description } of testCases) {
  const result = isRejectionPhrase(input)
  const status = result === expected ? '✅ PASS' : '❌ FAIL'

  if (result === expected) {
    passed++
  } else {
    failed++
  }

  console.log(`${status} | "${input}" => ${result} (expected: ${expected})`)
  console.log(`       ${description}\n`)
}

console.log('='.repeat(50))
console.log(`\nResults: ${passed} passed, ${failed} failed out of ${testCases.length} tests`)

if (failed > 0) {
  console.log('\n❌ Some tests failed!')
  process.exit(1)
} else {
  console.log('\n✅ All tests passed!')
  process.exit(0)
}
