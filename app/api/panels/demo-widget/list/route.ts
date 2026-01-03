import { NextResponse } from 'next/server'

/**
 * Demo Widget - List Items Handler
 *
 * Returns mock items to demonstrate third-party widget chat integration.
 * This handler follows the Chat Output Contract format.
 */

// Mock data - in a real widget, this would come from a database or external API
const DEMO_ITEMS = [
  { id: '1', name: 'Learn TypeScript', type: 'note' as const, meta: 'Tutorial' },
  { id: '2', name: 'Build a widget', type: 'note' as const, meta: 'Project' },
  { id: '3', name: 'Test chat integration', type: 'note' as const, meta: 'Task' },
  { id: '4', name: 'Deploy to production', type: 'note' as const, meta: 'Task' },
]

export async function POST(request: Request) {
  try {
    // Parse request body (optional - for mode param)
    let mode = 'preview'
    try {
      const body = await request.json()
      mode = body.params?.mode || 'preview'
    } catch {
      // No body or invalid JSON - use defaults
    }

    // Return data in Chat Output Contract format
    return NextResponse.json({
      success: true,
      title: 'Demo Widget',
      subtitle: 'Third-party widget example',
      message: `Found ${DEMO_ITEMS.length} demo items`,
      showInViewPanel: mode === 'preview',
      totalCount: DEMO_ITEMS.length,
      items: DEMO_ITEMS.map((item) => ({
        id: item.id,
        name: item.name,
        type: item.type,
        meta: item.meta,
        isSelectable: false, // Demo items are not clickable
      })),
    })
  } catch (error) {
    console.error('[demo-widget/list] Error:', error)
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to list demo items',
        message: 'An error occurred while fetching demo items.',
      },
      { status: 500 }
    )
  }
}
