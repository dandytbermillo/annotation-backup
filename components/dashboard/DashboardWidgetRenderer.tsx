"use client"

/**
 * Dashboard Widget Renderer
 * Part of Widget Architecture - Routes panel types to widget components
 *
 * Routes each panel type to its corresponding widget component.
 * Falls back to BaseDashboardPanel for panel types without widgets yet.
 */

import React from 'react'
import type { WorkspacePanel, PanelConfig } from '@/lib/dashboard/panel-registry'
import { RecentWidget } from './widgets/RecentWidget'
import { QuickLinksWidget } from './widgets/QuickLinksWidget'
import { DemoWidget } from './widgets/DemoWidget'
import { WidgetManager } from './widgets/WidgetManager'
import { BaseWidget, WidgetLabel, WidgetEmpty } from './widgets/BaseWidget'

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
}: DashboardWidgetRendererProps) {
  const handleDoubleClick = () => onDoubleClick(panel)

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

    case 'demo':
      return (
        <DemoWidget
          panel={panel}
          onDoubleClick={handleDoubleClick}
          isActive={isActive}
          onMouseDown={onMouseDown}
        />
      )

    case 'widget_manager':
      return (
        <WidgetManager
          panel={panel}
          onDoubleClick={handleDoubleClick}
          isActive={isActive}
          onMouseDown={onMouseDown}
        />
      )

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
