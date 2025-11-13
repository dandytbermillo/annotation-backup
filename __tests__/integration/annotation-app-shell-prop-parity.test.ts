/**
 * Smoke test helper: verifies the workspace view prop contract serializer keeps
 * shell vs. legacy paths comparable without depending on runtime rendering.
 *
 * When the shell wiring diverges, this test should be augmented to capture the
 * real props emitted by both code paths before asserting parity.
 */

import React from "react"

import type { AnnotationWorkspaceViewProps } from "@/components/annotation-workspace-view/types"
import type { WorkspaceToolbarStripProps } from "@/components/workspace/workspace-toolbar-strip"
import type { WorkspaceSidebarProps } from "@/components/workspace/workspace-sidebar"
import type { CanvasSidebarTab } from "@/components/sidebar/canvas-sidebar"
import {
  compareAnnotationWorkspaceViewProps,
} from "@/lib/testing/annotation-workspace-view-props"

const noop = () => {}

function buildSidebarProps(): WorkspaceSidebarProps {
  const activeTab: CanvasSidebarTab = "organization"

  return {
    visible: true,
    showConstellationPanel: false,
    activeTab,
    onTabChange: noop,
    organizationItems: [
      { id: "folder-1", name: "Research", count: 2, icon: "📁" },
      { id: "note-1", name: "North Star Brief", count: 1, icon: "📝", type: "note" },
    ],
    organizationStats: {
      openPopups: 1,
      pinnedPopups: 0,
      totalItems: 2,
    },
    onOrganizationSelect: noop,
    onOrganizationEyeHover: noop,
    onOrganizationEyeLeave: noop,
    onOrganizationNoteHover: noop,
    onOrganizationNoteLeave: noop,
    constellationContent: React.createElement("div", null, "Constellation panel"),
  }
}

function buildToolbarProps(timestamp = "2025-01-01T00:00:00.000Z"): WorkspaceToolbarStripProps {
  return {
    isVisible: true,
    notes: [
      { noteId: "note-1", updatedAt: timestamp },
      { noteId: "note-2", updatedAt: timestamp },
    ],
    activeNoteId: "note-1",
    isLoading: false,
    formatNoteLabel: noteId => `Note ${noteId}`,
    onActivateNote: noop,
    onCenterNote: noop,
    onCloseNote: noop,
    onNewNote: noop,
    onSettings: noop,
  }
}

function buildBaseProps(): AnnotationWorkspaceViewProps {
  return {
    sidebarProps: buildSidebarProps(),
    toolbarProps: buildToolbarProps(),
    workspaceToggle: React.createElement("div", null, "Toggle"),
    canvasProps: {
      showConstellationPanel: false,
      isPopupLayerActive: true,
      hasOpenNotes: true,
      canvas: React.createElement("div", null, "Canvas"),
    },
    workspaceLayers: React.createElement("div", null, "Layers"),
    floatingToolbar: React.createElement("div", null, "Floating toolbar"),
    constellationPanel: React.createElement("div", null, "Constellation overlay"),
    onMainAreaContextMenu: noop,
  }
}

describe("AnnotationWorkspaceView contract serialization", () => {
  it("treats identical contract data as equal", () => {
    const legacy = buildBaseProps()
    const shell = buildBaseProps()

    const result = compareAnnotationWorkspaceViewProps(legacy, shell)
    expect(result.isEqual).toBe(true)
  })

  it("detects contract drift when payloads differ", () => {
    const legacy = buildBaseProps()
    const shell = {
      ...buildBaseProps(),
      toolbarProps: {
        ...buildToolbarProps(),
        notes: [
          { noteId: "note-1", updatedAt: "2025-01-01T00:00:00.000Z" },
          { noteId: "note-2", updatedAt: "2025-01-01T00:00:00.000Z" },
          { noteId: "note-3", updatedAt: "2025-01-01T00:00:00.000Z" },
        ],
      },
    }

    const result = compareAnnotationWorkspaceViewProps(legacy, shell)
    expect(result.isEqual).toBe(false)
    expect(
      (result.shell.toolbarProps as any)?.notes?.length,
    ).toBe(3)
  })
})
