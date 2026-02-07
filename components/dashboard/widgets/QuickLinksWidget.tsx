"use client"

/**
 * Quick Links Widget Component
 * Part of Widget Architecture - Compact summary of workspace links
 *
 * Shows:
 * - Label with badge (e.g., "QUICK LINKS A")
 * - List of workspace links (up to 4)
 * - macOS widget style (no header/footer)
 */

import React, { useMemo, useEffect } from 'react'
import { Link2 } from 'lucide-react'
import type { WorkspacePanel, PanelConfig } from '@/lib/dashboard/panel-registry'
import { usePanelChatVisibility } from '@/lib/hooks/use-panel-chat-visibility'
import { upsertWidgetState, removeWidgetState } from '@/lib/widgets/widget-state-store'
import { registerWidgetSnapshot, unregisterWidgetSnapshot } from '@/lib/widgets/ui-snapshot-registry'
import {
  BaseWidget,
  WidgetLabel,
  WidgetList,
  WidgetListItem,
  WidgetEmpty,
} from './BaseWidget'

/** Number of links to show in widget summary */
const WIDGET_LINK_LIMIT = 4

interface ParsedLink {
  workspaceId: string
  workspaceName: string
  entryId?: string
}

export interface QuickLinksWidgetProps {
  /** The panel data */
  panel: WorkspacePanel
  /** Double-click handler to open full panel drawer */
  onDoubleClick: () => void
  /** Whether this widget is currently active/selected */
  isActive?: boolean
  /** Mouse down handler for drag initiation */
  onMouseDown?: (e: React.MouseEvent) => void
}

/**
 * Extract workspace links from TipTap HTML content.
 * Looks for <span data-quick-link="true" data-workspace-id="..." data-workspace-name="...">
 */
function parseLinksFromContent(content: string | undefined): ParsedLink[] {
  if (!content) return []

  const links: ParsedLink[] = []
  const seen = new Set<string>() // Deduplicate by workspaceId

  // Match quick link spans with data attributes
  // Pattern: data-quick-link="true" ... data-workspace-id="..." data-workspace-name="..."
  const regex = /data-workspace-id="([^"]+)"[^>]*data-workspace-name="([^"]*)"/g
  let match

  while ((match = regex.exec(content)) !== null) {
    const workspaceId = match[1]
    const workspaceName = match[2] || 'Unnamed'

    if (!seen.has(workspaceId)) {
      seen.add(workspaceId)
      links.push({ workspaceId, workspaceName })
    }
  }

  return links
}

/**
 * Get first letter/emoji for link icon
 */
function getLinkIcon(name: string): string {
  // Check if first char is emoji (basic check)
  const firstChar = name.charAt(0)
  if (firstChar.match(/[\u{1F300}-\u{1F9FF}]/u)) {
    return firstChar
  }
  return firstChar.toUpperCase()
}

function deriveChatPanelId(panel: WorkspacePanel): string | null {
  if (panel.badge) {
    return `quick-links-${panel.badge.toLowerCase()}`
  }
  const title = panel.title || ''
  const match = title.match(/quick\s*links?\s*([a-z])/i)
  if (match) {
    return `quick-links-${match[1].toLowerCase()}`
  }
  return null
}

export function QuickLinksWidget({
  panel,
  onDoubleClick,
  isActive = false,
  onMouseDown,
}: QuickLinksWidgetProps) {
  const config = panel.config as PanelConfig
  const badge = panel.badge
  const chatPanelId = useMemo(() => deriveChatPanelId(panel), [panel])

  // Chat visibility integration (single hook replaces ~15 lines of boilerplate)
  usePanelChatVisibility(chatPanelId, isActive)

  // Parse links from content
  const links = useMemo(() => {
    return parseLinksFromContent(config.content)
  }, [config.content])

  // Widget Chat State: Report internal state for LLM context
  useEffect(() => {
    const widgetTitle = panel.title || (badge ? `Links Panel ${badge}` : 'Links Panel')
    const summary = links.length === 0
      ? 'No links configured'
      : `Showing ${Math.min(links.length, WIDGET_LINK_LIMIT)} of ${links.length} links`

    // Derive unique widget ID from badge (e.g., "w_links_d" for badge "D")
    const widgetId = badge ? `w_links_${badge.toLowerCase()}` : 'w_links'

    upsertWidgetState({
      _version: 1,
      widgetId: 'quick-links',
      instanceId: panel.id,
      title: widgetTitle,
      view: 'list',
      selection: null,
      summary,
      updatedAt: Date.now(),
      counts: { total: links.length, visible: Math.min(links.length, WIDGET_LINK_LIMIT) },
    })

    // Widget UI Snapshot: Register structured snapshot for routing (Layer 1)
    // Re-registration function for heartbeat (keeps snapshot fresh for routing)
    const registerSnapshot = () => {
      registerWidgetSnapshot({
        _version: 1,
        widgetId,
        title: widgetTitle,
        panelId: panel.id,
        isVisible: true,
        segments: [
          {
            segmentId: `${widgetId}:list`,
            segmentType: 'list',
            listLabel: widgetTitle,
            badgesEnabled: !!badge,
            visibleItemRange: { start: 0, end: Math.min(links.length, WIDGET_LINK_LIMIT) },
            items: links.slice(0, WIDGET_LINK_LIMIT).map((link) => ({
              itemId: link.workspaceId,
              label: link.workspaceName,
              badge: badge || undefined,
              badgeVisible: !!badge,
              actions: ['open'],
            })),
          },
          {
            segmentId: `${widgetId}:context`,
            segmentType: 'context',
            summary,
            currentView: 'list',
          },
        ],
        registeredAt: Date.now(),
      })
    }

    // Register immediately
    registerSnapshot()

    // Heartbeat: re-register every 30s to stay under the 60s freshness threshold
    const heartbeatInterval = setInterval(registerSnapshot, 30_000)

    return () => {
      clearInterval(heartbeatInterval)
      removeWidgetState(panel.id)
      unregisterWidgetSnapshot(widgetId)
    }
  }, [panel.id, badge, links.length, links])

  return (
    <BaseWidget
      panel={panel}
      onDoubleClick={onDoubleClick}
      isActive={isActive}
      onMouseDown={onMouseDown}
    >
      <WidgetLabel>
        {(badge ? `LINKS PANEL ${badge}` : (panel.title || 'LINKS PANEL')).toUpperCase()}
      </WidgetLabel>

      {links.length === 0 ? (
        <WidgetEmpty>No links yet</WidgetEmpty>
      ) : (
        <WidgetList>
          {links.slice(0, WIDGET_LINK_LIMIT).map((link) => (
            <WidgetListItem
              key={link.workspaceId}
              icon={<Link2 size={12} />}
            >
              {link.workspaceName}
            </WidgetListItem>
          ))}
          {links.length > WIDGET_LINK_LIMIT && (
            <WidgetListItem
              icon={<span className="text-[10px]">+</span>}
              className="text-gray-500"
            >
              {links.length - WIDGET_LINK_LIMIT} more
            </WidgetListItem>
          )}
        </WidgetList>
      )}
    </BaseWidget>
  )
}

export default QuickLinksWidget
