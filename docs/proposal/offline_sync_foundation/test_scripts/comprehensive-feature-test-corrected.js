#!/usr/bin/env node

/**
 * Comprehensive Feature Test Suite for Offline Sync Foundation
 * CORRECTED VERSION - Matches actual implementation design
 * 
 * Key corrections based on expert review:
 * 1. Queue status: pending → processing → DELETE (no "completed" status)
 * 2. Dead-letter uses "error_message" not "reason"
 * 3. Seeds valid UUIDs for notes/panels before FK operations
 * 4. Duplicate detection uses same idempotency_key
 */

const http = require('http');
const crypto = require('crypto');
const { Pool } = require('pg');

// Configuration
const API_BASE = 'http://localhost:3000/api';
const DB_URL = process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/annotation_dev';

// Test utilities
const colors = {
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[36m',
  magenta: '\x1b[35m',
  reset: '\x1b[0m'
};

const log = (message, color = 'reset') => {
  console.log(`${colors[color]}${message}${colors.reset}`);
};

// Database connection
const pool = new Pool({ connectionString: DB_URL });

// HTTP request helper
const makeRequest = (path, options = {}) => {
  return new Promise((resolve, reject) => {
    const url = new URL(`${API_BASE}${path}`);
    
    const reqOptions = {
      hostname: url.hostname,
      port: url.port || 3000,
      path: url.pathname + url.search,
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...options.headers
      },
      timeout: 5000
    };

    const req = http.request(reqOptions, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve({ status: res.statusCode, data: json });
        } catch (e) {
          resolve({ status: res.statusCode, data: data });
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });

    if (options.body) {
      req.write(JSON.stringify(options.body));
    }

    req.end();
  });
};

// Test suites
const testSuites = {
  // 1. OFFLINE QUEUE TESTS
  offlineQueue: {
    name: 'Offline Queue (Database)',
    tests: [
      {
        name: 'Enqueue with full envelope',
        async test() {
          const testOp = {
            type: 'update',
            table_name: 'notes',
            entity_id: crypto.randomUUID(),
            data: { title: 'Test Note' },
            idempotency_key: crypto.randomUUID(),
            origin_device_id: 'test-device',
            schema_version: 1,
            priority: 10,
            expires_at: new Date(Date.now() + 86400000).toISOString()
          };

          const result = await pool.query(
            `INSERT INTO offline_queue 
             (type, table_name, entity_id, data, idempotency_key, 
              origin_device_id, schema_version, priority, expires_at, status)
             VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8, $9, 'pending')
             RETURNING id`,
            [testOp.type, testOp.table_name, testOp.entity_id, testOp.data,
             testOp.idempotency_key, testOp.origin_device_id, testOp.schema_version,
             testOp.priority, testOp.expires_at]
          );

          if (!result.rows[0].id) throw new Error('Failed to enqueue');
          
          // Cleanup
          await pool.query('DELETE FROM offline_queue WHERE id = $1', [result.rows[0].id]);
          
          return 'Enqueued with full envelope';
        }
      },
      {
        name: 'Status progression (pending→processing→DELETE)',
        async test() {
          const id = crypto.randomUUID();
          const idempKey = crypto.randomUUID();
          const entityId = crypto.randomUUID();
          
          // Insert as pending
          await pool.query(
            `INSERT INTO offline_queue (id, type, table_name, entity_id, data, idempotency_key, status)
             VALUES ($1, 'update', 'notes', $3, '{}'::jsonb, $2, 'pending')`,
            [id, idempKey, entityId]
          );

          // Update to processing
          await pool.query(
            `UPDATE offline_queue SET status = 'processing' WHERE id = $1`,
            [id]
          );

          // Verify processing
          const processing = await pool.query(
            `SELECT status FROM offline_queue WHERE id = $1`,
            [id]
          );
          if (processing.rows[0].status !== 'processing') {
            throw new Error('Status not updated to processing');
          }

          // Delete (simulating successful processing)
          await pool.query('DELETE FROM offline_queue WHERE id = $1', [id]);
          
          // Verify deletion
          const deleted = await pool.query(
            `SELECT COUNT(*) as count FROM offline_queue WHERE id = $1`,
            [id]
          );
          
          if (deleted.rows[0].count !== '0') {
            throw new Error('Row not deleted after processing');
          }
          
          return 'Status progression: pending→processing→DELETE';
        }
      },
      {
        name: 'Priority ordering (DESC) and created_at (ASC)',
        async test() {
          const ops = [
            { priority: 5, delay: 0 },
            { priority: 10, delay: 100 },
            { priority: 5, delay: 200 }
          ];

          const ids = [];
          for (const op of ops) {
            await new Promise(r => setTimeout(r, op.delay));
            const result = await pool.query(
              `INSERT INTO offline_queue 
               (type, table_name, entity_id, data, idempotency_key, priority, status)
               VALUES ('update', 'notes', $3, '{}'::jsonb, $1, $2, 'pending')
               RETURNING id`,
              [crypto.randomUUID(), op.priority, crypto.randomUUID()]
            );
            ids.push(result.rows[0].id);
          }

          const ordered = await pool.query(
            `SELECT id FROM offline_queue 
             WHERE id = ANY($1::uuid[])
             ORDER BY priority DESC, created_at ASC`,
            [ids]
          );

          // Cleanup
          await pool.query('DELETE FROM offline_queue WHERE id = ANY($1::uuid[])', [ids]);

          // Should be: high priority first, then older of same priority
          const expectedOrder = [ids[1], ids[0], ids[2]]; // 10, 5 (older), 5 (newer)
          const actualOrder = ordered.rows.map(r => r.id);
          
          if (JSON.stringify(expectedOrder) !== JSON.stringify(actualOrder)) {
            throw new Error(`Order mismatch: expected ${expectedOrder}, got ${actualOrder}`);
          }
          
          return 'Priority and time ordering correct';
        }
      },
      {
        name: 'TTL/expiry handling',
        async test() {
          const expired = new Date(Date.now() - 1000).toISOString();
          const valid = new Date(Date.now() + 86400000).toISOString();
          
          const expiredId = crypto.randomUUID();
          const validId = crypto.randomUUID();
          
          await pool.query(
            `INSERT INTO offline_queue 
             (id, type, table_name, entity_id, data, idempotency_key, expires_at, status)
             VALUES 
             ($1, 'update', 'notes', $7, '{}'::jsonb, $2, $3, 'pending'),
             ($4, 'update', 'notes', $8, '{}'::jsonb, $5, $6, 'pending')`,
            [expiredId, crypto.randomUUID(), expired, 
             validId, crypto.randomUUID(), valid,
             crypto.randomUUID(), crypto.randomUUID()]
          );

          // Check expired operations
          const result = await pool.query(
            `SELECT id, 
                    CASE WHEN expires_at < NOW() THEN 'expired' ELSE 'valid' END as status
             FROM offline_queue 
             WHERE id IN ($1, $2)`,
            [expiredId, validId]
          );

          // Cleanup
          await pool.query('DELETE FROM offline_queue WHERE id IN ($1, $2)', [expiredId, validId]);

          const expiredRow = result.rows.find(r => r.id === expiredId);
          const validRow = result.rows.find(r => r.id === validId);
          
          if (expiredRow.status !== 'expired' || validRow.status !== 'valid') {
            throw new Error('TTL expiry detection failed');
          }
          
          return 'TTL/expiry correctly detected';
        }
      },
      {
        name: 'Idempotency key uniqueness',
        async test() {
          const idempKey = crypto.randomUUID();
          
          // First insert
          await pool.query(
            `INSERT INTO offline_queue 
             (type, table_name, entity_id, data, idempotency_key, status)
             VALUES ('update', 'notes', $2, '{}'::jsonb, $1, 'pending')`,
            [idempKey, crypto.randomUUID()]
          );

          // Try duplicate with SAME idempotency_key
          let duplicateFailed = false;
          try {
            await pool.query(
              `INSERT INTO offline_queue 
               (type, table_name, entity_id, data, idempotency_key, status)
               VALUES ('create', 'panels', $2, '{}'::jsonb, $1, 'pending')`,
              [idempKey, crypto.randomUUID()]  // Same idempKey!
            );
          } catch (err) {
            if (err.code === '23505') { // Unique violation
              duplicateFailed = true;
            }
          }

          // Cleanup
          await pool.query('DELETE FROM offline_queue WHERE idempotency_key = $1', [idempKey]);

          if (!duplicateFailed) {
            throw new Error('Duplicate idempotency_key was allowed');
          }
          
          return 'Idempotency enforced';
        }
      },
      {
        name: 'Dead-letter queue after max retries',
        async test() {
          const idempKey = crypto.randomUUID();
          const entityId = crypto.randomUUID();
          
          // Insert with max retries
          await pool.query(
            `INSERT INTO offline_queue 
             (type, table_name, entity_id, data, idempotency_key, status, retry_count, error_message)
             VALUES ('update', 'notes', $1, '{}'::jsonb, $2, 'failed', 5, 'Max retries reached')`,
            [entityId, idempKey]
          );

          // Move to dead letter (using correct column names)
          await pool.query(
            `INSERT INTO offline_dead_letter 
             (idempotency_key, type, table_name, entity_id, data, error_message, retry_count)
             SELECT idempotency_key, type, table_name, entity_id, data, error_message, retry_count
             FROM offline_queue 
             WHERE idempotency_key = $1 AND retry_count >= 5`,
            [idempKey]
          );

          // Delete from main queue
          await pool.query(
            `DELETE FROM offline_queue WHERE idempotency_key = $1`, 
            [idempKey]
          );

          // Verify in dead letter
          const deadLetter = await pool.query(
            `SELECT * FROM offline_dead_letter WHERE idempotency_key = $1`,
            [idempKey]
          );

          // Cleanup
          await pool.query('DELETE FROM offline_dead_letter WHERE idempotency_key = $1', [idempKey]);

          if (deadLetter.rows.length !== 1) {
            throw new Error('Failed to move to dead letter');
          }
          
          return 'Dead-letter queue working';
        }
      }
    ]
  },

  // 2. WEB OFFLINE UX TESTS
  webOfflineUX: {
    name: 'Web Offline UX',
    tests: [
      {
        name: 'Export queue with checksum',
        async test() {
          const res = await makeRequest('/offline-queue/export?status=pending');
          if (res.status !== 200) throw new Error(`Status ${res.status}`);
          if (!res.data.checksum) throw new Error('Missing checksum');
          if (!res.data.metadata?.checksum) throw new Error('Missing metadata checksum');
          if (!res.data.version) throw new Error('Missing version');
          return `Exported with checksum: ${res.data.checksum.substring(0, 8)}...`;
        }
      },
      {
        name: 'Import with validation-only mode',
        async test() {
          const testOp = {
            type: 'create',
            table_name: 'notes',
            entity_id: crypto.randomUUID(),
            data: { title: 'Test' },
            idempotency_key: crypto.randomUUID()
          };

          const res = await makeRequest('/offline-queue/import', {
            method: 'POST',
            body: {
              version: 2,
              operations: [testOp],
              validate_only: true
            }
          });

          if (res.status !== 200) throw new Error(`Status ${res.status}`);
          if (!res.data.valid) throw new Error('Validation failed');
          return 'Validation-only mode works';
        }
      },
      {
        name: 'Import skips duplicates (same idempotency_key)',
        async test() {
          const idempKey = crypto.randomUUID();
          const testOp = {
            type: 'create',
            table_name: 'notes',
            entity_id: crypto.randomUUID(),
            data: { title: 'Test' },
            idempotency_key: idempKey  // SAME key for both imports
          };

          // First import
          await makeRequest('/offline-queue/import', {
            method: 'POST',
            body: {
              version: 2,
              operations: [testOp]
            }
          });

          // Second import with SAME idempotency_key
          const res = await makeRequest('/offline-queue/import', {
            method: 'POST',
            body: {
              version: 2,
              operations: [testOp]  // Exact same operation
            }
          });

          // Cleanup
          await pool.query('DELETE FROM offline_queue WHERE idempotency_key = $1', [idempKey]);

          if (res.data.skipped !== 1) {
            throw new Error(`Expected 1 skipped, got ${res.data.skipped}`);
          }
          
          return 'Duplicates correctly skipped';
        }
      }
    ]
  },

  // 3. API CONTRACT TESTS
  apiContracts: {
    name: 'IPC/API Contracts',
    tests: [
      {
        name: 'Health endpoint',
        async test() {
          const res = await makeRequest('/health');
          if (res.status !== 200) throw new Error(`Status ${res.status}`);
          if (!res.data.ok) throw new Error('Health not ok');
          if (!res.data.timestamp) throw new Error('Missing timestamp');
          return 'Health endpoint working';
        }
      },
      {
        name: 'Search returns grouped results',
        async test() {
          const res = await makeRequest('/search?q=test');
          if (res.status !== 200) throw new Error(`Status ${res.status}`);
          if (typeof res.data.results !== 'object') throw new Error('Results not grouped');
          if (typeof res.data.totalCount !== 'number') throw new Error('Missing totalCount');
          return `Search returns ${res.data.totalCount} total results`;
        }
      },
      {
        name: 'Search validates empty query',
        async test() {
          const res = await makeRequest('/search?q=');
          if (res.status !== 400) throw new Error(`Expected 400, got ${res.status}`);
          return 'Empty query rejected (400)';
        }
      },
      {
        name: 'Export includes metadata',
        async test() {
          const res = await makeRequest('/offline-queue/export?metadata=true');
          if (res.status !== 200) throw new Error(`Status ${res.status}`);
          if (!res.data.metadata?.statistics) throw new Error('Missing statistics');
          if (res.data.metadata?.dead_letter_count === undefined) {
            throw new Error('Missing dead_letter_count');
          }
          return 'Export metadata included';
        }
      },
      {
        name: 'Queue flush API with valid note_id',
        async test() {
          const noteId = crypto.randomUUID();
          const panelId = crypto.randomUUID();
          
          // First create the note and panel
          await pool.query(
            `INSERT INTO notes (id, title, metadata, created_at, updated_at)
             VALUES ($1, 'Test Note', '{}'::jsonb, NOW(), NOW())
             ON CONFLICT (id) DO NOTHING`,
            [noteId]
          );
          const panelKey1 = 'p-' + crypto.randomUUID();
          await pool.query(
            `INSERT INTO panels (id, note_id, panel_id, position, dimensions, state, last_accessed)
             VALUES ($1, $2, $3, '{"x": 0, "y": 0}'::jsonb, '{"width": 400, "height": 300}'::jsonb, 'active', NOW())
             ON CONFLICT (id) DO NOTHING`,
            [panelId, noteId, panelKey1]
          );
          
          const res = await makeRequest('/postgres-offline/queue/flush', {
            method: 'POST',
            body: {
              operations: [{
                noteId: noteId,
                panelId: panelId,
                operation: 'update',
                data: { content: { test: true } }
              }]
            }
          });
          
          // Cleanup
          await pool.query(`DELETE FROM document_saves WHERE note_id = $1 AND panel_id = $2`, [noteId, panelId]);
          await pool.query(`DELETE FROM panels WHERE id = $1`, [panelId]);
          await pool.query(`DELETE FROM notes WHERE id = $1`, [noteId]);

          if (res.status !== 200) throw new Error(`Status ${res.status}`);
          if (res.data.succeeded !== 1) throw new Error('Operation not successful');
          return 'Queue flush with valid FK works';
        }
      }
    ]
  },

  // 4. FULL-TEXT SEARCH TESTS
  fullTextSearch: {
    name: 'Full-Text Search (document_saves)',
    tests: [
      {
        name: 'ProseMirror text extraction',
        async test() {
          const pmDoc = {
            type: 'doc',
            content: [
              { type: 'paragraph', content: [
                { type: 'text', text: 'Hello world' }
              ]},
              { type: 'paragraph', content: [
                { type: 'text', text: 'Testing extraction' }
              ]}
            ]
          };

          const result = await pool.query(
            `SELECT pm_extract_text($1::jsonb) as extracted`,
            [JSON.stringify(pmDoc)]
          );

          const extracted = result.rows[0].extracted;
          if (!extracted.includes('Hello world')) {
            throw new Error('Text not extracted from ProseMirror');
          }
          if (!extracted.includes('Testing extraction')) {
            throw new Error('Second paragraph not extracted');
          }
          
          return 'ProseMirror extraction works';
        }
      },
      {
        name: 'Search vector generation with seeded data',
        async test() {
          const noteId = crypto.randomUUID();
          const panelId = crypto.randomUUID();
          const content = {
            type: 'doc',
            content: [
              { type: 'paragraph', content: [
                { type: 'text', text: 'Unique test content xyz123' }
              ]}
            ]
          };

          // First create the note and panel (REQUIRED for FK)
          await pool.query(
            `INSERT INTO notes (id, title, metadata, created_at, updated_at)
             VALUES ($1, 'Test Note', '{}'::jsonb, NOW(), NOW())
             ON CONFLICT (id) DO NOTHING`,
            [noteId]
          );
          const panelKey2 = 'p-' + crypto.randomUUID();
          await pool.query(
            `INSERT INTO panels (id, note_id, panel_id, position, dimensions, state, last_accessed)
             VALUES ($1, $2, $3, '{"x": 0, "y": 0}'::jsonb, '{"width": 400, "height": 300}'::jsonb, 'active', NOW())
             ON CONFLICT (id) DO NOTHING`,
            [panelId, noteId, panelKey2]
          );

          // Insert test document
          await pool.query(
            `INSERT INTO document_saves (note_id, panel_id, content, version, created_at)
             VALUES ($1, $2, $3::jsonb, 1, NOW())`,
            [noteId, panelId, JSON.stringify(content)]
          );

          // Check search vector
          const result = await pool.query(
            `SELECT search_vector IS NOT NULL as has_vector,
                    document_text
             FROM document_saves 
             WHERE note_id = $1 AND panel_id = $2`,
            [noteId, panelId]
          );

          // Cleanup
          await pool.query(`DELETE FROM document_saves WHERE note_id = $1 AND panel_id = $2`, [noteId, panelId]);
          await pool.query(`DELETE FROM panels WHERE id = $1`, [panelId]);
          await pool.query(`DELETE FROM notes WHERE id = $1`, [noteId]);

          if (!result.rows[0].has_vector) {
            throw new Error('Search vector not generated');
          }
          if (!result.rows[0].document_text.includes('xyz123')) {
            throw new Error('Document text not extracted');
          }
          
          return 'Search vector generated';
        }
      },
      {
        name: 'Unaccent handling',
        async test() {
          const result = await pool.query(
            `SELECT unaccent('café résumé naïve') as unaccented`
          );

          const unaccented = result.rows[0].unaccented;
          if (unaccented !== 'cafe resume naive') {
            throw new Error(`Unaccent failed: got "${unaccented}"`);
          }
          
          return 'Unaccent handles diacritics';
        }
      },
      {
        name: 'Trigram fuzzy search (better match)',
        async test() {
          // Use strings with better similarity
          const result = await pool.query(
            `SELECT similarity('testing', 'testign') as sim`
          );

          const similarity = result.rows[0].sim;
          if (similarity < 0.5) {
            throw new Error(`Trigram similarity too low: ${similarity}`);
          }
          
          return `Trigram similarity: ${similarity.toFixed(2)}`;
        }
      }
    ]
  },

  // 5. VERSION HISTORY TESTS
  versionHistory: {
    name: 'Version History',
    tests: [
      {
        name: 'Version auto-increment with seeded data',
        async test() {
          const noteId = crypto.randomUUID();
          const panelId = crypto.randomUUID();

          // Create note and panel first (REQUIRED)
          await pool.query(
            `INSERT INTO notes (id, title, metadata, created_at, updated_at)
             VALUES ($1, 'Test Note', '{}'::jsonb, NOW(), NOW())
             ON CONFLICT (id) DO NOTHING`,
            [noteId]
          );
          const panelKey3 = 'p-' + crypto.randomUUID();
          await pool.query(
            `INSERT INTO panels (id, note_id, panel_id, position, dimensions, state, last_accessed)
             VALUES ($1, $2, $3, '{"x": 0, "y": 0}'::jsonb, '{"width": 400, "height": 300}'::jsonb, 'active', NOW())
             ON CONFLICT (id) DO NOTHING`,
            [panelId, noteId, panelKey3]
          );

          // Insert multiple versions
          for (let i = 1; i <= 3; i++) {
            await pool.query(
              `WITH next AS (
                 SELECT COALESCE(MAX(version), 0) + 1 AS v
                 FROM document_saves
                 WHERE note_id = $1 AND panel_id = $2
               )
               INSERT INTO document_saves (note_id, panel_id, content, version, created_at)
               SELECT $1, $2, $3::jsonb, next.v, NOW()
               FROM next`,
              [noteId, panelId, JSON.stringify({ version: i })]
            );
          }

          // Check versions
          const result = await pool.query(
            `SELECT version FROM document_saves 
             WHERE note_id = $1 AND panel_id = $2
             ORDER BY version`,
            [noteId, panelId]
          );

          // Cleanup
          await pool.query(`DELETE FROM document_saves WHERE note_id = $1 AND panel_id = $2`, [noteId, panelId]);
          await pool.query(`DELETE FROM panels WHERE id = $1`, [panelId]);
          await pool.query(`DELETE FROM notes WHERE id = $1`, [noteId]);

          const versions = result.rows.map(r => r.version);
          if (JSON.stringify(versions) !== JSON.stringify([1, 2, 3])) {
            throw new Error(`Version sequence wrong: ${versions}`);
          }
          
          return 'Version auto-increment works';
        }
      },
      {
        name: 'Version size calculation with seeded data',
        async test() {
          const noteId = crypto.randomUUID();
          const panelId = crypto.randomUUID();
          const content = { data: 'x'.repeat(1000) };

          // Create note and panel first
          await pool.query(
            `INSERT INTO notes (id, title, metadata, created_at, updated_at)
             VALUES ($1, 'Test Note', '{}'::jsonb, NOW(), NOW())
             ON CONFLICT (id) DO NOTHING`,
            [noteId]
          );
          const panelKey4 = 'p-' + crypto.randomUUID();
          await pool.query(
            `INSERT INTO panels (id, note_id, panel_id, position, dimensions, state, last_accessed)
             VALUES ($1, $2, $3, '{"x": 0, "y": 0}'::jsonb, '{"width": 400, "height": 300}'::jsonb, 'active', NOW())
             ON CONFLICT (id) DO NOTHING`,
            [panelId, noteId, panelKey4]
          );

          await pool.query(
            `INSERT INTO document_saves (note_id, panel_id, content, version, created_at)
             VALUES ($1, $2, $3::jsonb, 1, NOW())`,
            [noteId, panelId, JSON.stringify(content)]
          );

          const result = await pool.query(
            `SELECT pg_column_size(content::text) as size_bytes
             FROM document_saves 
             WHERE note_id = $1 AND panel_id = $2`,
            [noteId, panelId]
          );

          // Cleanup
          await pool.query(`DELETE FROM document_saves WHERE note_id = $1 AND panel_id = $2`, [noteId, panelId]);
          await pool.query(`DELETE FROM panels WHERE id = $1`, [panelId]);
          await pool.query(`DELETE FROM notes WHERE id = $1`, [noteId]);

          if (result.rows[0].size_bytes < 1000) {
            throw new Error('Size calculation seems wrong');
          }
          
          return `Size calculation: ${result.rows[0].size_bytes} bytes`;
        }
      }
    ]
  },

  // 6. MIGRATIONS/SCHEMA TESTS
  migrationsSchema: {
    name: 'Migrations/Schema',
    tests: [
      {
        name: 'Extensions enabled',
        async test() {
          const result = await pool.query(
            `SELECT extname FROM pg_extension 
             WHERE extname IN ('unaccent', 'pg_trgm')`
          );

          const extensions = result.rows.map(r => r.extname);
          if (!extensions.includes('unaccent')) {
            throw new Error('unaccent extension not enabled');
          }
          if (!extensions.includes('pg_trgm')) {
            throw new Error('pg_trgm extension not enabled');
          }
          
          return 'Required extensions enabled';
        }
      },
      {
        name: 'document_saves schema correct',
        async test() {
          const result = await pool.query(
            `SELECT column_name, data_type, is_nullable
             FROM information_schema.columns 
             WHERE table_name = 'document_saves'
             AND column_name IN ('note_id', 'panel_id', 'content', 'version', 
                                 'created_at', 'document_text', 'search_vector')`
          );

          const columns = {};
          result.rows.forEach(r => {
            columns[r.column_name] = r.data_type;
          });

          if (columns.note_id !== 'uuid') throw new Error('note_id not uuid');
          if (columns.panel_id !== 'uuid') throw new Error('panel_id not uuid');
          if (columns.content !== 'jsonb') throw new Error('content not jsonb');
          if (columns.version !== 'integer') throw new Error('version not integer');
          if (!columns.document_text) throw new Error('document_text missing');
          if (!columns.search_vector) throw new Error('search_vector missing');
          
          return 'Schema correct';
        }
      },
      {
        name: 'Indexes present',
        async test() {
          const result = await pool.query(
            `SELECT indexname, indexdef
             FROM pg_indexes 
             WHERE tablename = 'document_saves'
             AND (indexdef LIKE '%gin%' OR indexdef LIKE '%gist%')`
          );

          if (result.rows.length === 0) {
            throw new Error('No GIN/GIST indexes found');
          }
          
          return `${result.rows.length} FTS indexes present`;
        }
      },
      {
        name: 'offline_queue constraints',
        async test() {
          const result = await pool.query(
            `SELECT constraint_name, constraint_type
             FROM information_schema.table_constraints
             WHERE table_name = 'offline_queue'
             AND constraint_type IN ('UNIQUE', 'PRIMARY KEY')`
          );

          const hasIdempotencyUnique = result.rows.some(r => 
            r.constraint_name.includes('idempotency_key')
          );

          if (!hasIdempotencyUnique) {
            throw new Error('idempotency_key unique constraint missing');
          }
          
          return 'Constraints properly configured';
        }
      },
      {
        name: 'Queue status enum values',
        async test() {
          const result = await pool.query(
            `SELECT enumlabel 
             FROM pg_enum 
             WHERE enumtypid = 'offline_operation_status'::regtype
             ORDER BY enumsortorder`
          );

          const statuses = result.rows.map(r => r.enumlabel);
          const expected = ['pending', 'processing', 'failed'];
          
          if (JSON.stringify(statuses) !== JSON.stringify(expected)) {
            throw new Error(`Enum values: ${statuses.join(', ')} (no 'completed')`);
          }
          
          return `Correct enum: ${statuses.join('→')}→DELETE`;
        }
      }
    ]
  }
};

// Test runner
async function runAllTests() {
  log('\n=====================================', 'magenta');
  log('  Comprehensive Feature Test Suite', 'magenta');
  log('  (CORRECTED VERSION)', 'magenta');
  log('=====================================\n', 'magenta');
  
  const summary = {
    total: 0,
    passed: 0,
    failed: 0,
    suites: []
  };

  for (const [key, suite] of Object.entries(testSuites)) {
    log(`\n${suite.name}`, 'blue');
    log('─'.repeat(40), 'blue');
    
    const suiteResult = {
      name: suite.name,
      tests: [],
      passed: 0,
      failed: 0
    };

    for (const test of suite.tests) {
      process.stdout.write(`  ${test.name}... `);
      summary.total++;
      
      try {
        const result = await test.test();
        log(`✓`, 'green');
        if (result) {
          log(`    └─ ${result}`, 'blue');
        }
        summary.passed++;
        suiteResult.passed++;
        suiteResult.tests.push({ name: test.name, status: 'PASS', message: result });
      } catch (error) {
        log(`✗`, 'red');
        log(`    └─ ${error.message}`, 'red');
        summary.failed++;
        suiteResult.failed++;
        suiteResult.tests.push({ name: test.name, status: 'FAIL', error: error.message });
      }
    }
    
    summary.suites.push(suiteResult);
  }

  // Print summary
  log('\n=====================================', 'magenta');
  log('            Test Summary', 'magenta');
  log('=====================================', 'magenta');
  
  summary.suites.forEach(suite => {
    const color = suite.failed > 0 ? 'yellow' : 'green';
    log(`${suite.name}: ${suite.passed}/${suite.tests.length} passed`, color);
  });
  
  log('', 'reset');
  const overallColor = summary.failed > 0 ? 'yellow' : 'green';
  log(`Overall: ${summary.passed}/${summary.total} tests passed`, overallColor);
  
  if (summary.failed > 0) {
    log(`\nFailed Tests:`, 'red');
    summary.suites.forEach(suite => {
      suite.tests.filter(t => t.status === 'FAIL').forEach(t => {
        log(`  • ${suite.name} > ${t.name}: ${t.error}`, 'red');
      });
    });
  }

  return summary;
}

// Check prerequisites
async function checkPrerequisites() {
  log('Checking prerequisites...', 'yellow');
  
  // Check database connection
  try {
    await pool.query('SELECT 1');
    log('✓ Database connection', 'green');
  } catch (error) {
    log('✗ Database connection failed', 'red');
    log(`  ${error.message}`, 'red');
    return false;
  }

  // Check server
  try {
    await makeRequest('/health');
    log('✓ API server running', 'green');
  } catch (error) {
    log('✗ API server not running', 'red');
    log('  Please start with: npm run dev', 'yellow');
    return false;
  }

  return true;
}

// Main execution
(async () => {
  try {
    const ready = await checkPrerequisites();
    if (!ready) {
      process.exit(1);
    }

    const summary = await runAllTests();
    
    // Close database connection
    await pool.end();
    
    // Exit with appropriate code
    process.exit(summary.failed > 0 ? 1 : 0);
  } catch (error) {
    log(`\nUnexpected error: ${error.message}`, 'red');
    console.error(error);
    await pool.end();
    process.exit(1);
  }
})();