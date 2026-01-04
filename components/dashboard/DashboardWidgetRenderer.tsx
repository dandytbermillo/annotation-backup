"use client"

/**
 * Dashboard Widget Renderer
 * Part of Widget Architecture - Routes panel types to widget components
 *
 * Routes each panel type to its corresponding widget component.
 * Falls back to BaseDashboardPanel for panel types without widgets yet.
 */

import React, { useMemo } from 'react'
import type { WorkspacePanel, PanelConfig } from '@/lib/dashboard/panel-registry'
import { RecentWidget } from './widgets/RecentWidget'
import { QuickLinksWidget } from './widgets/QuickLinksWidget'
import { WidgetManager } from './widgets/WidgetManager'
import { BaseWidget, WidgetLabel, WidgetEmpty } from './widgets/BaseWidget'
import { SandboxWidgetPanel } from '@/components/widgets/SandboxWidgetPanel'
import type { SandboxHandlerDependencies, WriteCallbacks } from '@/lib/widgets/use-sandbox-handlers'
import type { SandboxConfig } from '@/lib/panels/panel-manifest'

export interface DashboardWidgetRendererProps {
  /** The panel data */
  panel: WorkspacePanel
  /** Double-click handler to open full panel drawer */
  onDoubleClick: (panel: WorkspacePanel) => void
  /** Whether this panel is currently active/selected */
  isActive?: boolean
  /** Mouse down handler for drag initiation */
  onMouseDown?: (e: React.MouseEvent) => void
  /** Callback when panel config changes */
  onConfigChange?: (config: Partial<PanelConfig>) => void
  /** All panels (for sandbox widget handlers) */
  allPanels?: WorkspacePanel[]
  /** Active panel ID (for sandbox widget handlers) */
  activePanelId?: string | null
  // Phase 3.3: Write operation callbacks for sandbox widgets
  /** Focus a panel by ID */
  onFocusPanel?: (panelId: string) => void
  /** Close a panel by ID */
  onClosePanel?: (panelId: string) => void
}

/**
 * Renders the appropriate widget component based on panel type.
 * Falls back to a generic widget for types without dedicated widget components.
 */
export function DashboardWidgetRenderer({
  panel,
  onDoubleClick,
  isActive = false,
  onMouseDown,
  onConfigChange,
  allPanels = [],
  activePanelId = null,
  onFocusPanel,
  onClosePanel,
}: DashboardWidgetRendererProps) {
  const handleDoubleClick = () => onDoubleClick(panel)

  // Build sandbox handler dependencies from available state
  // Phase 3.2: Read-only handlers only (notes.currentNote is null at dashboard level)
  const sandboxDependencies: SandboxHandlerDependencies = {
    workspace: {
      panels: allPanels,
      activePanelId,
    },
    notes: {
      currentNote: null, // Dashboard doesn't have note context
      getNoteById: undefined, // Could be wired up later if needed
    },
  }

  // Phase 3.3: Build write callbacks for sandbox widgets
  const writeCallbacks: WriteCallbacks = useMemo(() => ({
    workspace: {
      openPanel: async (panelId: string) => {
        // Dashboard doesn't support opening arbitrary panels by ID
        // This would require panel creation logic
        console.warn('[DashboardWidgetRenderer] openPanel not supported in dashboard mode')
        return false
      },
      closePanel: async (panelId: string) => {
        if (onClosePanel) {
          onClosePanel(panelId)
          return true
        }
        return false
      },
      focusPanel: async (panelId: string) => {
        if (onFocusPanel) {
          onFocusPanel(panelId)
          return true
        }
        return false
      },
    },
    notes: {
      // Notes operations require API calls - not available in dashboard context
      updateNote: async () => {
        console.warn('[DashboardWidgetRenderer] notes.updateNote not supported in dashboard mode')
        return false
      },
      createNote: async () => {
        console.warn('[DashboardWidgetRenderer] notes.createNote not supported in dashboard mode')
        return null
      },
      deleteNote: async () => {
        console.warn('[DashboardWidgetRenderer] notes.deleteNote not supported in dashboard mode')
        return false
      },
    },
    chat: {
      // Chat operations not available in dashboard context
      sendMessage: async () => {
        console.warn('[DashboardWidgetRenderer] chat.sendMessage not supported in dashboard mode')
        return null
      },
    },
  }), [onClosePanel, onFocusPanel])

  switch (panel.panelType) {
    case 'recent':
      return (
        <RecentWidget
          panel={panel}
          onDoubleClick={handleDoubleClick}
          isActive={isActive}
          onMouseDown={onMouseDown}
        />
      )

    case 'links_note':
    case 'links_note_tiptap':
      return (
        <QuickLinksWidget
          panel={panel}
          onDoubleClick={handleDoubleClick}
          isActive={isActive}
          onMouseDown={onMouseDown}
        />
      )

    // Note: Demo widget was removed as a built-in
    // Install as custom widget via: http://localhost:3000/api/widgets/demo-manifest

    case 'widget_manager':
      return (
        <WidgetManager
          panel={panel}
          onDoubleClick={handleDoubleClick}
          isActive={isActive}
          onMouseDown={onMouseDown}
        />
      )

    case 'sandbox_widget': {
      // Sandbox widget requires widget metadata in panel config
      const config = panel.config as {
        widgetId?: string
        instanceId?: string
        sandbox?: SandboxConfig
      }

      if (!config.widgetId || !config.instanceId || !config.sandbox) {
        // Missing required config - show error widget
        return (
          <BaseWidget
            panel={panel}
            onDoubleClick={handleDoubleClick}
            isActive={isActive}
            onMouseDown={onMouseDown}
          >
            <WidgetLabel>WIDGET ERROR</WidgetLabel>
            <WidgetEmpty>
              Missing widget configuration
            </WidgetEmpty>
          </BaseWidget>
        )
      }

      return (
        <BaseWidget
          panel={panel}
          onDoubleClick={handleDoubleClick}
          isActive={isActive}
          onMouseDown={onMouseDown}
        >
          <SandboxWidgetPanel
            widgetId={config.widgetId}
            widgetInstanceId={config.instanceId}
            title={panel.title || 'Widget'}
            sandbox={config.sandbox}
            dependencies={sandboxDependencies}
            writeCallbacks={writeCallbacks}
            className="w-full h-full"
          />
        </BaseWidget>
      )
    }

    // TODO: Add more widget types as they are created
    // case 'continue':
    //   return <ContinueWidget ... />
    // case 'quick_capture':
    //   return <QuickCaptureWidget ... />
    // case 'category':
    //   return <CategoryWidget ... />

    default:
      // Fallback: render a generic widget placeholder for types without widgets yet
      return (
        <GenericWidget
          panel={panel}
          onDoubleClick={handleDoubleClick}
          isActive={isActive}
          onMouseDown={onMouseDown}
        />
      )
  }
}

/**
 * Generic widget fallback for panel types without dedicated widget components.
 * Shows panel type and a hint to double-click.
 */
function GenericWidget({
  panel,
  onDoubleClick,
  isActive,
  onMouseDown,
}: {
  panel: WorkspacePanel
  onDoubleClick: () => void
  isActive?: boolean
  onMouseDown?: (e: React.MouseEvent) => void
}) {
  // Generate label from panel type
  const getLabel = () => {
    switch (panel.panelType) {
      case 'continue':
        return 'CONTINUE'
      case 'quick_capture':
        return 'QUICK CAPTURE'
      case 'navigator':
        return 'NAVIGATOR'
      case 'category':
        return 'CATEGORY'
      case 'category_navigator':
        return 'CATEGORIES'
      case 'note':
        return 'NOTE'
      default:
        return panel.panelType.toUpperCase().replace(/_/g, ' ')
    }
  }

  return (
    <BaseWidget
      panel={panel}
      onDoubleClick={onDoubleClick}
      isActive={isActive}
      onMouseDown={onMouseDown}
    >
      <WidgetLabel>{getLabel()}</WidgetLabel>
      <WidgetEmpty>
        {panel.title || 'Double-click to open'}
      </WidgetEmpty>
    </BaseWidget>
  )
}

export default DashboardWidgetRenderer
