import { NextRequest, NextResponse } from 'next/server'
import { Pool } from 'pg'
import crypto from 'crypto'

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/annotation_dev'
})

// GET /api/offline-queue/export - Export offline queue as package
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const status = searchParams.get('status') || 'pending'
  const includeMetadata = searchParams.get('metadata') === 'true'
  
  try {
    // Fetch queue items
    const result = await pool.query(
      `SELECT 
        id, type, table_name, entity_id, data,
        idempotency_key, origin_device_id, schema_version,
        priority, expires_at, group_id, depends_on,
        status, retry_count, error_message,
        created_at, updated_at
      FROM offline_queue
      WHERE status = $1
      ORDER BY priority DESC, created_at ASC`,
      [status]
    )
    
    // Create export package
    const exportPackage = {
      version: 2,
      exported_at: new Date().toISOString(),
      source: 'web',
      metadata: {
        total_operations: result.rowCount,
        status_filter: status,
        export_id: crypto.randomUUID()
      },
      operations: result.rows.map(row => ({
        // Core operation data
        type: row.type,
        table_name: row.table_name,
        entity_id: row.entity_id,
        data: row.data,
        
        // Operation envelope
        idempotency_key: row.idempotency_key || crypto.randomUUID(),
        origin_device_id: row.origin_device_id || 'web-export',
        schema_version: row.schema_version || 1,
        
        // Scheduling metadata
        priority: row.priority || 0,
        expires_at: row.expires_at,
        group_id: row.group_id,
        depends_on: row.depends_on,
        
        // Status info
        retry_count: row.retry_count || 0,
        error_message: row.error_message,
        original_created_at: row.created_at,
        original_updated_at: row.updated_at
      }))
    }
    
    // Add additional metadata if requested
    if (includeMetadata) {
      // Get statistics
      const statsResult = await pool.query(
        `SELECT 
          status,
          COUNT(*) as count,
          AVG(retry_count) as avg_retries,
          MAX(retry_count) as max_retries
        FROM offline_queue
        GROUP BY status`
      )
      
      exportPackage.metadata.statistics = statsResult.rows
      
      // Get dead letter count
      const deadLetterResult = await pool.query(
        `SELECT COUNT(*) as count FROM offline_dead_letter WHERE archived = false`
      )
      
      exportPackage.metadata.dead_letter_count = parseInt(deadLetterResult.rows[0]?.count || '0')
    }
    
    // Calculate checksum for integrity
    const checksum = crypto
      .createHash('sha256')
      .update(JSON.stringify(exportPackage.operations))
      .digest('hex')
    
    exportPackage.metadata.checksum = checksum
    
    // Return as downloadable JSON
    return new NextResponse(JSON.stringify(exportPackage, null, 2), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="offline-queue-${status}-${Date.now()}.json"`
      }
    })
  } catch (error) {
    console.error('Failed to export offline queue:', error)
    return NextResponse.json(
      { error: 'Failed to export offline queue', details: String(error) },
      { status: 500 }
    )
  }
}

// POST /api/offline-queue/export - Export specific operations
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { operation_ids, filters = {} } = body
    
    let query = `
      SELECT 
        id, type, table_name, entity_id, data,
        idempotency_key, origin_device_id, schema_version,
        priority, expires_at, group_id, depends_on,
        status, retry_count, error_message,
        created_at, updated_at
      FROM offline_queue
      WHERE 1=1
    `
    const params: any[] = []
    let paramIndex = 1
    
    // Filter by specific IDs
    if (operation_ids && Array.isArray(operation_ids) && operation_ids.length > 0) {
      query += ` AND id = ANY($${paramIndex}::uuid[])`
      params.push(operation_ids)
      paramIndex++
    }
    
    // Apply additional filters
    if (filters.status) {
      query += ` AND status = $${paramIndex}`
      params.push(filters.status)
      paramIndex++
    }
    
    if (filters.table_name) {
      query += ` AND table_name = $${paramIndex}`
      params.push(filters.table_name)
      paramIndex++
    }
    
    if (filters.date_from) {
      query += ` AND created_at >= $${paramIndex}`
      params.push(filters.date_from)
      paramIndex++
    }
    
    if (filters.date_to) {
      query += ` AND created_at <= $${paramIndex}`
      params.push(filters.date_to)
      paramIndex++
    }
    
    query += ` ORDER BY priority DESC, created_at ASC`
    
    const result = await pool.query(query, params)
    
    // Create export package
    const exportPackage = {
      version: 2,
      exported_at: new Date().toISOString(),
      source: 'web-selective',
      metadata: {
        total_operations: result.rowCount,
        filters,
        export_id: crypto.randomUUID()
      },
      operations: result.rows.map(row => ({
        type: row.type,
        table_name: row.table_name,
        entity_id: row.entity_id,
        data: row.data,
        idempotency_key: row.idempotency_key || crypto.randomUUID(),
        origin_device_id: row.origin_device_id || 'web-export',
        schema_version: row.schema_version || 1,
        priority: row.priority || 0,
        expires_at: row.expires_at,
        group_id: row.group_id,
        depends_on: row.depends_on,
        retry_count: row.retry_count || 0,
        error_message: row.error_message,
        original_created_at: row.created_at,
        original_updated_at: row.updated_at
      }))
    }
    
    // Calculate checksum
    const checksum = crypto
      .createHash('sha256')
      .update(JSON.stringify(exportPackage.operations))
      .digest('hex')
    
    exportPackage.metadata.checksum = checksum
    
    return NextResponse.json(exportPackage)
  } catch (error) {
    console.error('Failed to export selected operations:', error)
    return NextResponse.json(
      { error: 'Failed to export operations', details: String(error) },
      { status: 500 }
    )
  }
}