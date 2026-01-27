/**
 * Test the clarification LLM API endpoint
 */

async function test() {
  const testCases = [
    { input: 'hey nto that', expected: 'repair/reject' },
    { input: 'the second one', expected: 'select index 1' },
    { input: 'pls nto those', expected: 'reject list' },
  ]

  const options = [
    { id: 'd', label: 'Links Panel D' },
    { id: 'e', label: 'Links Panel E' },
    { id: 'f', label: 'Links Panels' },
  ]

  console.log('Testing /api/chat/clarification-llm endpoint...\n')

  for (const testCase of testCases) {
    console.log(`Input: "${testCase.input}"`)
    console.log(`Expected: ${testCase.expected}`)

    try {
      const response = await fetch('http://localhost:3000/api/chat/clarification-llm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userInput: testCase.input,
          options,
        }),
      })

      const result = await response.json()

      if (result.success) {
        console.log(`Result: decision=${result.response.decision}, choiceId=${result.response.choiceId}, confidence=${result.response.confidence}`)
        console.log(`Latency: ${result.latencyMs}ms`)
      } else {
        console.log(`ERROR: ${result.error}`)
      }
    } catch (err) {
      console.log(`FETCH ERROR: ${err.message}`)
      console.log('Is the dev server running? (npm run dev)')
    }

    console.log('')
  }
}

test()
