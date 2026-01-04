/**
 * GET /api/widgets/sample-sandbox-network
 *
 * Sample widget with network allowlist for testing CSP connect-src.
 */

import { NextResponse } from 'next/server'
import type { PanelChatManifest } from '@/lib/panels/panel-manifest'

const sampleNetworkManifest: PanelChatManifest = {
  panelId: 'sandbox-network-widget',
  panelType: 'sandbox-demo',
  title: 'Network Widget',
  version: '1.0',
  description: 'Widget with network access for testing CSP',
  intents: [
    {
      name: 'fetch_data',
      description: 'Fetch data from allowed API',
      examples: ['fetch data', 'get api data'],
      handler: 'api:/api/panels/network-test',
      permission: 'read',
    },
  ],
  sandbox: {
    entrypoint: 'https://unpkg.com/preact@10.19.3/dist/preact.min.js',
    permissions: ['read:workspace', 'network:fetch'],
    // Explicitly allow jsonplaceholder API
    networkAllowlist: ['https://jsonplaceholder.typicode.com'],
    minSize: { width: 300, height: 200 },
  },
}

export async function GET() {
  return NextResponse.json(sampleNetworkManifest, {
    headers: { 'Content-Type': 'application/json' },
  })
}
