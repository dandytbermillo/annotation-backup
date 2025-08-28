const { Client } = require('pg')
const Y = require('yjs')

const client = new Client({
  connectionString: 'postgres://postgres:postgres@localhost:5432/annotation_system'
})

async function debugNoteContent() {
  await client.connect()
  
  try {
    // Get recent panel documents
    const result = await client.query(
      `SELECT DISTINCT doc_name FROM yjs_updates 
       WHERE doc_name LIKE 'note-%' AND doc_name LIKE '%-panel-%'
       ORDER BY doc_name DESC LIMIT 10`
    )
    
    console.log('\n=== Recent Panel Documents ===')
    console.log(result.rows.map(r => r.doc_name))
    
    // For each doc, load and decode content
    for (const row of result.rows) {
      const docName = row.doc_name
      console.log(`\n=== Checking ${docName} ===`)
      
      // Get all updates for this doc
      const updates = await client.query(
        'SELECT update FROM yjs_updates WHERE doc_name = $1 ORDER BY timestamp',
        [docName]
      )
      
      console.log(`Found ${updates.rows.length} updates`)
      
      if (updates.rows.length > 0) {
        // Apply updates to a new doc
        const doc = new Y.Doc()
        updates.rows.forEach((updateRow, idx) => {
          const update = new Uint8Array(updateRow.update)
          Y.applyUpdate(doc, update)
        })
        
        // Check prosemirror content
        const prosemirror = doc.getXmlFragment('prosemirror')
        const text = prosemirror.toString()
        console.log(`ProseMirror content: "${text}"`)
        console.log(`Content length: ${text.length}`)
        
        // Check all fragments and maps in the doc
        console.log('Document structure:')
        doc.share.forEach((value, key) => {
          console.log(`  ${key}: ${value.constructor.name}`)
          if (value.toJSON) {
            console.log(`    Content: ${JSON.stringify(value.toJSON())}`)
          }
        })
        
        // Check content fragment specifically
        const content = doc.getXmlFragment('content')
        if (content) {
          console.log(`Content fragment: "${content.toString()}"`)
        }
        
        // Get the actual text content if possible
        if (prosemirror.length > 0) {
          const firstChild = prosemirror.get(0)
          if (firstChild) {
            console.log(`First child type: ${firstChild.constructor.name}`)
          }
        }
      }
    }
    
  } finally {
    await client.end()
  }
}

debugNoteContent().catch(console.error)