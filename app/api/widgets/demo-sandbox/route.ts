/**
 * GET /api/widgets/demo-sandbox
 *
 * Returns the Demo Widget sandbox HTML for rendering in iframe.
 * This is the widget's visual UI rendered inside the sandbox.
 */

import { NextResponse } from 'next/server'

const DEMO_ITEMS = [
  { id: '1', name: 'Learn TypeScript', icon: '\ud83d\udcda' },
  { id: '2', name: 'Build a widget', icon: '\ud83d\udd27' },
  { id: '3', name: 'Test chat integration', icon: '\ud83d\udcac' },
]

const sandboxHTML = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Demo Widget</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: transparent;
      color: #e5e5e5;
      padding: 12px;
      font-size: 13px;
    }
    .widget-label {
      font-size: 10px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #a1a1aa;
      margin-bottom: 8px;
      display: flex;
      align-items: center;
      gap: 4px;
    }
    .sparkle {
      color: #facc15;
    }
    .widget-value {
      font-size: 24px;
      font-weight: 700;
      color: #fafafa;
      margin-bottom: 4px;
    }
    .widget-value .unit {
      font-size: 12px;
      font-weight: 400;
      color: #71717a;
      margin-left: 4px;
    }
    .widget-list {
      margin-top: 12px;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .widget-list-item {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 8px;
      background: rgba(255, 255, 255, 0.05);
      border-radius: 6px;
      font-size: 12px;
    }
    .widget-list-item .icon {
      font-size: 14px;
    }
  </style>
</head>
<body>
  <div class="widget-label">
    Demo Widget
    <span class="sparkle">\u2728</span>
  </div>

  <div class="widget-value">
    ${DEMO_ITEMS.length}
    <span class="unit">items</span>
  </div>

  <div class="widget-list">
    ${DEMO_ITEMS.map(item => `
      <div class="widget-list-item">
        <span class="icon">${item.icon}</span>
        <span>${item.name}</span>
      </div>
    `).join('')}
  </div>

  <script>
    // Widget bridge integration
    window.addEventListener('message', (event) => {
      if (event.data?.type === 'widget:init') {
        // Widget initialized
        console.log('[DemoWidget] Initialized')
      }
    })

    // Signal ready
    window.parent?.postMessage({ type: 'widget:ready' }, '*')
  </script>
</body>
</html>
`

export async function GET() {
  return new NextResponse(sandboxHTML, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
    },
  })
}
