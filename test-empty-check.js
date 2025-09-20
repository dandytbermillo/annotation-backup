// Test what providerContentIsEmpty returns for empty paragraph

function extractPreviewFromContent(content) {
  if (!content || typeof content !== 'object') return ''
  
  const extractText = (node) => {
    if (!node) return ''
    if (node.type === 'text') return node.text || ''
    if (Array.isArray(node.content)) {
      return node.content.map(extractText).join(' ')
    }
    return ''
  }
  
  return extractText(content).trim()
}

function providerContentIsEmpty(provider, value) {
  if (!value) return true
  
  // Skip provider check for this test
  
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed.length === 0 || trimmed === '<p></p>'
  }
  
  if (typeof value === 'object') {
    try {
      const preview = extractPreviewFromContent(value)
      if (preview.trim().length === 0) {
        const content = value.content
        if (!Array.isArray(content) || content.length === 0) return true
        return content.every((node) => providerContentIsEmpty(provider, node))
      }
      return false
    } catch {
      return true
    }
  }
  
  return true
}

// Test the actual empty paragraph document from the database
const emptyParagraphDoc = {
  "type": "doc",
  "content": [
    {
      "type": "paragraph"
    }
  ]
}

const result = providerContentIsEmpty(undefined, emptyParagraphDoc)
console.log('Empty paragraph doc is considered empty?', result)

// Also test what extractPreviewFromContent returns
const preview = extractPreviewFromContent(emptyParagraphDoc)
console.log('Preview from empty paragraph:', JSON.stringify(preview))
console.log('Preview length:', preview.length)

// Test the recursive check
console.log('\nStep by step:')
console.log('1. Extract preview:', JSON.stringify(extractPreviewFromContent(emptyParagraphDoc)))
console.log('2. Preview trimmed length:', extractPreviewFromContent(emptyParagraphDoc).trim().length)
console.log('3. Content array:', emptyParagraphDoc.content)
console.log('4. Content length:', emptyParagraphDoc.content.length)

// Check each node
emptyParagraphDoc.content.forEach((node, i) => {
  console.log(`5. Node ${i} is empty?`, providerContentIsEmpty(undefined, node))
})