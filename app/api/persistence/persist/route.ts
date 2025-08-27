import { NextRequest, NextResponse } from 'next/server'
import { getServerPostgresAdapter } from '@/lib/database/server-postgres-adapter'

export async function POST(request: NextRequest) {
  try {
    const adapter = getServerPostgresAdapter()
    const { docName, update } = await request.json()
    
    const updateArray = new Uint8Array(update)
    await adapter.persist(docName, updateArray)
    
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Persist API error:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to persist' },
      { status: 500 }
    )
  }
}