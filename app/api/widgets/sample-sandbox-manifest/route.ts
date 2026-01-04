/**
 * GET /api/widgets/sample-sandbox-manifest
 *
 * Returns a valid sample widget manifest WITH sandbox config for testing Phase 3.1.
 * Uses a publicly hosted simple widget bundle for testing.
 */

import { NextResponse } from 'next/server'
import type { PanelChatManifest } from '@/lib/panels/panel-manifest'

// For testing, we use a simple CDN-hosted script as a placeholder
// In production, this would be the actual widget bundle URL
// Using unpkg as it's a reliable HTTPS CDN
const SAMPLE_WIDGET_ENTRYPOINT = 'https://unpkg.com/preact@10.19.3/dist/preact.min.js'

const sampleSandboxManifest: PanelChatManifest = {
  panelId: 'sandbox-test-widget',
  panelType: 'sandbox-demo',
  title: 'Sandbox Test Widget',
  version: '1.0',
  description: 'A sandboxed widget for testing Phase 3.1 sandbox infrastructure',
  intents: [
    {
      name: 'test_sandbox',
      description: 'Test the sandbox widget functionality',
      examples: ['test sandbox', 'run sandbox test'],
      handler: 'api:/api/panels/sandbox-test',
      permission: 'read',
    },
    {
      name: 'write_test',
      description: 'Test a write operation that requires permission',
      examples: ['write to sandbox', 'sandbox write test'],
      handler: 'api:/api/panels/sandbox-test-write',
      permission: 'write',
    },
  ],
  sandbox: {
    entrypoint: SAMPLE_WIDGET_ENTRYPOINT,
    permissions: ['read:workspace', 'read:notes'],
    networkAllowlist: [],  // No external network access
    minSize: { width: 300, height: 200 },
    preferredSize: { width: 400, height: 300 },
  },
}

export async function GET() {
  return NextResponse.json(sampleSandboxManifest, {
    headers: {
      'Content-Type': 'application/json',
    },
  })
}
