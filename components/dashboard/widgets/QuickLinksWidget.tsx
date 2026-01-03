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

import React, { useMemo } from 'react'
import { Link2 } from 'lucide-react'
import type { WorkspacePanel, PanelConfig } from '@/lib/dashboard/panel-registry'
import { usePanelChatVisibility } from '@/lib/hooks/use-panel-chat-visibility'
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

  return (
    <BaseWidget
      panel={panel}
      onDoubleClick={onDoubleClick}
      isActive={isActive}
      onMouseDown={onMouseDown}
    >
      <WidgetLabel>
        QUICK LINKS{badge && <span className="text-indigo-400 ml-1">{badge}</span>}
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
