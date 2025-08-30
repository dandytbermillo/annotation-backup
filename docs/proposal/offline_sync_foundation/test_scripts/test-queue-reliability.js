#!/usr/bin/env node

/**
 * Queue Reliability Test Script
 * Tests idempotency, priority, TTL, and dead-letter functionality
 */

const { Pool } = require('pg');
const crypto = require('crypto');

// Database configuration
const pool = new Pool({
  host: 'localhost',
  port: 5432,
  database: 'annotation_dev',
  user: 'postgres',
  password: 'postgres'
});

// Test utilities
const log = (message, type = 'info') => {
  const colors = {
    info: '\x1b[36m',
    success: '\x1b[32m',
    error: '\x1b[31m',
    warning: '\x1b[33m'
  };
  console.log(`${colors[type]}${message}\x1b[0m`);
};

const generateTestOperation = (overrides = {}) => ({
  type: 'create',
  table_name: 'test_table',
  entity_id: crypto.randomUUID(),
  data: { test: true, timestamp: new Date().toISOString() },
  idempotency_key: crypto.randomUUID(),
  origin_device_id: 'test-script',
  schema_version: 1,
  priority: 0,
  ...overrides
});

// Test functions
async function testIdempotency() {
  log('\n=== Testing Idempotency ===', 'info');
  
  const idempotencyKey = crypto.randomUUID();
  const operation = generateTestOperation({ idempotency_key: idempotencyKey });
  
  try {
    // Insert operation twice with same idempotency key
    await pool.query(
      `INSERT INTO offline_queue (
        type, table_name, entity_id, data, idempotency_key, 
        origin_device_id, priority, status, created_at
      ) VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, 'pending', NOW())
      ON CONFLICT (idempotency_key) DO NOTHING`,
      [
        operation.type, operation.table_name, operation.entity_id,
        JSON.stringify(operation.data), operation.idempotency_key,
        operation.origin_device_id, operation.priority
      ]
    );
    
    // Try inserting again
    const result = await pool.query(
      `INSERT INTO offline_queue (
        type, table_name, entity_id, data, idempotency_key, 
        origin_device_id, priority, status, created_at
      ) VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, 'pending', NOW())
      ON CONFLICT (idempotency_key) DO NOTHING
      RETURNING id`,
      [
        operation.type, operation.table_name, operation.entity_id,
        JSON.stringify(operation.data), operation.idempotency_key,
        operation.origin_device_id, operation.priority
      ]
    );
    
    if (result.rowCount === 0) {
      log('✓ Idempotency working: Duplicate prevented', 'success');
    } else {
      log('✗ Idempotency failed: Duplicate inserted', 'error');
    }
    
    // Cleanup
    await pool.query(
      `DELETE FROM offline_queue WHERE idempotency_key = $1`,
      [idempotencyKey]
    );
    
  } catch (error) {
    log(`✗ Idempotency test error: ${error.message}`, 'error');
  }
}

async function testPriorityOrdering() {
  log('\n=== Testing Priority Ordering ===', 'info');
  
  const operations = [
    generateTestOperation({ priority: 0, entity_id: 'low-priority' }),
    generateTestOperation({ priority: 10, entity_id: 'high-priority' }),
    generateTestOperation({ priority: 5, entity_id: 'medium-priority' })
  ];
  
  try {
    // Insert operations with different priorities
    for (const op of operations) {
      await pool.query(
        `INSERT INTO offline_queue (
          type, table_name, entity_id, data, idempotency_key,
          priority, status, created_at
        ) VALUES ($1, $2, $3, $4::jsonb, $5, $6, 'pending', NOW())`,
        [op.type, op.table_name, op.entity_id, JSON.stringify(op.data), 
         op.idempotency_key, op.priority]
      );
    }
    
    // Query with priority ordering
    const result = await pool.query(
      `SELECT entity_id, priority FROM offline_queue 
       WHERE entity_id IN ('low-priority', 'high-priority', 'medium-priority')
       ORDER BY priority DESC, created_at ASC`
    );
    
    const order = result.rows.map(r => r.entity_id);
    const expected = ['high-priority', 'medium-priority', 'low-priority'];
    
    if (JSON.stringify(order) === JSON.stringify(expected)) {
      log('✓ Priority ordering correct: ' + order.join(' → '), 'success');
    } else {
      log('✗ Priority ordering incorrect: ' + order.join(' → '), 'error');
    }
    
    // Cleanup
    await pool.query(
      `DELETE FROM offline_queue WHERE entity_id IN ($1, $2, $3)`,
      ['low-priority', 'high-priority', 'medium-priority']
    );
    
  } catch (error) {
    log(`✗ Priority test error: ${error.message}`, 'error');
  }
}

async function testTTLExpiration() {
  log('\n=== Testing TTL Expiration ===', 'info');
  
  try {
    // Insert operation that's already expired
    const expiredOp = generateTestOperation({
      entity_id: 'expired-op',
      expires_at: new Date(Date.now() - 1000).toISOString() // 1 second ago
    });
    
    await pool.query(
      `INSERT INTO offline_queue (
        type, table_name, entity_id, data, idempotency_key,
        expires_at, status, created_at
      ) VALUES ($1, $2, $3, $4::jsonb, $5, $6::timestamptz, 'pending', NOW())`,
      [expiredOp.type, expiredOp.table_name, expiredOp.entity_id,
       JSON.stringify(expiredOp.data), expiredOp.idempotency_key, expiredOp.expires_at]
    );
    
    // Run expiration check
    const expireResult = await pool.query(
      `UPDATE offline_queue 
       SET status = 'failed', error_message = 'Operation expired'
       WHERE status = 'pending' 
         AND expires_at IS NOT NULL 
         AND expires_at < NOW()
         AND entity_id = $1
       RETURNING id`,
      ['expired-op']
    );
    
    if (expireResult.rowCount > 0) {
      log('✓ TTL expiration working: Expired operation marked as failed', 'success');
    } else {
      log('✗ TTL expiration failed', 'error');
    }
    
    // Cleanup
    await pool.query(
      `DELETE FROM offline_queue WHERE entity_id = $1`,
      ['expired-op']
    );
    
  } catch (error) {
    log(`✗ TTL test error: ${error.message}`, 'error');
  }
}

async function testDeadLetter() {
  log('\n=== Testing Dead Letter Queue ===', 'info');
  
  try {
    // Insert operation with max retries
    const failedOp = generateTestOperation({
      entity_id: 'dead-letter-test',
      retry_count: 5
    });
    
    await pool.query(
      `INSERT INTO offline_queue (
        type, table_name, entity_id, data, idempotency_key,
        status, retry_count, error_message, created_at
      ) VALUES ($1, $2, $3, $4::jsonb, $5, 'failed', $6, 'Test failure', NOW())`,
      [failedOp.type, failedOp.table_name, failedOp.entity_id,
       JSON.stringify(failedOp.data), failedOp.idempotency_key, failedOp.retry_count]
    );
    
    // Move to dead letter
    const moveResult = await pool.query(
      `WITH to_move AS (
        SELECT * FROM offline_queue 
        WHERE entity_id = $1 AND retry_count >= 5
      )
      INSERT INTO offline_dead_letter (
        queue_id, idempotency_key, type, table_name, entity_id, 
        data, error_message, retry_count
      )
      SELECT 
        id, idempotency_key, type, table_name, entity_id,
        data, error_message, retry_count
      FROM to_move
      RETURNING id`,
      ['dead-letter-test']
    );
    
    if (moveResult.rowCount > 0) {
      log('✓ Dead letter queue working: Failed operation moved', 'success');
      
      // Cleanup dead letter
      await pool.query(
        `DELETE FROM offline_dead_letter WHERE entity_id = $1`,
        ['dead-letter-test']
      );
    } else {
      log('✗ Dead letter queue failed', 'error');
    }
    
    // Cleanup
    await pool.query(
      `DELETE FROM offline_queue WHERE entity_id = $1`,
      ['dead-letter-test']
    );
    
  } catch (error) {
    log(`✗ Dead letter test error: ${error.message}`, 'error');
  }
}

async function testDependencies() {
  log('\n=== Testing Operation Dependencies ===', 'info');
  
  try {
    // Create parent operation
    const parentId = crypto.randomUUID();
    const parentOp = generateTestOperation({
      entity_id: parentId,
      idempotency_key: parentId
    });
    
    // Create dependent operation
    const childOp = generateTestOperation({
      entity_id: 'child-op',
      depends_on: [parentId]
    });
    
    // Insert both operations
    await pool.query(
      `INSERT INTO offline_queue (
        id, type, table_name, entity_id, data, idempotency_key,
        status, created_at
      ) VALUES ($1, $2, $3, $4, $5::jsonb, $6, 'pending', NOW())`,
      [parentId, parentOp.type, parentOp.table_name, parentOp.entity_id,
       JSON.stringify(parentOp.data), parentOp.idempotency_key]
    );
    
    await pool.query(
      `INSERT INTO offline_queue (
        type, table_name, entity_id, data, idempotency_key,
        depends_on, status, created_at
      ) VALUES ($1, $2, $3, $4::jsonb, $5, $6, 'pending', NOW())`,
      [childOp.type, childOp.table_name, childOp.entity_id,
       JSON.stringify(childOp.data), childOp.idempotency_key, childOp.depends_on]
    );
    
    // Check if child is blocked
    const blockedResult = await pool.query(
      `SELECT id FROM offline_queue
       WHERE status = 'pending'
         AND entity_id = 'child-op'
         AND EXISTS (
           SELECT 1 FROM unnest(depends_on) dep_id
           WHERE dep_id::text IN (
             SELECT id::text FROM offline_queue WHERE status = 'pending'
           )
         )`
    );
    
    if (blockedResult.rowCount > 0) {
      log('✓ Dependencies working: Child operation blocked by parent', 'success');
    } else {
      log('✗ Dependencies not working', 'error');
    }
    
    // Cleanup
    await pool.query(
      `DELETE FROM offline_queue WHERE entity_id IN ($1, $2)`,
      [parentId, 'child-op']
    );
    
  } catch (error) {
    log(`✗ Dependencies test error: ${error.message}`, 'error');
  }
}

async function testQueueStatistics() {
  log('\n=== Testing Queue Statistics ===', 'info');
  
  try {
    // Get queue statistics
    const statsResult = await pool.query(
      `SELECT 
        status,
        COUNT(*) as count,
        AVG(retry_count) as avg_retries
      FROM offline_queue
      GROUP BY status`
    );
    
    log('Queue Statistics:', 'info');
    statsResult.rows.forEach(row => {
      log(`  ${row.status}: ${row.count} operations (avg retries: ${parseFloat(row.avg_retries || 0).toFixed(2)})`, 'info');
    });
    
    // Get dead letter statistics
    const deadLetterResult = await pool.query(
      `SELECT COUNT(*) as count FROM offline_dead_letter WHERE archived = false`
    );
    
    log(`  Dead Letter: ${deadLetterResult.rows[0].count} operations`, 'info');
    
    log('✓ Statistics retrieved successfully', 'success');
    
  } catch (error) {
    log(`✗ Statistics test error: ${error.message}`, 'error');
  }
}

// Main test runner
async function runAllTests() {
  log('=====================================', 'info');
  log('Queue Reliability Test Suite', 'info');
  log('=====================================', 'info');
  
  try {
    await testIdempotency();
    await testPriorityOrdering();
    await testTTLExpiration();
    await testDeadLetter();
    await testDependencies();
    await testQueueStatistics();
    
    log('\n=====================================', 'info');
    log('All tests completed!', 'success');
    log('=====================================', 'info');
    
  } catch (error) {
    log(`\nTest suite error: ${error.message}`, 'error');
  } finally {
    await pool.end();
  }
}

// Run tests
runAllTests().catch(console.error);