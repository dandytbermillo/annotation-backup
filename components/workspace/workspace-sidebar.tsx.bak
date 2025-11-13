"use client"

import type { MouseEvent, ReactNode } from "react"

import { CanvasSidebar, type CanvasSidebarTab } from "@/components/sidebar/canvas-sidebar"
import {
  OrganizationSidebarContent,
  type OrganizationSidebarItem,
  type OrganizationSidebarStats,
} from "@/components/sidebar/organization-sidebar-content"

type WorkspaceSidebarProps = {
  visible: boolean
  showConstellationPanel: boolean
  activeTab: CanvasSidebarTab
  onTabChange: (tab: CanvasSidebarTab) => void
  organizationItems: OrganizationSidebarItem[]
  organizationStats: OrganizationSidebarStats
  onOrganizationSelect: (id: string, rect: DOMRect) => void
  onOrganizationEyeHover: (item: OrganizationSidebarItem, event: MouseEvent<HTMLButtonElement>) => void
  onOrganizationEyeLeave: (id: string) => void
  onOrganizationNoteHover: (item: OrganizationSidebarItem, event: MouseEvent<HTMLButtonElement>) => void
  onOrganizationNoteLeave: () => void
  constellationContent?: ReactNode
}

export function WorkspaceSidebar({
  visible,
  showConstellationPanel,
  activeTab,
  onTabChange,
  organizationItems,
  organizationStats,
  onOrganizationSelect,
  onOrganizationEyeHover,
  onOrganizationEyeLeave,
  onOrganizationNoteHover,
  onOrganizationNoteLeave,
  constellationContent,
}: WorkspaceSidebarProps) {
  if (!visible) {
    return null
  }

  return (
    <div
      data-sidebar="sidebar"
      className="h-full"
      style={{ position: showConstellationPanel ? "absolute" : "relative", zIndex: 50 }}
    >
      <CanvasSidebar
        activeTab={activeTab}
        onTabChange={onTabChange}
        showWorkspaceTab={false}
        constellationContent={constellationContent}
        organizationContent={
          <OrganizationSidebarContent
            items={organizationItems}
            stats={organizationStats}
            onSelect={onOrganizationSelect}
            onEyeHover={onOrganizationEyeHover}
            onEyeLeave={onOrganizationEyeLeave}
            onNoteHover={onOrganizationNoteHover}
            onNoteLeave={onOrganizationNoteLeave}
          />
        }
      />
    </div>
  )
}
