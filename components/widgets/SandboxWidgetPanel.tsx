'use client'

/**
 * Sandbox Widget Panel
 * Phase 3.2: Widget Bridge Handler Wiring
 *
 * Wrapper component that renders a sandboxed widget with proper handlers.
 * Integrates WidgetSandboxHost with useSandboxHandlers hook.
 *
 * Usage: Render this component for panels that have sandbox configuration.
 */

import React, { useState, useCallback } from 'react'
import { WidgetSandboxHost } from './WidgetSandboxHost'
import { useSandboxHandlers, createEmptyDependencies, type SandboxHandlerDependencies, type WriteCallbacks } from '@/lib/widgets/use-sandbox-handlers'
import type { SandboxConfig } from '@/lib/panels/panel-manifest'

// =============================================================================
// Types
// =============================================================================

export interface SandboxWidgetPanelProps {
  /** Widget ID (installed_widgets.id) */
  widgetId: string
  /** Widget instance ID (widget_instances.id) */
  widgetInstanceId: string
  /** Widget title */
  title: string
  /** Sandbox configuration from manifest */
  sandbox: SandboxConfig
  /** Optional user ID */
  userId?: string | null
  /** Handler dependencies from parent context */
  dependencies?: SandboxHandlerDependencies
  /** Write operation callbacks (Phase 3.3) */
  writeCallbacks?: WriteCallbacks
  /** Callback when widget is ready */
  onReady?: () => void
  /** Callback when widget errors */
  onError?: (error: Error) => void
  /** Custom class name */
  className?: string
}

// =============================================================================
// Component
// =============================================================================

/**
 * Renders a sandboxed widget with bridge handlers wired up.
 *
 * This component:
 * 1. Creates bridge handlers from provided dependencies
 * 2. Manages widget size (for resize requests)
 * 3. Renders WidgetSandboxHost with all props wired
 *
 * Example usage in DashboardWidgetRenderer:
 * ```tsx
 * case 'custom_widget':
 *   return (
 *     <SandboxWidgetPanel
 *       widgetId={panel.config.widgetId}
 *       widgetInstanceId={panel.config.instanceId}
 *       title={panel.title || 'Widget'}
 *       sandbox={panel.config.sandbox}
 *       dependencies={{
 *         workspace: { panels, activePanelId },
 *         notes: { currentNote, getNoteById },
 *       }}
 *       writeCallbacks={{
 *         workspace: { openPanel, closePanel, focusPanel },
 *         notes: { updateNote, createNote, deleteNote },
 *         chat: { sendMessage },
 *       }}
 *     />
 *   )
 * ```
 */
export function SandboxWidgetPanel({
  widgetId,
  widgetInstanceId,
  title,
  sandbox,
  userId = null,
  dependencies = createEmptyDependencies(),
  writeCallbacks,
  onReady,
  onError,
  className,
}: SandboxWidgetPanelProps) {
  // Widget size state (for resize requests)
  const [widgetSize, setWidgetSize] = useState<{ width: number; height: number } | null>(null)

  // Handle resize requests from widget
  const handleResizeRequest = useCallback((width: number, height: number) => {
    // Clamp to min/max bounds
    const minWidth = sandbox.minSize?.width ?? 200
    const minHeight = sandbox.minSize?.height ?? 100
    const maxWidth = 800
    const maxHeight = 600

    setWidgetSize({
      width: Math.max(minWidth, Math.min(maxWidth, width)),
      height: Math.max(minHeight, Math.min(maxHeight, height)),
    })
  }, [sandbox.minSize])

  // Create bridge handlers
  const handlers = useSandboxHandlers({
    widgetInstanceId,
    dependencies,
    writeCallbacks,
    onResizeRequest: handleResizeRequest,
  })

  // If widget requested a resize, wrap in a container with the new size
  const content = (
    <WidgetSandboxHost
      widgetId={widgetId}
      widgetInstanceId={widgetInstanceId}
      title={title}
      sandbox={sandbox}
      userId={userId}
      handlers={handlers}
      onReady={onReady}
      onError={onError}
      className={!widgetSize ? className : undefined}
    />
  )

  if (widgetSize) {
    return (
      <div
        className={className}
        style={{ width: widgetSize.width, height: widgetSize.height }}
      >
        {content}
      </div>
    )
  }

  return content
}

export default SandboxWidgetPanel
