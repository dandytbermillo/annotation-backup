/**
 * Check if note content is saved to database
 * Usage: node check-note-content.js
 */

const { Pool } = require('pg')

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/annotation_dev'
})

async function checkNoteContent() {
  try {
    console.log('\n=== Checking Recent Notes ===\n')

    // Find notes created recently (last hour)
    const notesResult = await pool.query(`
      SELECT id, name, path, created_at, content
      FROM items
      WHERE type = 'note'
        AND name LIKE 'New Note - Oct 2%'
        AND deleted_at IS NULL
      ORDER BY created_at DESC
      LIMIT 5
    `)

    console.log(`Found ${notesResult.rows.length} matching notes:\n`)

    for (const note of notesResult.rows) {
      console.log(`📝 Note: ${note.name}`)
      console.log(`   ID: ${note.id}`)
      console.log(`   Path: ${note.path}`)
      console.log(`   Created: ${note.created_at}`)
      console.log(`   items.content: ${note.content ? JSON.stringify(note.content).substring(0, 100) + '...' : 'null'}`)

      // Check document_saves table
      const docResult = await pool.query(`
        SELECT panel_id, content, version, created_at,
               LENGTH(content::text) as content_size
        FROM document_saves
        WHERE note_id = $1
        ORDER BY created_at DESC
        LIMIT 3
      `, [note.id])

      if (docResult.rows.length > 0) {
        console.log(`   ✅ Found ${docResult.rows.length} saves in document_saves:`)
        docResult.rows.forEach((doc, i) => {
          console.log(`      Save ${i + 1}:`)
          console.log(`        Panel: ${doc.panel_id}`)
          console.log(`        Version: ${doc.version}`)
          console.log(`        Size: ${doc.content_size} bytes`)
          console.log(`        Content preview: ${JSON.stringify(doc.content).substring(0, 200)}`)
          console.log(`        Saved at: ${doc.created_at}`)
        })
      } else {
        console.log(`   ❌ No saves found in document_saves`)
      }

      // Check notes table
      const noteResult = await pool.query(`
        SELECT content_text, updated_at
        FROM notes
        WHERE id = $1
      `, [note.id])

      if (noteResult.rows.length > 0) {
        console.log(`   Notes table content_text: ${noteResult.rows[0].content_text || 'null'}`)
      }

      console.log('')
    }

  } catch (error) {
    console.error('Error checking database:', error)
  } finally {
    await pool.end()
  }
}

checkNoteContent()
