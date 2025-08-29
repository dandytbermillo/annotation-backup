// Debug script to test document loading in plain mode
async function debugDocumentLoad() {
  const baseUrl = 'http://localhost:3000/api/postgres-offline'
  
  console.log('🔍 Debugging Document Load/Save\n')
  
  try {
    // Test saving a document
    const testNoteId = '123e4567-e89b-12d3-a456-426614174000' // Example UUID
    const testPanelId = 'main'
    const testContent = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'This is a test document saved at ' + new Date().toISOString()
            }
          ]
        }
      ]
    }
    
    console.log('1. Saving test document...')
    const saveResponse = await fetch(`${baseUrl}/documents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        noteId: testNoteId,
        panelId: testPanelId,
        content: testContent,
        version: 1
      })
    })
    
    if (!saveResponse.ok) {
      throw new Error(`Save failed: ${await saveResponse.text()}`)
    }
    console.log('  ✓ Save successful\n')
    
    // Test loading the document
    console.log('2. Loading document back...')
    const loadResponse = await fetch(`${baseUrl}/documents/${testNoteId}/${testPanelId}`)
    
    if (!loadResponse.ok) {
      throw new Error(`Load failed: ${await loadResponse.text()}`)
    }
    
    const loadData = await loadResponse.json()
    console.log('  ✓ Load successful')
    console.log('  Content:', JSON.stringify(loadData.content, null, 2))
    console.log('  Version:', loadData.version)
    
    // Test with normalized panel ID
    console.log('\n3. Testing with normalized panel ID...')
    const normalizedResponse = await fetch(`${baseUrl}/documents/${testNoteId}/main`)
    
    if (normalizedResponse.ok) {
      const normalizedData = await normalizedResponse.json()
      console.log('  ✓ Normalized load successful')
      console.log('  Content matches:', JSON.stringify(normalizedData.content) === JSON.stringify(loadData.content))
    }
    
    console.log('\n✅ Document load/save working correctly!')
    
  } catch (error) {
    console.error('❌ Debug failed:', error)
  }
}

// Run in browser console
if (typeof window !== 'undefined') {
  window.debugDocumentLoad = debugDocumentLoad
  console.log('Run debugDocumentLoad() to test document loading')
} else {
  console.log('Run this in the browser console at http://localhost:3000')
}

export { debugDocumentLoad }