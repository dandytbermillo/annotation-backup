const { Client } = require('pg')

const client = new Client({
  connectionString: 'postgres://postgres:postgres@localhost:5432/annotation_system'
})

async function debugUpdateSizes() {
  await client.connect()
  
  try {
    // Get update sizes for recent documents
    const result = await client.query(
      `SELECT doc_name, 
              COUNT(*) as update_count, 
              ARRAY_AGG(length(update) ORDER BY timestamp) as sizes,
              SUM(length(update)) as total_size
       FROM yjs_updates 
       WHERE doc_name LIKE 'note-%panel-%'
       GROUP BY doc_name
       ORDER BY MAX(timestamp) DESC
       LIMIT 10`
    )
    
    console.log('\n=== Update Sizes Analysis ===')
    for (const row of result.rows) {
      console.log(`\n${row.doc_name}:`)
      console.log(`  Updates: ${row.update_count}`)
      console.log(`  Sizes: ${row.sizes.join(', ')} bytes`)
      console.log(`  Total: ${row.total_size} bytes`)
      
      // Check for pattern of small updates
      const smallUpdates = row.sizes.filter(size => size < 30).length
      if (smallUpdates > 0) {
        console.log(`  WARNING: ${smallUpdates} updates are < 30 bytes (possibly empty)`)
      }
    }
    
    // Check a specific document's updates in detail
    console.log('\n=== Detailed Update Check ===')
    const detailDoc = 'note-1756304637160-panel-main'
    const updates = await client.query(
      'SELECT update, timestamp FROM yjs_updates WHERE doc_name = $1 ORDER BY timestamp',
      [detailDoc]
    )
    
    console.log(`\nDocument: ${detailDoc}`)
    updates.rows.forEach((row, idx) => {
      const update = row.update
      console.log(`Update ${idx + 1}: ${update.length} bytes at ${new Date(row.timestamp).toISOString()}`)
      
      // Check first few bytes to see if it's a valid Y.js update
      if (update.length > 0) {
        const bytes = Array.from(update.slice(0, 10)).map(b => b.toString(16).padStart(2, '0')).join(' ')
        console.log(`  First bytes: ${bytes}`)
      }
    })
    
  } finally {
    await client.end()
  }
}

debugUpdateSizes().catch(console.error)