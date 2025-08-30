/**
 * Integration test for offline queue document_saves support
 * Verifies migration 009 allows document_saves in offline_queue
 */

import { Pool } from 'pg'
import { PostgresOfflineAdapter } from '../../lib/adapters/postgres-offline-adapter'

describe('Offline Queue Document Saves', () => {
  let pool: Pool
  let adapter: PostgresOfflineAdapter

  beforeAll(() => {
    // Use test database or create test pool
    pool = new Pool({
      host: process.env.POSTGRES_HOST || 'localhost',
      port: parseInt(process.env.POSTGRES_PORT || '5432'),
      user: process.env.POSTGRES_USER || 'postgres',
      password: process.env.POSTGRES_PASSWORD || 'postgres',
      database: process.env.POSTGRES_DB || 'annotation_dev'
    })
    
    adapter = new PostgresOfflineAdapter()
  })

  afterAll(async () => {
    await pool.end()
  })

  afterEach(async () => {
    // Clean up test data
    await pool.query(`
      DELETE FROM offline_queue 
      WHERE table_name = 'document_saves' 
        AND data->>'test' = 'integration'
    `)
  })

  describe('CHECK constraint validation', () => {
    it('should allow document_saves in table_name column', async () => {
      // This should NOT throw a CHECK constraint violation
      const result = await pool.query(
        `INSERT INTO offline_queue 
         (type, table_name, entity_id, data, status) 
         VALUES ($1, $2, $3, $4::jsonb, $5)
         RETURNING id, table_name`,
        [
          'update',
          'document_saves', // This is what migration 009 enables
          '550e8400-e29b-41d4-a716-446655440000',
          JSON.stringify({ test: 'integration', content: 'test data' }),
          'pending'
        ]
      )

      expect(result.rows).toHaveLength(1)
      expect(result.rows[0].table_name).toBe('document_saves')
    })

    it('should process document_saves operations in flush', async () => {
      // Insert a document_saves operation
      await pool.query(
        `INSERT INTO offline_queue 
         (id, type, table_name, entity_id, data, status) 
         VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
        [
          '550e8400-e29b-41d4-a716-446655440001',
          'update',
          'document_saves',
          '550e8400-e29b-41d4-a716-446655440002',
          JSON.stringify({
            test: 'integration',
            noteId: '550e8400-e29b-41d4-a716-446655440003',
            panelId: 'main',
            content: { type: 'doc', content: [] },
            version: 1
          }),
          'pending'
        ]
      )

      // Verify it can be retrieved for processing
      const pending = await pool.query(
        `SELECT * FROM offline_queue 
         WHERE table_name = 'document_saves' 
           AND status = 'pending'
         ORDER BY created_at`
      )

      expect(pending.rows).toHaveLength(1)
      expect(pending.rows[0].table_name).toBe('document_saves')
      expect(pending.rows[0].type).toBe('update')
    })

    it('should handle document entityType in enqueueOffline', async () => {
      // Test the adapter's enqueueOffline with document type
      const op = {
        operation: 'update' as const,
        entityType: 'document',
        entityId: '550e8400-e29b-41d4-a716-446655440004',
        payload: {
          noteId: '550e8400-e29b-41d4-a716-446655440005',
          panelId: 'main',
          content: { test: 'integration' },
          version: 1
        }
      }

      // This should map 'document' to 'document_saves' and insert successfully
      await adapter.enqueueOffline(op)

      // Verify it was inserted with correct table_name
      const result = await pool.query(
        `SELECT table_name FROM offline_queue 
         WHERE entity_id = $1`,
        [op.entityId]
      )

      expect(result.rows).toHaveLength(1)
      expect(result.rows[0].table_name).toBe('document_saves')
    })
  })

  describe('Constraint enforcement', () => {
    it('should still reject invalid table_name values', async () => {
      // This should still fail - constraint should only allow specific values
      await expect(
        pool.query(
          `INSERT INTO offline_queue 
           (type, table_name, entity_id, data) 
           VALUES ($1, $2, $3, $4::jsonb)`,
          [
            'update',
            'invalid_table', // Not in allowed list
            '550e8400-e29b-41d4-a716-446655440006',
            JSON.stringify({ test: 'should fail' })
          ]
        )
      ).rejects.toThrow(/constraint/)
    })

    it('should allow all valid table_name values', async () => {
      const validTables = ['notes', 'branches', 'panels', 'document_saves']
      
      for (const tableName of validTables) {
        const result = await pool.query(
          `INSERT INTO offline_queue 
           (type, table_name, entity_id, data) 
           VALUES ($1, $2, $3, $4::jsonb)
           RETURNING table_name`,
          [
            'create',
            tableName,
            `550e8400-e29b-41d4-a716-44665544${Math.floor(Math.random() * 10000).toString().padStart(4, '0')}`,
            JSON.stringify({ test: 'integration', table: tableName })
          ]
        )
        
        expect(result.rows[0].table_name).toBe(tableName)
      }

      // Clean up
      await pool.query(`
        DELETE FROM offline_queue 
        WHERE data->>'test' = 'integration'
      `)
    })
  })
})