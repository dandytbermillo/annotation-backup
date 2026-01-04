/**
 * GET /api/widgets/demo-manifest
 *
 * Returns the Demo Widget manifest for installation.
 * This is an example of how custom widgets can be distributed via URL.
 *
 * Install URL: http://localhost:3000/api/widgets/demo-manifest
 */

import { NextResponse } from 'next/server'
import type { PanelChatManifest } from '@/lib/panels/panel-manifest'

const demoWidgetManifest: PanelChatManifest = {
  panelId: 'demo-widget',
  panelType: 'demo',
  title: 'Demo Widget',
  version: '1.0',
  description: 'Example custom widget demonstrating task list functionality and chat integration',
  intents: [
    {
      name: 'list_items',
      description: 'Show all items in the Demo Widget',
      examples: [
        'show demo',
        'show demo widget',
        'list demo items',
        'what is in demo',
        'open demo',
        'preview demo',
      ],
      handler: 'api:/api/panels/demo-widget/list',
      permission: 'read',
    },
  ],
  sandbox: {
    entrypoint: 'http://localhost:3000/api/widgets/demo-sandbox',
    permissions: ['read:workspace'],
    networkAllowlist: [],
    minSize: { width: 280, height: 200 },
    preferredSize: { width: 320, height: 280 },
  },
}

export async function GET() {
  return NextResponse.json(demoWidgetManifest, {
    headers: {
      'Content-Type': 'application/json',
    },
  })
}
