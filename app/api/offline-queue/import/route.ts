import { NextRequest, NextResponse } from 'next/server'
import { Pool } from 'pg'
import crypto from 'crypto'

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/annotation_dev'
})

// POST /api/offline-queue/import - Import offline queue package
export async function POST(request: NextRequest) {
  const client = await pool.connect()
  
  try {
    // Minimal auth guard
    const adminKey = process.env.ADMIN_API_KEY
    const providedKey = request.headers.get('x-admin-key') || ''
    if (adminKey && providedKey !== adminKey) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    
    const body = await request.json()
    const { 
      version,
      operations,
      metadata,
      checksum, // Accept checksum at top level too
      validate_only = false,
      skip_duplicates = true,
      override_priority = null
    } = body
    
    // Validate package version
    if (version !== 2 && version !== 1) {
      return NextResponse.json(
        { error: 'Unsupported package version', supported: [1, 2] },
        { status: 400 }
      )
    }
    
    // Validate checksum if provided (accept at top level or in metadata)
    const providedChecksum = checksum || metadata?.checksum
    if (providedChecksum) {
      const calculatedChecksum = crypto
        .createHash('sha256')
        .update(JSON.stringify(operations))
        .digest('hex')
      
      if (calculatedChecksum !== providedChecksum) {
        return NextResponse.json(
          { error: 'Checksum mismatch - package may be corrupted', 
            expected: providedChecksum, 
            calculated: calculatedChecksum },
          { status: 400 }
        )
      }
    }
    
    // Validate operations
    if (!Array.isArray(operations) || operations.length === 0) {
      return NextResponse.json(
        { error: 'No operations to import' },
        { status: 400 }
      )
    }
    
    // Validation only mode
    if (validate_only) {
      const validation = await validateOperations(operations)
      return NextResponse.json({
        valid: validation.valid,
        errors: validation.errors,
        warnings: validation.warnings,
        summary: validation.summary
      })
    }
    
    // Begin transaction
    await client.query('BEGIN')
    
    const results = {
      imported: 0,
      skipped: 0,
      failed: 0,
      errors: [] as any[]
    }
    
    // Process each operation
    for (const op of operations) {
      try {
        // Generate idempotency key if missing
        const idempotency_key = op.idempotency_key || crypto.randomUUID()
        
        // Check for duplicates
        if (skip_duplicates) {
          const existing = await client.query(
            `SELECT id FROM offline_queue WHERE idempotency_key = $1`,
            [idempotency_key]
          )
          
          if (existing.rows.length > 0) {
            results.skipped++
            continue
          }
        }
        
        // Prepare values
        const type = op.type || op.operation
        const table_name = op.table_name || op.entity_type
        const entity_id = op.entity_id || op.entityId
        const data = op.data || op.payload
        const origin_device_id = op.origin_device_id || metadata?.source || 'import'
        const schema_version = op.schema_version || 1
        const priority = override_priority !== null ? override_priority : (op.priority || 0)
        const expires_at = op.expires_at || null
        const group_id = op.group_id || null
        const depends_on = op.depends_on || null
        
        // Validate required fields
        if (!type || !table_name || !entity_id || !data) {
          results.failed++
          results.errors.push({
            operation: op,
            error: 'Missing required fields'
          })
          continue
        }
        
        // Insert into queue
        await client.query(
          `INSERT INTO offline_queue (
            type, table_name, entity_id, data,
            idempotency_key, origin_device_id, schema_version,
            priority, expires_at, group_id, depends_on,
            status, created_at, updated_at
          ) VALUES (
            $1, $2, $3, $4::jsonb,
            $5, $6, $7,
            $8, $9, $10, $11,
            'pending', COALESCE($12::timestamptz, NOW()), NOW()
          )`,
          [
            type, table_name, entity_id, JSON.stringify(data),
            idempotency_key, origin_device_id, schema_version,
            priority, expires_at, group_id, depends_on,
            op.original_created_at
          ]
        )
        
        results.imported++
      } catch (error) {
        results.failed++
        results.errors.push({
          operation: op,
          error: String(error)
        })
        
        // Continue processing other operations
        console.error('Failed to import operation:', error)
      }
    }
    
    // Commit transaction
    await client.query('COMMIT')
    
    // Log import activity
    console.log(`[offline-queue:import] Imported ${results.imported}, skipped ${results.skipped}, failed ${results.failed}`)
    
    return NextResponse.json({
      success: true,
      results,
      metadata: {
        import_id: crypto.randomUUID(),
        imported_at: new Date().toISOString(),
        package_id: metadata?.export_id
      }
    })
    
  } catch (error) {
    await client.query('ROLLBACK')
    console.error('Import failed:', error)
    return NextResponse.json(
      { error: 'Import failed', details: String(error) },
      { status: 500 }
    )
  } finally {
    client.release()
  }
}

// Validate operations before import
async function validateOperations(operations: any[]) {
  const validation = {
    valid: true,
    errors: [] as any[],
    warnings: [] as any[],
    summary: {
      total: operations.length,
      valid: 0,
      invalid: 0,
      duplicates: 0
    }
  }
  
  // Check for existing idempotency keys
  const idempotencyKeys = operations
    .map(op => op.idempotency_key)
    .filter(key => key)
  
  if (idempotencyKeys.length > 0) {
    const existing = await pool.query(
      `SELECT idempotency_key FROM offline_queue 
       WHERE idempotency_key = ANY($1::text[])`,
      [idempotencyKeys]
    )
    
    const existingKeys = new Set(existing.rows.map(r => r.idempotency_key))
    validation.summary.duplicates = existingKeys.size
    
    if (existingKeys.size > 0) {
      validation.warnings.push({
        type: 'duplicates',
        message: `${existingKeys.size} operations already exist in queue`,
        keys: Array.from(existingKeys)
      })
    }
  }
  
  // Validate each operation
  for (let i = 0; i < operations.length; i++) {
    const op = operations[i]
    const errors = []
    
    // Check required fields
    if (!op.type && !op.operation) {
      errors.push('Missing operation type')
    }
    if (!op.table_name && !op.entity_type) {
      errors.push('Missing table name')
    }
    if (!op.entity_id && !op.entityId) {
      errors.push('Missing entity ID')
    }
    if (!op.data && !op.payload) {
      errors.push('Missing operation data')
    }
    
    // Check data types
    if (op.priority !== undefined && typeof op.priority !== 'number') {
      errors.push('Priority must be a number')
    }
    if (op.schema_version !== undefined && typeof op.schema_version !== 'number') {
      errors.push('Schema version must be a number')
    }
    
    // Check dates
    if (op.expires_at) {
      const expiresDate = new Date(op.expires_at)
      if (isNaN(expiresDate.getTime())) {
        errors.push('Invalid expires_at date')
      } else if (expiresDate < new Date()) {
        validation.warnings.push({
          type: 'expired',
          index: i,
          message: 'Operation has already expired'
        })
      }
    }
    
    if (errors.length > 0) {
      validation.errors.push({
        index: i,
        errors,
        operation: op
      })
      validation.summary.invalid++
      validation.valid = false
    } else {
      validation.summary.valid++
    }
  }
  
  return validation
}

// GET /api/offline-queue/import - Get import status/history
export async function GET(request: NextRequest) {
  try {
    // This could be extended to track import history in a separate table
    // For now, return current queue status
    const result = await pool.query(
      `SELECT 
        origin_device_id,
        COUNT(*) as count,
        MIN(created_at) as first_imported,
        MAX(created_at) as last_imported
      FROM offline_queue
      WHERE origin_device_id LIKE '%import%' OR origin_device_id LIKE '%export%'
      GROUP BY origin_device_id
      ORDER BY MAX(created_at) DESC
      LIMIT 10`
    )
    
    return NextResponse.json({
      recent_imports: result.rows,
      timestamp: new Date().toISOString()
    })
  } catch (error) {
    console.error('Failed to get import status:', error)
    return NextResponse.json(
      { error: 'Failed to get import status', details: String(error) },
      { status: 500 }
    )
  }
}