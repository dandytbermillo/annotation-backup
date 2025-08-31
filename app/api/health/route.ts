import { NextRequest, NextResponse } from 'next/server'

// GET /api/health - Simple health check endpoint
export async function GET(request: NextRequest) {
  return NextResponse.json({
    ok: true,
    status: 'healthy',
    timestamp: new Date().toISOString()
  })
}