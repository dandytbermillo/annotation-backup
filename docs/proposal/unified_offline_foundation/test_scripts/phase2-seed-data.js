#!/usr/bin/env node

/**
 * Phase 2 E2E Test Data Seeding Script
 * OFF-P2-BE-003
 * 
 * Seeds test data for notes, panels, and documents
 * Used by service worker cache tests
 */

const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.POSTGRES_URL || 'postgresql://postgres:postgres@localhost:5432/annotation_dev',
});

async function seedTestData() {
  console.log('🌱 Seeding Phase 2 test data...\n');
  
  try {
    // Create test user if not exists
    const userResult = await pool.query(`
      INSERT INTO users (id, email, name)
      VALUES ('test-user-1', 'test@example.com', 'Test User')
      ON CONFLICT (id) DO NOTHING
      RETURNING id
    `);
    
    const userId = userResult.rows[0]?.id || 'test-user-1';
    console.log(`✅ User: ${userId}`);

    // Seed notes
    console.log('\n📝 Seeding notes...');
    const noteIds = [];
    
    for (let i = 1; i <= 10; i++) {
      const result = await pool.query(`
        INSERT INTO notes (
          id, 
          title, 
          content, 
          user_id, 
          metadata,
          created_at,
          updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, NOW(), NOW()
        )
        ON CONFLICT (id) DO UPDATE
        SET title = EXCLUDED.title,
            content = EXCLUDED.content,
            updated_at = NOW()
        RETURNING id
      `, [
        `test-note-${i}`,
        `Test Note ${i}`,
        `This is test note ${i} content. It contains sample text for testing offline caching and synchronization.`,
        userId,
        JSON.stringify({
          tags: [`test`, `phase2`, `note${i}`],
          category: i % 2 === 0 ? 'explore' : 'note',
        })
      ]);
      
      noteIds.push(result.rows[0].id);
    }
    console.log(`✅ Created ${noteIds.length} notes`);

    // Seed panels
    console.log('\n🪟 Seeding panels...');
    const panelIds = [];
    
    for (let i = 1; i <= 5; i++) {
      const result = await pool.query(`
        INSERT INTO panels (
          id,
          note_id,
          position,
          dimensions,
          state,
          last_accessed
        ) VALUES (
          $1, $2, $3, $4, $5, NOW()
        )
        ON CONFLICT (id) DO UPDATE
        SET position = EXCLUDED.position,
            dimensions = EXCLUDED.dimensions,
            last_accessed = NOW()
        RETURNING id
      `, [
        `test-panel-${i}`,
        noteIds[i - 1],
        JSON.stringify({ x: i * 100, y: i * 50 }),
        JSON.stringify({ width: 400, height: 300 }),
        'open'
      ]);
      
      panelIds.push(result.rows[0].id);
    }
    console.log(`✅ Created ${panelIds.length} panels`);

    // Seed document saves
    console.log('\n📄 Seeding document saves...');
    const docIds = [];
    
    for (let i = 1; i <= 15; i++) {
      const noteIdx = i % noteIds.length;
      const panelIdx = i % panelIds.length;
      
      const result = await pool.query(`
        INSERT INTO document_saves (
          id,
          note_id,
          panel_id,
          content,
          version,
          created_at
        ) VALUES (
          $1, $2, $3, $4, $5, NOW()
        )
        ON CONFLICT (id) DO UPDATE
        SET content = EXCLUDED.content,
            version = EXCLUDED.version
        RETURNING id
      `, [
        `test-doc-${i}`,
        noteIds[noteIdx],
        panelIds[panelIdx],
        JSON.stringify({
          html: `<h1>Document ${i}</h1><p>This is test document ${i} with rich content.</p>`,
          text: `Document ${i}\nThis is test document ${i} with rich content.`,
          metadata: {
            wordCount: 10 + i,
            lastEdit: new Date().toISOString(),
          }
        }),
        i
      ]);
      
      docIds.push(result.rows[0].id);
    }
    console.log(`✅ Created ${docIds.length} document saves`);

    // Seed annotations
    console.log('\n🔖 Seeding annotations...');
    const annotationIds = [];
    
    for (let i = 1; i <= 20; i++) {
      const noteIdx = i % noteIds.length;
      
      const result = await pool.query(`
        INSERT INTO annotations (
          id,
          note_id,
          type,
          anchors,
          anchors_fallback,
          metadata,
          "order",
          version
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8
        )
        ON CONFLICT (id) DO UPDATE
        SET anchors = EXCLUDED.anchors,
            metadata = EXCLUDED.metadata
        RETURNING id
      `, [
        `test-annotation-${i}`,
        noteIds[noteIdx],
        i % 3 === 0 ? 'highlight' : i % 3 === 1 ? 'comment' : 'bookmark',
        JSON.stringify({
          start: i * 10,
          end: (i * 10) + 20,
          text: `Sample text ${i}`,
        }),
        JSON.stringify({
          context: `Context for annotation ${i}`,
        }),
        JSON.stringify({
          color: i % 2 === 0 ? 'yellow' : 'blue',
          author: userId,
        }),
        i,
        1
      ]);
      
      annotationIds.push(result.rows[0].id);
    }
    console.log(`✅ Created ${annotationIds.length} annotations`);

    // Seed some offline queue items for testing
    console.log('\n📮 Seeding offline queue items...');
    
    for (let i = 1; i <= 5; i++) {
      await pool.query(`
        INSERT INTO offline_queue (
          type,
          table_name,
          entity_id,
          data,
          status,
          retry_count,
          error_message,
          created_at,
          updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, NOW(), NOW()
        )
        ON CONFLICT (id) DO NOTHING
      `, [
        i % 2 === 0 ? 'update' : 'create',
        'notes',
        noteIds[i % noteIds.length],
        JSON.stringify({ 
          title: `Updated Note ${i}`,
          content: `Updated content for note ${i}`
        }),
        i === 1 ? 'pending' : i === 2 ? 'processing' : i === 3 ? 'failed' : 'pending',
        i === 3 ? 3 : 0,
        i === 3 ? 'Network timeout' : null
      ]);
    }
    console.log(`✅ Created 5 offline queue items`);

    // Summary
    console.log('\n' + '='.repeat(50));
    console.log('📊 SEEDING COMPLETE');
    console.log('='.repeat(50));
    console.log(`✅ Notes: ${noteIds.length}`);
    console.log(`✅ Panels: ${panelIds.length}`);
    console.log(`✅ Documents: ${docIds.length}`);
    console.log(`✅ Annotations: ${annotationIds.length}`);
    console.log(`✅ Queue Items: 5`);
    console.log('\n🎉 Test data seeded successfully!\n');

    return {
      userId,
      noteIds,
      panelIds,
      docIds,
      annotationIds,
    };
  } catch (error) {
    console.error('❌ Seeding failed:', error);
    throw error;
  }
}

// Run seeding if executed directly
if (require.main === module) {
  seedTestData()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    })
    .finally(() => pool.end());
}

module.exports = { seedTestData };