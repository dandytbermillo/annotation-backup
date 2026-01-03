"use client"

/**
 * Demo Widget - Third-Party Widget Integration Example
 *
 * This widget demonstrates how widgets can integrate with the chat system.
 * The manifest is registered statically in panel-registry.ts (see demo-widget-panel.ts).
 *
 * Test commands:
 * - "show demo" → opens drawer (default behavior)
 * - "list demo items" or "preview demo" → shows in chat preview
 *
 * Note: For true third-party self-registration (no core code edits), a future
 * enhancement would pass client manifests to the server with each chat request.
 */

import React from 'react'
import { Sparkles } from 'lucide-react'
import { usePanelChatVisibility } from '@/lib/hooks/use-panel-chat-visibility'
import type { WorkspacePanel } from '@/lib/dashboard/panel-registry'
import {
  BaseWidget,
  WidgetLabel,
  WidgetValue,
  WidgetList,
  WidgetListItem,
} from './BaseWidget'

// Static panel ID - must match the manifest in demo-widget-panel.ts
const DEMO_WIDGET_PANEL_ID = 'demo-widget'

// =============================================================================
// Widget Component
// =============================================================================

export interface DemoWidgetProps {
  /** The panel data */
  panel: WorkspacePanel
  /** Double-click handler to open full panel drawer */
  onDoubleClick: () => void
  /** Whether this widget is currently active/selected */
  isActive?: boolean
  /** Mouse down handler for drag initiation */
  onMouseDown?: (e: React.MouseEvent) => void
}

// Mock data for the widget display
const DEMO_ITEMS = [
  { id: '1', name: 'Learn TypeScript', icon: '📚' },
  { id: '2', name: 'Build a widget', icon: '🔧' },
  { id: '3', name: 'Test chat integration', icon: '💬' },
]

export function DemoWidget({
  panel,
  onDoubleClick,
  isActive = false,
  onMouseDown,
}: DemoWidgetProps) {
  // Register with chat visibility system (no manifest needed - it's registered statically)
  usePanelChatVisibility(DEMO_WIDGET_PANEL_ID, isActive)

  return (
    <BaseWidget
      panel={panel}
      onDoubleClick={onDoubleClick}
      isActive={isActive}
      onMouseDown={onMouseDown}
    >
      <WidgetLabel>
        Demo Widget
        <Sparkles size={12} className="ml-1 text-yellow-400 inline" />
      </WidgetLabel>

      <WidgetValue unit="items">{DEMO_ITEMS.length}</WidgetValue>

      <WidgetList>
        {DEMO_ITEMS.map((item) => (
          <WidgetListItem key={item.id} icon={<span>{item.icon}</span>}>
            {item.name}
          </WidgetListItem>
        ))}
      </WidgetList>
    </BaseWidget>
  )
}

export default DemoWidget
