import { NextRequest, NextResponse } from 'next/server'
import { Pool } from 'pg'

// Create connection pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/annotation_dev'
})

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const query = searchParams.get('q')
  const type = searchParams.get('type') || 'all'
  const limit = parseInt(searchParams.get('limit') || '20')
  const offset = parseInt(searchParams.get('offset') || '0')
  
  if (!query || query.trim().length === 0) {
    return NextResponse.json({ error: 'Query parameter is required' }, { status: 400 })
  }
  
  try {
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
          COALESCE(content::text, '') as content,
          ts_rank(search_vector, ${tsquery}) as rank,
          ts_headline(
            'english', 
            COALESCE(content::text, ''), 
            ${tsquery}, 
            'StartSel=<mark>, StopSel=</mark>, MaxWords=30, MinWords=15'
          ) as excerpt,
          created_at,
          updated_at
        FROM notes
        WHERE search_vector @@ ${tsquery}
        ORDER BY rank DESC, updated_at DESC
        LIMIT $2 OFFSET $3`,
        [query, limit, offset]
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
          ts_rank(ds.search_vector, ${tsquery}) as rank,
          ts_headline(
            'english', 
            COALESCE(ds.document_text, ''), 
            ${tsquery},
            'StartSel=<mark>, StopSel=</mark>, MaxWords=30, MinWords=15'
          ) as excerpt,
          ds.created_at,
          ds.updated_at
        FROM document_saves ds
        LEFT JOIN notes n ON ds.note_id = n.id
        WHERE ds.search_vector @@ ${tsquery}
        ORDER BY rank DESC, ds.updated_at DESC
        LIMIT $2 OFFSET $3`,
        [query, limit, offset]
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
          b.created_at,
          b.updated_at
        FROM branches b
        LEFT JOIN notes n ON b.note_id = n.id
        WHERE to_tsvector('english', COALESCE(b.original_text, '')) @@ ${tsquery}
        ORDER BY rank DESC, b.updated_at DESC
        LIMIT $2 OFFSET $3`,
        [query, limit, offset]
      )
      
      results.results.branches = {
        items: branchesResult.rows,
        count: branchesResult.rowCount
      }
    }
    
    // Fuzzy search using trigrams for better typo tolerance
    if (type === 'fuzzy') {
      const fuzzyResult = await pool.query(
        `SELECT 
          ds.id,
          ds.note_id,
          ds.panel_id,
          n.title as note_title,
          similarity(ds.document_text, $1) as similarity,
          SUBSTRING(ds.document_text, 1, 200) as excerpt,
          ds.created_at,
          ds.updated_at
        FROM document_saves ds
        LEFT JOIN notes n ON ds.note_id = n.id
        WHERE ds.document_text % $1
        ORDER BY similarity DESC
        LIMIT $2 OFFSET $3`,
        [query, limit, offset]
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
    
    if (!query || query.trim().length === 0) {
      return NextResponse.json({ error: 'Query is required' }, { status: 400 })
    }
    
    // Build dynamic query based on filters
    let whereClause = 'WHERE search_vector @@ plainto_tsquery($1)'
    const params = [query]
    let paramIndex = 2
    
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
        created_at,
        updated_at
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