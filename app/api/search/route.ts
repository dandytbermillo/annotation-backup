import { NextRequest, NextResponse } from 'next/server'
import { serverPool } from '@/lib/db/pool'
import { WorkspaceStore } from '@/lib/workspace/workspace-store'

const pool = serverPool

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const query = searchParams.get('q')
  let type = searchParams.get('type') || 'all'
  const fuzzy = searchParams.get('fuzzy') === 'true'
  const limit = parseInt(searchParams.get('limit') || '20')
  const offset = parseInt(searchParams.get('offset') || '0')
  
  // Handle fuzzy parameter as alias for type=fuzzy
  if (fuzzy && type === 'all') {
    type = 'fuzzy'
  }
  
  if (!query || query.trim().length === 0) {
    return NextResponse.json({ error: 'Query parameter is required' }, { status: 400 })
  }
  
  try {
    let workspaceId: string
    try {
      workspaceId = await WorkspaceStore.getDefaultWorkspaceId(pool)
    } catch (error) {
      console.error('[search GET] Failed to resolve workspace:', error)
      return NextResponse.json({ error: 'Failed to resolve workspace' }, { status: 500 })
    }

    const results: any = {
      query,
      type,
      results: {}
    }
    
    // Prepare the search query for PostgreSQL full-text search
    const tsquery = `plainto_tsquery('english', $1)`
    
    // Search in notes
    if (type === 'all' || type === 'notes') {
      const notesResult = await pool.query(
        `SELECT 
          id, 
          title, 
          COALESCE(content_text, '') as content,
          ts_rank(search_vector, ${tsquery}) as rank,
          ts_headline(
            'english', 
            COALESCE(content_text, title, ''), 
            ${tsquery}, 
            'StartSel=<mark>, StopSel=</mark>, MaxWords=30, MinWords=15'
          ) as excerpt,
          created_at
        FROM notes
        WHERE workspace_id = $4
          AND deleted_at IS NULL
          AND (search_vector @@ ${tsquery}
           OR title ILIKE '%' || $1 || '%')
        ORDER BY rank DESC, created_at DESC
        LIMIT $2 OFFSET $3`,
        [query, limit, offset, workspaceId]
      )
      
      results.results.notes = {
        items: notesResult.rows,
        count: notesResult.rowCount
      }
    }
    
    // Search in document_saves (editor content)
    if (type === 'all' || type === 'documents') {
      const documentsResult = await pool.query(
        `SELECT 
          ds.id,
          ds.note_id,
          ds.panel_id,
          ds.version,
          n.title as note_title,
          ts_rank(to_tsvector('english', COALESCE(ds.document_text, '')), ${tsquery}) as rank,
          ts_headline(
            'english', 
            COALESCE(ds.document_text, ''), 
            ${tsquery},
            'StartSel=<mark>, StopSel=</mark>, MaxWords=30, MinWords=15'
          ) as excerpt,
          ds.created_at
        FROM document_saves ds
        LEFT JOIN notes n ON ds.note_id = n.id
        WHERE ds.workspace_id = $4
          AND to_tsvector('english', COALESCE(ds.document_text, '')) @@ ${tsquery}
          AND n.deleted_at IS NULL
        ORDER BY rank DESC, ds.created_at DESC
        LIMIT $2 OFFSET $3`,
        [query, limit, offset, workspaceId]
      )
      
      results.results.documents = {
        items: documentsResult.rows,
        count: documentsResult.rowCount
      }
    }
    
    // Search in branches (annotations)
    if (type === 'all' || type === 'branches') {
      const branchesResult = await pool.query(
        `SELECT 
          b.id,
          b.note_id,
          b.type,
          b.original_text,
          n.title as note_title,
          ts_rank(
            to_tsvector('english', COALESCE(b.original_text, '')), 
            ${tsquery}
          ) as rank,
          ts_headline(
            'english', 
            COALESCE(b.original_text, ''), 
            ${tsquery},
            'StartSel=<mark>, StopSel=</mark>, MaxWords=30, MinWords=15'
          ) as excerpt,
          b.created_at
        FROM branches b
        LEFT JOIN notes n ON b.note_id = n.id
        WHERE b.workspace_id = $4
          AND b.deleted_at IS NULL
          AND n.deleted_at IS NULL
          AND to_tsvector('english', COALESCE(b.original_text, '')) @@ ${tsquery}
        ORDER BY rank DESC, b.created_at DESC
        LIMIT $2 OFFSET $3`,
        [query, limit, offset, workspaceId]
      )
      
      results.results.branches = {
        items: branchesResult.rows,
        count: branchesResult.rowCount
      }
    }
    
    // Fuzzy search using trigrams for better typo tolerance
    if (type === 'fuzzy') {
      // Set session threshold for trigram similarity to stabilize results
      const raw = searchParams.get('similarity')
      let threshold = Number(raw)
      if (!Number.isFinite(threshold)) threshold = 0.45
      threshold = Math.min(1, Math.max(0, threshold))
      await pool.query('SELECT set_limit($1)', [threshold])
      
      const fuzzyResult = await pool.query(
        `SELECT 
          ds.id,
          ds.note_id,
          ds.panel_id,
          n.title as note_title,
          similarity(ds.document_text, $1) as similarity,
          SUBSTRING(ds.document_text, 1, 200) as excerpt,
          ds.created_at
        FROM document_saves ds
        LEFT JOIN notes n ON ds.note_id = n.id
        WHERE ds.workspace_id = $4
          AND ds.document_text % $1
          AND n.deleted_at IS NULL
        ORDER BY similarity DESC
        LIMIT $2 OFFSET $3`,
        [query, limit, offset, workspaceId]
      )
      
      results.results.fuzzy = {
        items: fuzzyResult.rows,
        count: fuzzyResult.rowCount
      }
    }
    
    // Calculate total results
    let totalCount = 0
    for (const key in results.results) {
      totalCount += results.results[key].count || 0
    }
    results.totalCount = totalCount
    
    // Also add fuzzy flag if it was a fuzzy search
    if (type === 'fuzzy') {
      results.fuzzy = true
    }
    
    return NextResponse.json(results)
  } catch (error) {
    console.error('Search error:', error)
    return NextResponse.json(
      { error: 'Failed to perform search', details: String(error) },
      { status: 500 }
    )
  }
}

// POST endpoint for advanced search with filters
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const {
      query,
      filters = {},
      sort = 'relevance',
      limit = 20,
      offset = 0
    } = body
    
    let workspaceId: string
    try {
      workspaceId = await WorkspaceStore.getDefaultWorkspaceId(pool)
    } catch (error) {
      console.error('[search POST] Failed to resolve workspace:', error)
      return NextResponse.json({ error: 'Failed to resolve workspace' }, { status: 500 })
    }

    // Build dynamic query based on filters
    let whereClause = 'WHERE workspace_id = $2 AND search_vector @@ plainto_tsquery($1)'
    const params = [query, workspaceId]
    let paramIndex = 3
    
    // Add date range filter
    if (filters.dateFrom) {
      whereClause += ` AND created_at >= $${paramIndex}`
      params.push(filters.dateFrom)
      paramIndex++
    }
    
    if (filters.dateTo) {
      whereClause += ` AND created_at <= $${paramIndex}`
      params.push(filters.dateTo)
      paramIndex++
    }
    
    // Add note filter
    if (filters.noteId) {
      whereClause += ` AND note_id = $${paramIndex}`
      params.push(filters.noteId)
      paramIndex++
    }
    
    // Determine sort order
    let orderClause = 'ORDER BY '
    switch (sort) {
      case 'date_asc':
        orderClause += 'created_at ASC'
        break
      case 'date_desc':
        orderClause += 'created_at DESC'
        break
      case 'relevance':
      default:
        orderClause += 'ts_rank(search_vector, plainto_tsquery($1)) DESC'
    }
    
    // Add pagination
    params.push(limit)
    params.push(offset)
    orderClause += ` LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`
    
    const result = await pool.query(
      `SELECT 
        id,
        note_id,
        panel_id,
        version,
        ts_rank(search_vector, plainto_tsquery($1)) as rank,
        ts_headline(
          'english',
          document_text,
          plainto_tsquery($1),
          'StartSel=<mark>, StopSel=</mark>, MaxWords=50, MinWords=20'
        ) as excerpt,
        created_at
      FROM document_saves
      ${whereClause}
      ${orderClause}`,
      params
    )
    
    // Get total count for pagination
    const countResult = await pool.query(
      `SELECT COUNT(*) as total
      FROM document_saves
      ${whereClause}`,
      params.slice(0, -2) // Exclude limit and offset
    )
    
    return NextResponse.json({
      query,
      filters,
      sort,
      results: result.rows,
      totalCount: parseInt(countResult.rows[0].total),
      limit,
      offset
    })
  } catch (error) {
    console.error('Advanced search error:', error)
    return NextResponse.json(
      { error: 'Failed to perform advanced search', details: String(error) },
      { status: 500 }
    )
  }
}
