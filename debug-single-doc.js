const { Client } = require('pg')
const Y = require('yjs')

const client = new Client({
  connectionString: 'postgres://postgres:postgres@localhost:5432/annotation_system'
})

async function debugSingleDoc() {
  await client.connect()
  
  try {
    const docName = 'note-1756304637160-panel-main' // A doc with 7 updates
    
    const updates = await client.query(
      'SELECT update, timestamp FROM yjs_updates WHERE doc_name = $1 ORDER BY timestamp',
      [docName]
    )
    
    console.log(`\n=== Debugging ${docName} ===`)
    console.log(`Found ${updates.rows.length} updates`)
    
    const doc = new Y.Doc()
    
    // Apply each update and check state
    updates.rows.forEach((row, idx) => {
      console.log(`\nUpdate ${idx + 1} at ${row.timestamp}:`)
      const update = new Uint8Array(row.update)
      console.log(`  Size: ${update.length} bytes`)
      
      Y.applyUpdate(doc, update)
      
      // Check what's in the doc after this update
      console.log('  Document state:')
      doc.share.forEach((value, key) => {
        console.log(`    ${key}: ${value.constructor.name}`)
        
        // Check if it's an XmlFragment
        if (value.constructor.name === 'YXmlFragment' || value._start) {
          let textContent = ''
          try {
            // Try to iterate through XML nodes
            const walker = value.createTreeWalker(
              (item) => true // Accept all nodes
            )
            
            let node
            while ((node = walker.next())) {
              if (node && node.content && node.content.str) {
                textContent += node.content.str
              }
            }
          } catch (e) {
            // Try alternative method
            if (value.toDOM) {
              try {
                const dom = value.toDOM()
                textContent = dom.textContent || ''
              } catch (e2) {
                // ignore
              }
            }
          }
          
          if (textContent) {
            console.log(`      Text: "${textContent.substring(0, 50)}${textContent.length > 50 ? '...' : ''}" (${textContent.length} chars)`)
          }
          
          // Also try to get the Prosemirror-specific content
          if (value.toJSON) {
            try {
              const json = value.toJSON()
              console.log(`      JSON structure: ${JSON.stringify(json).substring(0, 100)}`)
            } catch (e) {
              // ignore
            }
          }
        }
      })
    })
    
    // Final check - try to get prosemirror fragment explicitly
    console.log('\n=== Final state ===')
    const defaultFragment = doc.getXmlFragment('default')
    const prosemirrorFragment = doc.getXmlFragment('prosemirror')
    
    console.log(`Default fragment exists: ${!!defaultFragment}`)
    console.log(`Prosemirror fragment exists: ${!!prosemirrorFragment}`)
    
    if (defaultFragment) {
      console.log(`Default fragment type: ${defaultFragment.constructor.name}`)
      console.log(`Default fragment length: ${defaultFragment.length}`)
      console.log(`Default fragment toString: ${defaultFragment.toString()}`)
    }
    
    if (prosemirrorFragment) {
      console.log(`Prosemirror fragment type: ${prosemirrorFragment.constructor.name}`)
      console.log(`Prosemirror fragment length: ${prosemirrorFragment.length}`)
      console.log(`Prosemirror fragment toString: ${prosemirrorFragment.toString()}`)
    }
    
  } finally {
    await client.end()
  }
}

debugSingleDoc().catch(console.error)