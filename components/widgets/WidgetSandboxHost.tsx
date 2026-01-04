'use client'

/**
 * Widget Sandbox Host Component
 * Phase 3: Safe Custom Widgets
 *
 * Renders a sandboxed widget in an iframe with:
 * - Secure sandbox attributes
 * - Bridge communication
 * - Permission handling
 */

import React, { useRef, useEffect, useState, useCallback } from 'react'
import { Loader2, AlertTriangle, ShieldAlert } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { SandboxConfig } from '@/lib/panels/panel-manifest'
import type { WidgetPermission } from '@/lib/widgets/sandbox-permissions'
import { PERMISSION_INFO } from '@/lib/widgets/sandbox-permissions'
import {
  SandboxBridge,
  generateChannelId,
  buildSandboxUrl,
  type BridgeHandlers,
} from '@/lib/widgets/sandbox-bridge'

// =============================================================================
// Types
// =============================================================================

export interface WidgetSandboxHostProps {
  /** Installed widget ID */
  widgetId: string
  /** Widget instance ID (for permission scoping) */
  widgetInstanceId: string
  /** Widget title for display */
  title: string
  /** Sandbox configuration from manifest */
  sandbox: SandboxConfig
  /** User ID for permission scoping */
  userId?: string | null
  /** Custom class name */
  className?: string
  /** Bridge handlers for API methods */
  handlers?: BridgeHandlers
  /** Callback when widget is ready */
  onReady?: () => void
  /** Callback when widget errors */
  onError?: (error: Error) => void
}

type LoadState = 'loading' | 'ready' | 'error'

// =============================================================================
// Permission Dialog Component
// =============================================================================

interface PermissionDialogProps {
  widgetTitle: string
  permission: WidgetPermission
  method: string
  onDecision: (decision: 'allow' | 'deny' | 'always' | 'never') => void
}

function PermissionDialog({
  widgetTitle,
  permission,
  method,
  onDecision,
}: PermissionDialogProps) {
  const info = PERMISSION_INFO[permission]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-md rounded-lg bg-zinc-900 border border-zinc-700 shadow-xl p-6">
        <div className="flex items-start gap-4">
          <div className="flex-shrink-0 p-2 rounded-full bg-amber-500/20">
            <ShieldAlert className="w-6 h-6 text-amber-500" />
          </div>
          <div className="flex-1">
            <h3 className="text-lg font-semibold text-white mb-2">
              Permission Request
            </h3>
            <p className="text-sm text-gray-300 mb-4">
              <strong className="text-white">{widgetTitle}</strong> wants to{' '}
              <strong className="text-amber-400">{info?.label?.toLowerCase() || permission}</strong>
            </p>
            <div className="p-3 rounded bg-zinc-800 border border-zinc-700 mb-4">
              <div className="text-xs text-gray-400 mb-1">Action:</div>
              <div className="text-sm text-white font-mono">{method}</div>
              <div className="text-xs text-gray-500 mt-2">
                {info?.description}
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => onDecision('allow')}
                className="px-4 py-2 text-sm rounded bg-blue-600 hover:bg-blue-500 text-white transition-colors"
              >
                Allow Once
              </button>
              <button
                onClick={() => onDecision('always')}
                className="px-4 py-2 text-sm rounded bg-green-600 hover:bg-green-500 text-white transition-colors"
              >
                Always Allow
              </button>
              <button
                onClick={() => onDecision('deny')}
                className="px-4 py-2 text-sm rounded bg-zinc-700 hover:bg-zinc-600 text-white transition-colors"
              >
                Deny
              </button>
              <button
                onClick={() => onDecision('never')}
                className="px-4 py-2 text-sm rounded bg-red-600/20 hover:bg-red-600/30 text-red-400 transition-colors"
              >
                Always Deny
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// =============================================================================
// Main Component
// =============================================================================

export function WidgetSandboxHost({
  widgetId,
  widgetInstanceId,
  title,
  sandbox,
  userId = null,
  className,
  handlers,
  onReady,
  onError,
}: WidgetSandboxHostProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const bridgeRef = useRef<SandboxBridge | null>(null)
  const [channelId] = useState(() => generateChannelId())
  const [loadState, setLoadState] = useState<LoadState>('loading')
  const [error, setError] = useState<string | null>(null)

  // Permission dialog state
  const [permissionRequest, setPermissionRequest] = useState<{
    permission: WidgetPermission
    method: string
    resolve: (decision: 'allow' | 'deny' | 'always' | 'never') => void
  } | null>(null)

  // Handle permission request from bridge
  const handlePermissionRequest = useCallback(
    (permission: WidgetPermission, method: string): Promise<'allow' | 'deny' | 'always' | 'never'> => {
      return new Promise((resolve) => {
        setPermissionRequest({ permission, method, resolve })
      })
    },
    []
  )

  // Handle permission dialog decision
  const handlePermissionDecision = useCallback(
    async (decision: 'allow' | 'deny' | 'always' | 'never') => {
      if (permissionRequest) {
        // Persist 'always' and 'never' decisions to DB
        if (decision === 'always' || decision === 'never') {
          try {
            await fetch('/api/widgets/permissions', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                widgetInstanceId,
                permission: permissionRequest.permission,
                allowLevel: decision,
              }),
            })
          } catch (error) {
            console.error('[WidgetSandboxHost] Failed to persist permission:', error)
            // Still resolve the request even if persistence fails
          }
        }

        permissionRequest.resolve(decision)
        setPermissionRequest(null)
      }
    },
    [permissionRequest, widgetInstanceId]
  )

  // Initialize bridge
  useEffect(() => {
    const bridge = new SandboxBridge({
      widgetId,
      widgetInstanceId,
      channelId,
      declaredPermissions: sandbox.permissions,
      userId,
      iframeRef: iframeRef as React.RefObject<HTMLIFrameElement>,
      onReady: () => {
        setLoadState('ready')
        onReady?.()
      },
      onError: (err) => {
        setLoadState('error')
        setError(err.message)
        onError?.(err)
      },
      onPermissionRequest: handlePermissionRequest,
      handlers,
    })

    bridge.init()
    bridgeRef.current = bridge

    // Fetch persistent grants and load into bridge
    const loadPersistentGrants = async () => {
      try {
        const response = await fetch(
          `/api/widgets/permissions?widgetInstanceId=${encodeURIComponent(widgetInstanceId)}`
        )
        if (response.ok) {
          const data = await response.json()
          const grants = (data.grants || []).map((g: { permission: string; allowLevel: string }) => ({
            widgetInstanceId,
            userId,
            permission: g.permission,
            allowLevel: g.allowLevel,
            grantedAt: new Date(),
            expiresAt: null,
          }))
          bridge.setPersistentGrants(grants)
        }
      } catch (error) {
        console.error('[WidgetSandboxHost] Failed to load persistent grants:', error)
      }
    }
    loadPersistentGrants()

    // Timeout for loading
    const timeout = setTimeout(() => {
      if (loadState === 'loading') {
        setLoadState('error')
        setError('Widget failed to load (timeout)')
      }
    }, 30000)

    return () => {
      clearTimeout(timeout)
      bridge.destroy()
      bridgeRef.current = null
    }
  }, [
    widgetId,
    widgetInstanceId,
    channelId,
    sandbox.permissions,
    userId,
    handlers,
    handlePermissionRequest,
    onReady,
    onError,
    loadState,
  ])

  // Handle iframe load error
  const handleIframeError = useCallback(() => {
    setLoadState('error')
    setError('Failed to load widget iframe')
  }, [])

  // Build iframe URL
  const sandboxUrl = buildSandboxUrl(widgetId, channelId)

  // Compute size from sandbox config
  const minWidth = sandbox.minSize?.width ?? 200
  const minHeight = sandbox.minSize?.height ?? 100
  const prefWidth = sandbox.preferredSize?.width
  const prefHeight = sandbox.preferredSize?.height

  return (
    <div
      className={cn('relative', className)}
      style={{
        minWidth,
        minHeight,
        width: prefWidth,
        height: prefHeight,
      }}
    >
      {/* Loading overlay */}
      {loadState === 'loading' && (
        <div className="absolute inset-0 flex items-center justify-center bg-zinc-900/80 z-10">
          <div className="flex flex-col items-center gap-2">
            <Loader2 className="w-6 h-6 animate-spin text-blue-400" />
            <span className="text-sm text-gray-400">Loading widget...</span>
          </div>
        </div>
      )}

      {/* Error state */}
      {loadState === 'error' && (
        <div className="absolute inset-0 flex items-center justify-center bg-zinc-900/80 z-10">
          <div className="flex flex-col items-center gap-2 p-4 text-center">
            <AlertTriangle className="w-8 h-8 text-red-400" />
            <span className="text-sm text-red-400 font-medium">Widget Error</span>
            <span className="text-xs text-gray-500">{error}</span>
          </div>
        </div>
      )}

      {/* Sandboxed iframe */}
      <iframe
        ref={iframeRef}
        src={sandboxUrl}
        sandbox="allow-scripts allow-forms"
        referrerPolicy="no-referrer"
        className="w-full h-full border-0"
        title={`Widget: ${title}`}
        onError={handleIframeError}
      />

      {/* Permission dialog */}
      {permissionRequest && (
        <PermissionDialog
          widgetTitle={title}
          permission={permissionRequest.permission}
          method={permissionRequest.method}
          onDecision={handlePermissionDecision}
        />
      )}
    </div>
  )
}

export default WidgetSandboxHost
