/**
 * GET /api/widgets/sample-manifest
 *
 * Returns a valid sample widget manifest for testing the install pipeline.
 * This can be used as the URL when testing widget installation.
 */

import { NextResponse } from 'next/server'
import type { PanelChatManifest } from '@/lib/panels/panel-manifest'

const sampleManifest: PanelChatManifest = {
  panelId: 'sample-widget',
  panelType: 'demo',
  title: 'Sample Widget',
  version: '1.0',
  description: 'A sample widget for testing the install pipeline',
  intents: [
    {
      name: 'greet',
      description: 'Say hello from the sample widget',
      examples: ['hello sample', 'greet me from sample widget'],
      handler: 'api:/api/panels/sample-widget',
      permission: 'read',
    },
    {
      name: 'show_info',
      description: 'Display sample widget information',
      examples: ['show sample info', 'what can sample widget do'],
      handler: 'api:/api/panels/sample-widget',
      permission: 'read',
    },
  ],
}

export async function GET() {
  return NextResponse.json(sampleManifest, {
    headers: {
      'Content-Type': 'application/json',
    },
  })
}
