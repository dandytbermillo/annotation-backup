import { NextRequest, NextResponse } from 'next/server'
import { Pool } from 'pg'
import { diffLines, diffWords } from 'diff'
import { v5 as uuidv5, validate as validateUuid } from 'uuid'

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/annotation_dev'
})

// Deterministic mapping for non-UUID IDs (slugs) → UUID
const ID_NAMESPACE = '7b6f9e76-0e6f-4a61-8c8b-0c5e583f2b1a'
const coerceEntityId = (id: string) => (validateUuid(id) ? id : uuidv5(id, ID_NAMESPACE))

// Helper to extract text from ProseMirror JSON
function extractTextFromProseMirror(content: any): string {
  if (!content) return ''
  
  let text = ''
  
  const traverse = (node: any) => {
    if (node.text) {
      text += node.text
    }
    if (node.content && Array.isArray(node.content)) {
      node.content.forEach(traverse)
    }
  }
  
  traverse(content)
  return text
}

// POST /api/versions/compare - Compare two versions
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { noteId, panelId, version1, version2, diffType = 'unified' } = body
    
    if (!noteId || !panelId || version1 === undefined || version2 === undefined) {
      return NextResponse.json(
        { error: 'noteId, panelId, version1, and version2 are required' },
        { status: 400 }
      )
    }
    
    // Coerce IDs to DB UUIDs (accept slugs or UUIDs)
    const noteKey = coerceEntityId(noteId)
    const panelKey = coerceEntityId(panelId)
    
    // Fetch both versions
    const [v1Result, v2Result] = await Promise.all([
      pool.query(
        `SELECT version, content, document_text, created_at
         FROM document_saves
         WHERE note_id = $1 AND panel_id = $2 AND version = $3`,
        [noteKey, panelKey, version1]
      ),
      pool.query(
        `SELECT version, content, document_text, created_at
         FROM document_saves
         WHERE note_id = $1 AND panel_id = $2 AND version = $3`,
        [noteKey, panelKey, version2]
      )
    ])
    
    if (v1Result.rows.length === 0 || v2Result.rows.length === 0) {
      return NextResponse.json(
        { error: 'One or both versions not found' },
        { status: 404 }
      )
    }
    
    const v1 = v1Result.rows[0]
    const v2 = v2Result.rows[0]
    
    // Extract text for comparison
    const text1 = v1.document_text || extractTextFromProseMirror(v1.content)
    const text2 = v2.document_text || extractTextFromProseMirror(v2.content)
    
    // Calculate different types of diffs
    let diff
    let stats = {
      additions: 0,
      deletions: 0,
      changes: 0
    }
    
    if (diffType === 'lines') {
      // Line-by-line diff
      const changes = diffLines(text1, text2)
      diff = changes
      
      changes.forEach(change => {
        if (change.added) stats.additions += change.count || 1
        if (change.removed) stats.deletions += change.count || 1
      })
      stats.changes = stats.additions + stats.deletions
      
    } else if (diffType === 'words') {
      // Word-by-word diff
      const changes = diffWords(text1, text2)
      diff = changes
      
      changes.forEach(change => {
        if (change.added) stats.additions += (change.value?.split(/\s+/).length || 0)
        if (change.removed) stats.deletions += (change.value?.split(/\s+/).length || 0)
      })
      stats.changes = stats.additions + stats.deletions
      
    } else {
      // Unified diff format (default)
      const lines1 = text1.split('\n')
      const lines2 = text2.split('\n')
      const maxLines = Math.max(lines1.length, lines2.length)
      
      diff = []
      for (let i = 0; i < maxLines; i++) {
        const line1 = lines1[i] || ''
        const line2 = lines2[i] || ''
        
        if (line1 === line2) {
          diff.push({ type: 'unchanged', line: i + 1, content: line1 })
        } else if (i >= lines1.length) {
          diff.push({ type: 'added', line: i + 1, content: line2 })
          stats.additions++
        } else if (i >= lines2.length) {
          diff.push({ type: 'removed', line: i + 1, content: line1 })
          stats.deletions++
        } else {
          diff.push({ type: 'removed', line: i + 1, content: line1 })
          diff.push({ type: 'added', line: i + 1, content: line2 })
          stats.changes++
        }
      }
    }
    
    // Check if versions are identical
    const identical = stats.changes === 0 && stats.additions === 0 && stats.deletions === 0
    
    // Calculate hashes for both versions
    const crypto = require('crypto')
    const hash1 = crypto.createHash('sha256')
      .update(JSON.stringify(v1.content))
      .digest('hex')
    const hash2 = crypto.createHash('sha256')
      .update(JSON.stringify(v2.content))
      .digest('hex')
    
    return NextResponse.json({
      noteId,
      panelId,
      comparison: {
        version1: {
          version: v1.version,
          created_at: v1.created_at,
          text_length: text1.length,
          hash: hash1
        },
        version2: {
          version: v2.version,
          created_at: v2.created_at,
          text_length: text2.length,
          hash: hash2
        }
      },
      version1Content: v1.content,
      version2Content: v2.content,
      identical,
      stats,
      diff,
      diffType
    })
  } catch (error) {
    console.error('Failed to compare versions:', error)
    return NextResponse.json(
      { error: 'Failed to compare versions', details: String(error) },
      { status: 500 }
    )
  }
}