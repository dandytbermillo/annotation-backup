#!/usr/bin/env node

/**
 * Decode YJS updates to see what's being stored
 */

const { Pool } = require('pg');
const Y = require('yjs');

// PostgreSQL connection
const pool = new Pool({
  host: process.env.POSTGRES_HOST || 'localhost',
  port: parseInt(process.env.POSTGRES_PORT || '5432'),
  user: process.env.POSTGRES_USER || 'postgres',
  password: process.env.POSTGRES_PASSWORD || 'postgres',
  database: process.env.POSTGRES_DB || 'annotation_system',
});

async function decodeUpdates() {
  try {
    console.log('Decoding YJS updates...\n');

    // Get recent updates for a specific panel
    const docName = process.argv[2] || 'note-1756305936738-panel-main';
    console.log(`Checking updates for: ${docName}\n`);

    const result = await pool.query(
      'SELECT update, timestamp FROM yjs_updates WHERE doc_name = $1 ORDER BY timestamp DESC LIMIT 10',
      [docName]
    );

    if (result.rows.length === 0) {
      console.log('No updates found for this document');
      return;
    }

    // Create a new Y.Doc and apply all updates to see the final state
    const doc = new Y.Doc();
    let updateCount = 0;

    // Apply updates in chronological order
    const updates = result.rows.reverse();
    
    for (const row of updates) {
      updateCount++;
      const update = new Uint8Array(row.update);
      console.log(`\nUpdate ${updateCount} (${update.length} bytes) at ${row.timestamp}:`);
      
      try {
        Y.applyUpdate(doc, update);
        
        // Try to get the content
        const xmlFragment = doc.getXmlFragment('prosemirror');
        const text = xmlFragment.toString();
        
        if (text && text.length > 0) {
          console.log('Content:', text.substring(0, 200) + (text.length > 200 ? '...' : ''));
        } else {
          console.log('No prosemirror content found');
          
          // Check other possible content locations
          const maps = doc.share;
          const keys = Array.from(maps.keys());
          if (keys.length > 0) {
            console.log('Available keys:', keys);
            keys.forEach(key => {
              const value = maps.get(key);
              if (value) {
                console.log(`  ${key}:`, value.toString().substring(0, 100));
              }
            });
          }
        }
      } catch (error) {
        console.log('Error applying update:', error.message);
      }
    }

    // Show final state
    console.log('\n\nFinal document state:');
    const xmlFragment = doc.getXmlFragment('prosemirror');
    const finalText = xmlFragment.toString();
    if (finalText && finalText.length > 0) {
      console.log('Final content:', finalText);
    } else {
      console.log('Document appears to be empty');
      
      // Debug: show all content
      const maps = doc.share;
      console.log('All shared content:');
      maps.forEach((value, key) => {
        console.log(`  ${key}:`, value);
      });
    }

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await pool.end();
  }
}

// Run the decoder
decodeUpdates();