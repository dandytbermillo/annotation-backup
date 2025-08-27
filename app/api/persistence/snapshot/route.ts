import { NextRequest, NextResponse } from 'next/server'
import { getServerPostgresAdapter } from '@/lib/database/server-postgres-adapter'

export async function POST(request: NextRequest) {
  try {
    const adapter = getServerPostgresAdapter()
    const { docName, snapshot } = await request.json()
    
    const snapshotArray = new Uint8Array(snapshot)
    await adapter.saveSnapshot(docName, snapshotArray)
    
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Snapshot API error:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to save snapshot' },
      { status: 500 }
    )
  }
}