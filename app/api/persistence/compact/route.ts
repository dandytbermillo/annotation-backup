import { NextRequest, NextResponse } from 'next/server'
import { getServerPostgresAdapter } from '@/lib/database/server-postgres-adapter'

export async function POST(request: NextRequest) {
  try {
    const adapter = getServerPostgresAdapter()
    const { docName } = await request.json()
    
    await adapter.compact(docName)
    
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Compact API error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to compact' },
      { status: 500 }
    )
  }
}