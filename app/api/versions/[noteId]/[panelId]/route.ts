import { NextRequest, NextResponse } from 'next/server'
import { Pool } from 'pg'
import crypto from 'crypto'

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/annotation_dev'
})

// GET /api/versions/[noteId]/[panelId] - Get all versions
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ noteId: string; panelId: string }> }
) {
  const { noteId, panelId } = await params
  const { searchParams } = new URL(request.url)
  const limit = parseInt(searchParams.get('limit') || '50')
  const offset = parseInt(searchParams.get('offset') || '0')
  const version = searchParams.get('version')
  
  try {
    // If specific version requested
    if (version) {
      const result = await pool.query(
        `SELECT 
          id, note_id, panel_id, content, version,
          document_text,
          created_at
        FROM document_saves
        WHERE note_id = $1 AND panel_id = $2 AND version = $3`,
        [noteId, panelId, parseInt(version)]
      )
      
      if (result.rows.length === 0) {
        return NextResponse.json(
          { error: 'Version not found' },
          { status: 404 }
        )
      }
      
      // Calculate content hash for conflict detection
      const content = result.rows[0].content
      const contentHash = crypto
        .createHash('sha256')
        .update(JSON.stringify(content))
        .digest('hex')
      
      return NextResponse.json({
        ...result.rows[0],
        content_hash: contentHash
      })
    }
    
    // Get all versions with metadata
    const versionsResult = await pool.query(
      `SELECT 
        id, version, 
        pg_column_size(content::text) as size_bytes,
        created_at,
        CASE 
          WHEN version = (SELECT MAX(version) FROM document_saves WHERE note_id = $1 AND panel_id = $2)
          THEN true 
          ELSE false 
        END as is_current
      FROM document_saves
      WHERE note_id = $1 AND panel_id = $2
      ORDER BY version DESC
      LIMIT $3 OFFSET $4`,
      [noteId, panelId, limit, offset]
    )
    
    // Get total count
    const countResult = await pool.query(
      `SELECT COUNT(*) as total FROM document_saves 
       WHERE note_id = $1 AND panel_id = $2`,
      [noteId, panelId]
    )
    
    // Get current version details
    const currentResult = await pool.query(
      `SELECT version, content, created_at
       FROM document_saves
       WHERE note_id = $1 AND panel_id = $2
       ORDER BY version DESC
       LIMIT 1`,
      [noteId, panelId]
    )
    
    const currentVersion = currentResult.rows[0]
    const currentHash = currentVersion ? 
      crypto.createHash('sha256')
        .update(JSON.stringify(currentVersion.content))
        .digest('hex') : null
    
    return NextResponse.json({
      noteId,
      panelId,
      versions: versionsResult.rows,
      total: parseInt(countResult.rows[0].total),
      current: currentVersion ? {
        version: currentVersion.version,
        hash: currentHash,
        created_at: currentVersion.created_at
      } : null,
      limit,
      offset
    })
  } catch (error) {
    console.error('Failed to fetch versions:', error)
    return NextResponse.json(
      { error: 'Failed to fetch versions', details: String(error) },
      { status: 500 }
    )
  }
}

// POST /api/versions/[noteId]/[panelId] - Restore a version or save new version
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ noteId: string; panelId: string }> }
) {
  const { noteId, panelId } = await params
  
  try {
    const body = await request.json()
    const { 
      action, 
      version, 
      content,
      base_version,
      base_hash,
      force = false 
    } = body
    
    if (action === 'restore') {
      // Restore a specific version
      if (!version) {
        return NextResponse.json(
          { error: 'Version number required for restore' },
          { status: 400 }
        )
      }
      
      // Get the version to restore
      const versionResult = await pool.query(
        `SELECT content FROM document_saves
         WHERE note_id = $1 AND panel_id = $2 AND version = $3`,
        [noteId, panelId, version]
      )
      
      if (versionResult.rows.length === 0) {
        return NextResponse.json(
          { error: 'Version not found' },
          { status: 404 }
        )
      }
      
      // Get next version number
      const nextVersionResult = await pool.query(
        `SELECT COALESCE(MAX(version), 0) + 1 as next_version
         FROM document_saves
         WHERE note_id = $1 AND panel_id = $2`,
        [noteId, panelId]
      )
      
      const nextVersion = nextVersionResult.rows[0].next_version
      const restoredContent = versionResult.rows[0].content
      
      // Create new version with restored content
      const insertResult = await pool.query(
        `INSERT INTO document_saves 
         (note_id, panel_id, content, version, created_at)
         VALUES ($1, $2, $3::jsonb, $4, NOW())
         RETURNING *`,
        [noteId, panelId, JSON.stringify(restoredContent), nextVersion]
      )
      
      return NextResponse.json({
        success: true,
        action: 'restored',
        restored_from: version,
        new_version: nextVersion,
        data: insertResult.rows[0]
      })
      
    } else if (action === 'save') {
      // Save new version with conflict detection
      if (!content) {
        return NextResponse.json(
          { error: 'Content required for save' },
          { status: 400 }
        )
      }
      
      // Check for conflicts if base_version provided
      if (base_version !== undefined && !force) {
        const currentResult = await pool.query(
          `SELECT version, content FROM document_saves
           WHERE note_id = $1 AND panel_id = $2
           ORDER BY version DESC
           LIMIT 1`,
          [noteId, panelId]
        )
        
        if (currentResult.rows.length > 0) {
          const current = currentResult.rows[0]
          
          // Version mismatch - conflict detected
          if (current.version !== base_version) {
            const currentHash = crypto
              .createHash('sha256')
              .update(JSON.stringify(current.content))
              .digest('hex')
            
            return NextResponse.json({
              success: false,
              conflict: true,
              conflict_type: 'version_mismatch',
              base_version,
              current_version: current.version,
              current_hash: currentHash,
              message: 'Document has been modified since your last save'
            }, { status: 409 })
          }
          
          // Hash mismatch - content drift detected
          if (base_hash) {
            const currentHash = crypto
              .createHash('sha256')
              .update(JSON.stringify(current.content))
              .digest('hex')
            
            if (currentHash !== base_hash) {
              return NextResponse.json({
                success: false,
                conflict: true,
                conflict_type: 'content_drift',
                base_hash,
                current_hash: currentHash,
                message: 'Document content has changed unexpectedly'
              }, { status: 409 })
            }
          }
        }
      }
      
      // Get next version number
      const nextVersionResult = await pool.query(
        `SELECT COALESCE(MAX(version), 0) + 1 as next_version
         FROM document_saves
         WHERE note_id = $1 AND panel_id = $2`,
        [noteId, panelId]
      )
      
      const nextVersion = nextVersionResult.rows[0].next_version
      
      // Save new version
      const insertResult = await pool.query(
        `INSERT INTO document_saves 
         (note_id, panel_id, content, version, created_at)
         VALUES ($1, $2, $3::jsonb, $4, NOW())
         RETURNING *`,
        [noteId, panelId, JSON.stringify(content), nextVersion]
      )
      
      const newHash = crypto
        .createHash('sha256')
        .update(JSON.stringify(content))
        .digest('hex')
      
      return NextResponse.json({
        success: true,
        action: 'saved',
        version: nextVersion,
        hash: newHash,
        data: insertResult.rows[0]
      })
    } else {
      return NextResponse.json(
        { error: 'Invalid action. Use "restore" or "save"' },
        { status: 400 }
      )
    }
  } catch (error) {
    console.error('Version operation failed:', error)
    return NextResponse.json(
      { error: 'Version operation failed', details: String(error) },
      { status: 500 }
    )
  }
}

// DELETE /api/versions/[noteId]/[panelId] - Delete old versions
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ noteId: string; panelId: string }> }
) {
  const { noteId, panelId } = await params
  const { searchParams } = new URL(request.url)
  const keepLast = parseInt(searchParams.get('keep') || '10')
  
  try {
    // Delete old versions, keeping the most recent N
    const result = await pool.query(
      `DELETE FROM document_saves
       WHERE note_id = $1 AND panel_id = $2
         AND version < (
           SELECT version FROM document_saves
           WHERE note_id = $1 AND panel_id = $2
           ORDER BY version DESC
           LIMIT 1 OFFSET $3
         )
       RETURNING id, version`,
      [noteId, panelId, keepLast - 1]
    )
    
    return NextResponse.json({
      success: true,
      deleted: result.rowCount,
      versions: result.rows.map(r => r.version)
    })
  } catch (error) {
    console.error('Failed to delete versions:', error)
    return NextResponse.json(
      { error: 'Failed to delete versions', details: String(error) },
      { status: 500 }
    )
  }
}