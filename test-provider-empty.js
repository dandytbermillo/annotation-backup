// Test what the provider's isEmptyContent method returns

function providerIsEmptyContent(content) {
  if (!content) return true
  if (typeof content === 'string') {
    return content === '<p></p>' || content.trim() === ''
  }
  if (content.type === 'doc' && (!content.content || content.content.length === 0)) {
    return true
  }
  return false
}

// Test cases
const testCases = [
  {
    name: "Empty paragraph doc (from DB)",
    doc: { "type": "doc", "content": [{ "type": "paragraph" }] }
  },
  {
    name: "Empty doc (no content)",
    doc: { "type": "doc", "content": [] }
  },
  {
    name: "Doc with text",
    doc: { "type": "doc", "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": "Hello" }] }] }
  }
]

console.log("Provider's isEmptyContent results:")
console.log("================================")
testCases.forEach(test => {
  const result = providerIsEmptyContent(test.doc)
  console.log(`${test.name}: ${result ? 'EMPTY' : 'NOT EMPTY'}`)
  console.log(`  Content array length: ${test.doc.content ? test.doc.content.length : 0}`)
})

// The critical test
const emptyParagraph = { "type": "doc", "content": [{ "type": "paragraph" }] }
console.log('\nCritical finding:')
console.log('Empty paragraph has content.length =', emptyParagraph.content.length)
console.log('Provider considers it:', providerIsEmptyContent(emptyParagraph) ? 'EMPTY' : 'NOT EMPTY')