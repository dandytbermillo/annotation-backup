import { NextRequest, NextResponse } from 'next/server'
import { getServerPostgresAdapter } from '@/lib/database/server-postgres-adapter'

export async function GET(
  request: NextRequest,
  { params }: { params: { docName: string } }
) {
  try {
    const adapter = getServerPostgresAdapter()
    const docName = decodeURIComponent(params.docName)
    
    const content = await adapter.load(docName)
    
    if (!content) {
      return NextResponse.json(
        { error: 'Document not found' },
        { status: 404 }
      )
    }
    
    return NextResponse.json({ 
      content: Array.from(content) // Convert Uint8Array to array for JSON
    })
  } catch (error) {
    console.error('Load API error:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to load document' },
      { status: 500 }
    )
  }
}