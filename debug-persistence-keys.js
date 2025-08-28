const { Client } = require('pg')
const Y = require('yjs')

const client = new Client({
  connectionString: 'postgres://postgres:postgres@localhost:5432/annotation_system'
})

async function debugPersistenceKeys() {
  await client.connect()
  
  try {
    // Get all unique doc names
    const result = await client.query(
      `SELECT DISTINCT doc_name, COUNT(*) as update_count, 
       MIN(timestamp) as first_update, MAX(timestamp) as last_update
       FROM yjs_updates 
       GROUP BY doc_name
       ORDER BY last_update DESC
       LIMIT 20`
    )
    
    console.log('\n=== All Document Keys ===')
    for (const row of result.rows) {
      console.log(`${row.doc_name}`)
      console.log(`  Updates: ${row.update_count}, First: ${row.first_update}, Last: ${row.last_update}`)
    }
    
    // Check specific patterns
    console.log('\n=== Note Panel Documents ===')
    const notePanels = await client.query(
      `SELECT doc_name, COUNT(*) as count FROM yjs_updates 
       WHERE doc_name LIKE 'note-%panel-%'
       GROUP BY doc_name
       ORDER BY doc_name DESC`
    )
    
    for (const row of notePanels.rows) {
      console.log(`${row.doc_name}: ${row.count} updates`)
      
      // Load and check content
      const updates = await client.query(
        'SELECT update FROM yjs_updates WHERE doc_name = $1 ORDER BY timestamp',
        [row.doc_name]
      )
      
      if (updates.rows.length > 0) {
        const doc = new Y.Doc()
        updates.rows.forEach(updateRow => {
          const update = new Uint8Array(updateRow.update)
          Y.applyUpdate(doc, update)
        })
        
        // Check all fragments
        console.log('  Fragments:')
        doc.share.forEach((value, key) => {
          if (key === 'prosemirror' || key === 'default') {
            console.log(`    ${key}: ${value.constructor.name}`)
            // Try to get text content from XMLFragment
            if (value._first) {
              let text = '';
              let node = value._first;
              while (node) {
                if (node.content && node.content.str) {
                  text += node.content.str;
                }
                node = node.right;
              }
              if (text) {
                console.log(`      Text content: "${text.substring(0, 100)}${text.length > 100 ? '...' : ''}" (${text.length} chars)`)
              }
            }
            // Also check if it has toJSON
            try {
              const json = value.toJSON();
              console.log(`      JSON: ${JSON.stringify(json).substring(0, 100)}`)
            } catch (e) {
              // ignore
            }
          } else {
            console.log(`    ${key}: ${value.constructor.name}`)
          }
        })
      }
    }
    
  } finally {
    await client.end()
  }
}

debugPersistenceKeys().catch(console.error)