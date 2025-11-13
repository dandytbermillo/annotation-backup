"use client"

import { useMemo } from "react"
import type { ReactNode } from "react"

import { AnnotationWorkspaceView } from "@/components/annotation-workspace-view"
import type {
  AnnotationWorkspaceViewProps,
  WorkspaceCanvasViewProps,
} from "@/components/annotation-workspace-view/types"
import type { WorkspaceToolbarStripProps } from "@/components/workspace/workspace-toolbar-strip"
import type { WorkspaceSidebarProps } from "@/components/workspace/workspace-sidebar"
import type { CanvasSidebarTab } from "@/components/sidebar/canvas-sidebar"
import type {
  OrganizationSidebarItem,
  OrganizationSidebarStats,
} from "@/components/sidebar/organization-sidebar-content"

const noop = () => {}

function buildSidebarProps(): WorkspaceSidebarProps {
  const organizationItems: OrganizationSidebarItem[] = [
    { id: "folder-1", name: "Research", count: 4, icon: "📁", color: "#60a5fa" },
    { id: "note-1", name: "North Star Brief", count: 1, icon: "📝", type: "note" },
  ]

  const organizationStats: OrganizationSidebarStats = {
    openPopups: 2,
    totalItems: organizationItems.length,
    pinnedPopups: 1,
  }

  const activeTab: CanvasSidebarTab = "organization"

  return {
    visible: true,
    showConstellationPanel: false,
    activeTab,
    onTabChange: noop,
    organizationItems,
    organizationStats,
    onOrganizationSelect: noop,
    onOrganizationEyeHover: noop,
    onOrganizationEyeLeave: noop,
    onOrganizationNoteHover: noop,
    onOrganizationNoteLeave: noop,
    constellationContent: (
      <div className="p-4 text-xs text-white/60">Constellation placeholder</div>
    ),
  }
}

function buildToolbarProps(): WorkspaceToolbarStripProps {
  return {
    isVisible: true,
    notes: [
      { noteId: "note-1", updatedAt: new Date().toISOString() },
      { noteId: "note-2", updatedAt: new Date(Date.now() - 1000 * 60 * 5).toISOString() },
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

function buildCanvasProps(): WorkspaceCanvasViewProps {
  return {
    showConstellationPanel: false,
    isPopupLayerActive: true,
    hasOpenNotes: true,
    canvas: (
      <div className="flex h-full w-full items-center justify-center bg-neutral-900 text-neutral-400">
        Canvas snapshot
      </div>
    ),
  }
}

function MockLayerProvider({ children }: { children: ReactNode }) {
  return (
    <div
      data-layer-provider
      className="border border-dashed border-neutral-800 bg-neutral-950 text-neutral-200"
    >
      {children}
    </div>
  )
}

function MockCanvasWorkspaceProvider({ children }: { children: ReactNode }) {
  return <div data-canvas-workspace>{children}</div>
}

function MockConstellationProvider({ children }: { children: ReactNode }) {
  return <div data-constellation-provider>{children}</div>
}

export function AnnotationWorkspaceViewStory() {
  const props = useMemo<AnnotationWorkspaceViewProps>(
    () => ({
      sidebarProps: buildSidebarProps(),
      toolbarProps: buildToolbarProps(),
      workspaceToggle: (
        <div className="absolute left-4 top-4 rounded-full bg-neutral-900/80 px-3 py-1 text-xs text-white/70 shadow-lg">
          Shell mode
        </div>
      ),
      canvasProps: buildCanvasProps(),
      workspaceLayers: (
        <div className="pointer-events-none absolute inset-0 flex items-start justify-end p-6 text-xs text-white/40">
          Overlay placeholder
        </div>
      ),
      floatingToolbar: (
        <div className="pointer-events-auto absolute bottom-6 right-6 rounded-xl bg-blue-600/80 px-4 py-2 text-sm text-white shadow-xl">
          Floating toolbar
        </div>
      ),
      previewPortalProps: {
        preview: {
          noteId: "note-1",
          content: "Preview body for note-1",
          position: { x: 100, y: 100 },
        },
        isLoading: false,
        onOpenNote: noop,
        onDismiss: noop,
        onMouseEnter: noop,
        onMouseLeave: noop,
      },
      onMainAreaContextMenu: event => {
        event.preventDefault()
      },
    }),
    [],
  )

  return (
    <MockLayerProvider>
      <MockCanvasWorkspaceProvider>
        <MockConstellationProvider>
          <AnnotationWorkspaceView {...props} />
        </MockConstellationProvider>
      </MockCanvasWorkspaceProvider>
    </MockLayerProvider>
  )
}
