/**
 * GET /api/widgets/sandbox
 *
 * Sandbox wrapper endpoint for widget iframe.
 * Phase 3: Safe Custom Widgets
 *
 * Serves an HTML page with:
 * - CSP headers based on widget manifest
 * - Minimal HTML that loads the widget entrypoint
 * - Bridge client SDK for host communication
 */

import { NextRequest, NextResponse } from 'next/server'
import { getInstalledWidget } from '@/lib/widgets/widget-store'
import { resolveNoteWorkspaceUserId } from '@/app/api/note-workspaces/user-id'
import type { SandboxConfig } from '@/lib/panels/panel-manifest'

/**
 * Build CSP header from manifest networkAllowlist
 * CRITICAL: Only use manifest values, never user input
 */
function buildCSP(sandbox: SandboxConfig, entrypointOrigin: string): string {
  const networkAllowlist = sandbox.networkAllowlist ?? []

  // Default to 'none' if no allowlist
  const connectSrc = networkAllowlist.length > 0
    ? networkAllowlist.join(' ')
    : "'none'"

  return [
    "default-src 'none'",
    // Allow scripts from entrypoint origin + inline
    `script-src 'unsafe-inline' ${entrypointOrigin}`,
    "style-src 'unsafe-inline'",
    "img-src data: https:",
    `connect-src ${connectSrc}`,
    "frame-ancestors 'self'",
  ].join('; ')
}

/**
 * Generate the sandbox HTML wrapper
 */
function generateSandboxHTML(
  entrypoint: string,
  widgetId: string,
  channelId: string,
  permissions: string[],
  hostOrigin: string
): string {
  // Escape values for safe embedding in HTML/JS
  const safeEntrypoint = entrypoint.replace(/"/g, '&quot;')
  const safeWidgetId = widgetId.replace(/"/g, '&quot;')
  const safeChannelId = channelId.replace(/"/g, '&quot;')
  const safeHostOrigin = hostOrigin.replace(/"/g, '&quot;')
  const safePermissions = JSON.stringify(permissions)

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Widget Sandbox</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { width: 100%; height: 100%; overflow: hidden; }
    body { font-family: system-ui, -apple-system, sans-serif; }
    #widget-root { width: 100%; height: 100%; }
    .sandbox-error {
      padding: 16px;
      color: #ef4444;
      background: #fef2f2;
      border: 1px solid #fecaca;
      border-radius: 4px;
      font-size: 14px;
    }
  </style>
</head>
<body>
  <div id="widget-root"></div>

  <script>
    // Widget Bridge Client SDK
    (function() {
      'use strict';

      const WIDGET_ID = "${safeWidgetId}";
      const CHANNEL_ID = "${safeChannelId}";
      const PERMISSIONS = ${safePermissions};
      // Host origin is passed from server (known trusted value)
      const HOST_ORIGIN = "${safeHostOrigin}";

      let messageId = 0;
      const pendingRequests = new Map();

      // Send message to host (target specific origin for security)
      function sendToHost(message) {
        if (window.parent === window) {
          console.error('[WidgetBridge] Not in iframe, cannot send to host');
          return;
        }
        const fullMessage = {
          ...message,
          channelId: CHANNEL_ID,
          widgetId: WIDGET_ID,
        };
        // Send to known host origin only
        window.parent.postMessage(fullMessage, HOST_ORIGIN);
      }

      // Handle messages from host
      function handleHostMessage(event) {
        // CRITICAL 1: Validate source is parent window
        if (event.source !== window.parent) return;

        // CRITICAL 2: Validate origin matches expected host
        // This prevents malicious pages from sending messages if somehow embedded
        if (event.origin !== HOST_ORIGIN) {
          console.warn('[WidgetBridge] Rejected message from unexpected origin:', event.origin);
          return;
        }

        // CRITICAL 3: Validate channelId
        const data = event.data;
        if (!data || data.channelId !== CHANNEL_ID) return;

        if (data.type === 'response') {
          const pending = pendingRequests.get(data.id);
          if (pending) {
            pendingRequests.delete(data.id);
            if (data.error) {
              pending.reject(new Error(data.error.message || 'Unknown error'));
            } else {
              pending.resolve(data.result);
            }
          }
        } else if (data.type === 'event') {
          // Dispatch custom event for widget to listen to
          window.dispatchEvent(new CustomEvent('widget:' + data.event, {
            detail: data.payload
          }));
        }
      }

      window.addEventListener('message', handleHostMessage);

      // Public API for widgets
      window.WidgetBridge = {
        widgetId: WIDGET_ID,
        channelId: CHANNEL_ID,
        permissions: PERMISSIONS,

        // Make a request to the host
        request: function(method, params) {
          return new Promise(function(resolve, reject) {
            const id = 'req_' + (++messageId);
            pendingRequests.set(id, { resolve: resolve, reject: reject });

            // Timeout after 30 seconds
            setTimeout(function() {
              if (pendingRequests.has(id)) {
                pendingRequests.delete(id);
                reject(new Error('Request timeout'));
              }
            }, 30000);

            sendToHost({
              type: 'request',
              id: id,
              method: method,
              params: params
            });
          });
        },

        // Convenience methods
        workspace: {
          getPanels: function() { return window.WidgetBridge.request('workspace.getPanels'); },
          getActivePanel: function() { return window.WidgetBridge.request('workspace.getActivePanel'); },
          openPanel: function(panelId) { return window.WidgetBridge.request('workspace.openPanel', { panelId: panelId }); },
          closePanel: function(panelId) { return window.WidgetBridge.request('workspace.closePanel', { panelId: panelId }); },
        },
        notes: {
          getCurrentNote: function() { return window.WidgetBridge.request('notes.getCurrentNote'); },
          getNote: function(noteId) { return window.WidgetBridge.request('notes.getNote', { noteId: noteId }); },
          updateNote: function(noteId, content) { return window.WidgetBridge.request('notes.updateNote', { noteId: noteId, content: content }); },
        },
        ui: {
          showToast: function(message, type) { return window.WidgetBridge.request('ui.showToast', { message: message, type: type }); },
          requestResize: function(width, height) { return window.WidgetBridge.request('ui.requestResize', { width: width, height: height }); },
        },
        storage: {
          get: function(key) { return window.WidgetBridge.request('storage.get', { key: key }); },
          set: function(key, value) { return window.WidgetBridge.request('storage.set', { key: key, value: value }); },
        },

        // Signal ready to host
        ready: function() {
          sendToHost({ type: 'event', event: 'ready' });
        }
      };

      // Notify host that bridge is initialized
      sendToHost({ type: 'event', event: 'bridge_init' });
    })();
  </script>

  <script>
    // Load widget entrypoint
    (function() {
      var script = document.createElement('script');
      script.src = "${safeEntrypoint}";
      script.async = true;
      script.onerror = function() {
        document.getElementById('widget-root').innerHTML =
          '<div class="sandbox-error">Failed to load widget script</div>';
      };
      document.body.appendChild(script);
    })();
  </script>
</body>
</html>`
}

export async function GET(request: NextRequest) {
  try {
    // Get query parameters
    const widgetId = request.nextUrl.searchParams.get('widgetId')
    const channelId = request.nextUrl.searchParams.get('channelId')

    if (!widgetId || !channelId) {
      return new NextResponse('Missing widgetId or channelId', { status: 400 })
    }

    // Validate channelId format (should be UUID-like)
    if (!/^[a-zA-Z0-9-]{20,50}$/.test(channelId)) {
      return new NextResponse('Invalid channelId format', { status: 400 })
    }

    // Get user ID
    const userId = resolveNoteWorkspaceUserId(request)
    if (userId === 'invalid') {
      return new NextResponse('Invalid userId', { status: 400 })
    }

    // Fetch widget from DB
    const widget = await getInstalledWidget(
      widgetId,
      userId === 'global' ? null : userId
    )

    if (!widget) {
      return new NextResponse('Widget not found', { status: 404 })
    }

    // Check if widget has sandbox config
    const sandbox = widget.manifest.sandbox
    if (!sandbox) {
      return new NextResponse('Widget does not have sandbox configuration', { status: 400 })
    }

    // Validate entrypoint
    let entrypointOrigin: string
    try {
      const url = new URL(sandbox.entrypoint)
      if (url.protocol !== 'https:') {
        return new NextResponse('Widget entrypoint must be HTTPS', { status: 400 })
      }
      entrypointOrigin = url.origin
    } catch {
      return new NextResponse('Invalid widget entrypoint URL', { status: 400 })
    }

    // Build CSP header
    const csp = buildCSP(sandbox, entrypointOrigin)

    // Get host origin from request URL (trusted value from server)
    const hostOrigin = request.nextUrl.origin

    // Generate HTML
    const html = generateSandboxHTML(
      sandbox.entrypoint,
      widgetId,
      channelId,
      sandbox.permissions,
      hostOrigin
    )

    // Return HTML with security headers
    return new NextResponse(html, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Security-Policy': csp,
        'X-Frame-Options': 'SAMEORIGIN',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
      },
    })
  } catch (error) {
    console.error('[api/widgets/sandbox] Error:', error)
    return new NextResponse('Internal server error', { status: 500 })
  }
}
