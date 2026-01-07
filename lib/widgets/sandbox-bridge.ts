/**
 * Widget Sandbox Bridge
 * Phase 3: Safe Custom Widgets
 *
 * Handles postMessage communication between host and sandboxed widget iframes.
 * Implements origin validation, channelId verification, and permission checking.
 */

import type { WidgetPermission } from './sandbox-permissions'
import {
  getMethodPermission,
  hasPermission,
  checkApprovalStatus,
  recordSessionGrant,
  type PermissionGrant,
} from './sandbox-permissions'

// =============================================================================
// Types
// =============================================================================

export interface BridgeMessage {
  type: 'request' | 'response' | 'event'
  id?: string
  channelId: string
  widgetId: string
  method?: string
  params?: unknown
  result?: unknown
  error?: { code: string; message: string }
  event?: string
  payload?: unknown
}

export interface BridgeConfig {
  widgetId: string
  widgetInstanceId: string
  channelId: string
  declaredPermissions: WidgetPermission[]
  userId: string | null
  iframeRef: React.RefObject<HTMLIFrameElement | null>
  onReady?: () => void
  onError?: (error: Error) => void
  onPermissionRequest?: (
    permission: WidgetPermission,
    method: string
  ) => Promise<'allow' | 'deny' | 'always' | 'never'>
  // API handlers
  handlers?: BridgeHandlers
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyHandler = (params?: any) => Promise<any>

export interface BridgeHandlers {
  'workspace.getPanels'?: () => Promise<unknown>
  'workspace.getActivePanel'?: () => Promise<unknown>
  'workspace.openPanel'?: (params: { panelId: string }) => Promise<unknown>
  'workspace.closePanel'?: (params: { panelId: string }) => Promise<unknown>
  'notes.getCurrentNote'?: () => Promise<unknown>
  'notes.getNote'?: (params: { noteId: string }) => Promise<unknown>
  'notes.updateNote'?: (params: { noteId: string; content: string }) => Promise<unknown>
  'ui.showToast'?: (params: { message: string; type?: string }) => Promise<void>
  'ui.requestResize'?: (params: { width: number; height: number }) => Promise<void>
  'storage.get'?: (params: { key: string }) => Promise<unknown>
  'storage.set'?: (params: { key: string; value: unknown }) => Promise<void>
  // Widget Chat State: Report internal state for LLM context
  'widget.reportState'?: (params: {
    _version: 1
    widgetId: string
    instanceId: string
    title: string
    view?: string | null
    selection?: { id: string; label: string } | null
    summary?: string | null
    updatedAt: number
    filters?: string[]
    counts?: Record<string, number>
    actions?: string[]
    contextTags?: string[]
  }) => Promise<{ success: boolean }>
  // Allow dynamic method lookup while preserving type safety for known methods
  [key: string]: AnyHandler | undefined
}

// =============================================================================
// Bridge Class
// =============================================================================

export class SandboxBridge {
  private config: BridgeConfig
  private persistentGrants: Map<WidgetPermission, PermissionGrant> = new Map()
  private messageHandler: ((event: MessageEvent) => void) | null = null
  private isDestroyed = false

  constructor(config: BridgeConfig) {
    this.config = config
  }

  /**
   * Initialize the bridge and start listening for messages
   */
  init(): void {
    if (this.messageHandler) {
      console.warn('[SandboxBridge] Already initialized')
      return
    }

    this.messageHandler = this.handleMessage.bind(this)
    window.addEventListener('message', this.messageHandler)
  }

  /**
   * Destroy the bridge and stop listening
   */
  destroy(): void {
    this.isDestroyed = true
    if (this.messageHandler) {
      window.removeEventListener('message', this.messageHandler)
      this.messageHandler = null
    }
  }

  /**
   * Load persistent grants from DB
   */
  setPersistentGrants(grants: PermissionGrant[]): void {
    this.persistentGrants.clear()
    for (const grant of grants) {
      this.persistentGrants.set(grant.permission, grant)
    }
  }

  /**
   * Send event to widget
   */
  sendEvent(event: string, payload?: unknown): void {
    const iframe = this.config.iframeRef.current
    if (!iframe?.contentWindow) {
      console.warn('[SandboxBridge] Cannot send event: iframe not ready')
      return
    }

    const message: BridgeMessage = {
      type: 'event',
      channelId: this.config.channelId,
      widgetId: this.config.widgetId,
      event,
      payload,
    }

    iframe.contentWindow.postMessage(message, '*')
  }

  /**
   * Handle incoming message from widget
   */
  private handleMessage(event: MessageEvent): void {
    if (this.isDestroyed) return

    // CRITICAL 1: Validate origin
    // When iframe sandbox omits allow-same-origin, event.origin will be "null"
    const allowedOrigins = new Set([window.location.origin, 'null'])
    if (!allowedOrigins.has(event.origin)) {
      console.warn(`[SandboxBridge] Rejected message from unauthorized origin: ${event.origin}`)
      return
    }

    // CRITICAL 2: Validate source is our specific iframe
    const iframe = this.config.iframeRef.current
    if (!iframe || event.source !== iframe.contentWindow) {
      // Not from our iframe, ignore silently (could be from another widget)
      return
    }

    // CRITICAL 3: Validate channelId to prevent cross-widget message bleed
    const data = event.data as BridgeMessage
    if (!data || data.channelId !== this.config.channelId) {
      console.warn(`[SandboxBridge] Rejected message with wrong channelId`)
      return
    }

    // Validate widgetId
    if (data.widgetId !== this.config.widgetId) {
      console.warn(`[SandboxBridge] Rejected message with wrong widgetId`)
      return
    }

    // Handle based on message type
    if (data.type === 'event') {
      this.handleWidgetEvent(data)
    } else if (data.type === 'request') {
      this.handleRequest(data)
    }
  }

  /**
   * Handle widget events (ready, etc.)
   */
  private handleWidgetEvent(message: BridgeMessage): void {
    if (message.event === 'ready' || message.event === 'bridge_init') {
      this.config.onReady?.()
    }
  }

  /**
   * Handle widget requests
   */
  private async handleRequest(message: BridgeMessage): Promise<void> {
    const { id, method, params } = message

    if (!id || !method) {
      console.warn('[SandboxBridge] Invalid request: missing id or method')
      return
    }

    try {
      // Check permission for this method
      const requiredPermission = getMethodPermission(method)

      if (requiredPermission) {
        // Check if widget has this permission declared
        if (!hasPermission(this.config.declaredPermissions, requiredPermission)) {
          this.sendResponse(id, undefined, {
            code: 'PERMISSION_DENIED',
            message: `Permission "${requiredPermission}" not declared in manifest`,
          })
          return
        }

        // Check approval status
        const persistentGrant = this.persistentGrants.get(requiredPermission) ?? null
        const status = checkApprovalStatus(
          requiredPermission,
          this.config.declaredPermissions,
          persistentGrant,
          this.config.widgetInstanceId,
          this.config.userId
        )

        if (status === 'deny') {
          this.sendResponse(id, undefined, {
            code: 'PERMISSION_DENIED',
            message: `Permission "${requiredPermission}" denied`,
          })
          return
        }

        if (status === 'prompt') {
          // Request permission from user
          if (!this.config.onPermissionRequest) {
            this.sendResponse(id, undefined, {
              code: 'PERMISSION_DENIED',
              message: `Permission "${requiredPermission}" requires user approval`,
            })
            return
          }

          const decision = await this.config.onPermissionRequest(requiredPermission, method)

          if (decision === 'deny' || decision === 'never') {
            if (decision === 'never') {
              recordSessionGrant(
                this.config.widgetInstanceId,
                this.config.userId,
                requiredPermission,
                'never'
              )
            }
            this.sendResponse(id, undefined, {
              code: 'PERMISSION_DENIED',
              message: `Permission "${requiredPermission}" denied by user`,
            })
            return
          }

          // Record session grant if 'once'
          if (decision === 'allow') {
            recordSessionGrant(
              this.config.widgetInstanceId,
              this.config.userId,
              requiredPermission,
              'once'
            )
          }
          // 'always' should be persisted to DB by the caller
        }
      }

      // Execute the handler
      const handler = this.config.handlers?.[method]
      if (!handler) {
        this.sendResponse(id, undefined, {
          code: 'METHOD_NOT_FOUND',
          message: `Unknown method: ${method}`,
        })
        return
      }

      const result = await handler(params as Record<string, unknown>)
      this.sendResponse(id, result)
    } catch (error) {
      console.error(`[SandboxBridge] Error handling ${method}:`, error)
      this.sendResponse(id, undefined, {
        code: 'INTERNAL_ERROR',
        message: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  }

  /**
   * Send response back to widget
   */
  private sendResponse(
    id: string,
    result?: unknown,
    error?: { code: string; message: string }
  ): void {
    const iframe = this.config.iframeRef.current
    if (!iframe?.contentWindow) {
      console.warn('[SandboxBridge] Cannot send response: iframe not ready')
      return
    }

    const message: BridgeMessage = {
      type: 'response',
      id,
      channelId: this.config.channelId,
      widgetId: this.config.widgetId,
      result,
      error,
    }

    iframe.contentWindow.postMessage(message, '*')
  }
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Generate a unique channel ID for widget instance
 */
export function generateChannelId(): string {
  // Use crypto.randomUUID if available, otherwise fallback
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID()
  }
  // Fallback for older browsers
  return 'ch_' + Math.random().toString(36).substring(2, 15) +
         Math.random().toString(36).substring(2, 15)
}

/**
 * Build sandbox URL for iframe
 */
export function buildSandboxUrl(widgetId: string, channelId: string): string {
  const params = new URLSearchParams({
    widgetId,
    channelId,
  })
  return `/api/widgets/sandbox?${params.toString()}`
}
