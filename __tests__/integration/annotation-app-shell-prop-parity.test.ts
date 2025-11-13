import React from "react"
import { renderToString } from "react-dom/server"

import {
  compareAnnotationWorkspaceViewProps,
  serializeAnnotationWorkspaceViewProps,
} from "@/lib/testing/annotation-workspace-view-props"

const noop = () => {}

const windowMock: any = {
  addEventListener: jest.fn(),
  removeEventListener: jest.fn(),
  innerWidth: 1280,
  innerHeight: 720,
  requestAnimationFrame: (cb: FrameRequestCallback) => {
    const id = setTimeout(() => cb(0), 0)
    return id as unknown as number
  },
  cancelAnimationFrame: (id: number) => clearTimeout(id),
  localStorage: {
    getItem: jest.fn(() => null),
    setItem: jest.fn(),
    removeItem: jest.fn(),
  },
  navigator: { userAgent: "node" },
}

;(globalThis as any).window = windowMock
;(globalThis as any).document = {
  addEventListener: jest.fn(),
  removeEventListener: jest.fn(),
  body: {
    appendChild: jest.fn(),
    removeChild: jest.fn(),
  },
  createElement: jest.fn(() => ({
    style: {},
    classList: { add: jest.fn(), remove: jest.fn() },
  })),
}
;(globalThis as any).localStorage = windowMock.localStorage
jest.mock("@/styles/popup-overlay.css", () => ({}), { virtual: true })
const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {})
const consoleLogSpy = jest.spyOn(console, "log").mockImplementation(() => {})

afterAll(() => {
  consoleErrorSpy.mockRestore()
  consoleLogSpy.mockRestore()
})

// Components
jest.mock("../../components/canvas-aware-floating-toolbar", () => ({
  CanvasAwareFloatingToolbar: () => null,
}))

jest.mock("../../components/workspace/workspace-toggle-menu", () => ({
  WorkspaceToggleMenu: (props: any) =>
    React.createElement("div", { "data-mock": "workspace-toggle", ...props }),
}))

jest.mock("../../components/workspace/annotation-workspace-canvas", () => ({
  AnnotationWorkspaceCanvas: (props: any) =>
    React.createElement("div", { "data-mock": "workspace-canvas", ...props }),
}))

jest.mock("../../components/workspace/workspace-constellation-layer", () => ({
  WorkspaceConstellationLayer: () => null,
}))

jest.mock("../../components/annotation-workspace-view", () => ({
  AnnotationWorkspaceView: () => null,
}))

// Providers & contexts
jest.mock("../../components/canvas/layer-provider", () => ({
  LayerProvider: ({ children }: { children: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
  useLayer: () => ({
    activeLayer: "notes",
    setActiveLayer: jest.fn(),
    transforms: { popups: { x: 0, y: 0, scale: 1 } },
  }),
}))

jest.mock("../../components/canvas/canvas-workspace-context", () => {
  const mockWorkspace = { id: "shared", name: "Shared" }
  return {
    SHARED_WORKSPACE_ID: "shared",
    CanvasWorkspaceProvider: ({ children }: { children: React.ReactNode }) =>
      React.createElement(React.Fragment, null, children),
    useCanvasWorkspace: () => ({
      openNotes: [{ noteId: "note-1", updatedAt: "2025-01-01T00:00:00.000Z" }],
      openNote: noop,
      closeNote: noop,
      isWorkspaceReady: true,
      isWorkspaceLoading: false,
      isHydrating: false,
      workspaceError: null,
      refreshWorkspace: noop,
      getPendingPosition: noop,
      getCachedPosition: noop,
      getWorkspace: () => mockWorkspace,
    }),
  }
})

jest.mock("@/hooks/useNotePreviewHover", () => ({
  useNotePreviewHover: () => ({
    preview: null,
    isLoading: false,
    handleHover: jest.fn(),
    handleLeave: jest.fn(),
    handleTooltipEnter: jest.fn(),
    handleTooltipLeave: jest.fn(),
    cancelPreview: jest.fn(),
  }),
}))

jest.mock("@/lib/hooks/annotation/use-canvas-centering", () => ({
  useCanvasCentering: () => ({
    canvasRef: {
      current: {
        zoomIn: jest.fn(),
        zoomOut: jest.fn(),
        resetView: jest.fn(),
        toggleConnections: jest.fn(),
        addComponent: jest.fn(),
      },
    },
    freshNoteSeeds: {},
    freshNoteIds: [],
    registerFreshNote: jest.fn(),
    consumeFreshNoteSeed: jest.fn(),
    storeFreshNoteSeed: jest.fn(),
    handleFreshNoteHydrated: jest.fn(),
    handleSnapshotLoadComplete: jest.fn(),
    centerNoteOnCanvas: jest.fn(),
  }),
}))

jest.mock("@/lib/hooks/annotation/use-knowledge-base-workspace", () => ({
  useKnowledgeBaseWorkspace: () => ({
    workspaceId: "ws-1",
    appendWorkspaceParam: (url: string) => url,
    withWorkspaceHeaders: jest.fn((headers: Record<string, string>) => headers),
    withWorkspacePayload: jest.fn((payload: Record<string, unknown>) => payload),
    fetchWithWorkspace: jest.fn(async () => ({
      ok: true,
      json: async () => ({ item: { content: "body", contentText: "text" } }),
    })),
    resolveWorkspaceId: jest.fn(() => "ws-1"),
  }),
}))

jest.mock("@/lib/hooks/annotation/use-folder-cache", () => ({
  useFolderCache: () => ({
    getEntry: jest.fn(),
    updateFolderSnapshot: jest.fn(),
    updateChildrenSnapshot: jest.fn(),
    invalidate: jest.fn(),
    fetchFolder: jest.fn(),
    fetchChildren: jest.fn(),
  }),
}))

jest.mock("@/lib/hooks/annotation/use-popup-overlay-state", () => ({
  usePopupOverlayState: () => ({
    popups: [
      {
        id: "popup-1",
        folderId: "folder-1",
        folderName: "Folder",
        children: [],
        width: 320,
        height: 240,
        canvasPosition: { x: 0, y: 0 },
        parentPopupId: null,
        isPinned: false,
      },
    ],
    setPopups: jest.fn(),
    draggingPopup: null,
    setDraggingPopup: jest.fn(),
    overlayPanning: false,
    setOverlayPanning: jest.fn(),
    moveCascadeState: { parentId: null, childIds: [] },
    hoverTimeouts: new Set(),
    closeTimeouts: new Set(),
    setHoverTimeout: jest.fn(),
    clearHoverTimeout: jest.fn(),
    setCloseTimeout: jest.fn(),
    clearCloseTimeout: jest.fn(),
    clearAllTimeouts: jest.fn(),
    handlePopupDragStart: jest.fn(),
    handlePopupDragMove: jest.fn(),
    handlePopupDragEnd: jest.fn(),
    getAllDescendants: jest.fn(() => []),
    toggleMoveCascade: jest.fn(),
    clearMoveCascadeState: jest.fn(),
    closePopupCascade: jest.fn(),
    initiateCloseMode: jest.fn(),
    confirmCloseMode: jest.fn(),
    cancelCloseMode: jest.fn(),
    togglePinCascade: jest.fn(),
    handleFolderHover: jest.fn(),
    handleFolderHoverLeave: jest.fn(),
  }),
}))

jest.mock("@/lib/hooks/annotation/use-overlay-popup-layout", () => ({
  useOverlayPopupLayout: () => ({
    createOverlayPopup: jest.fn(),
    updatePopupPosition: jest.fn(),
    resizePopup: jest.fn(),
  }),
}))

jest.mock("@/lib/hooks/annotation/use-popup-bulk-actions", () => ({
  usePopupBulkActions: () => ({
    handleDeleteSelected: jest.fn(),
    handleBulkMove: jest.fn(),
  }),
}))

jest.mock("@/lib/hooks/annotation/use-overlay-drag-handlers", () => ({
  useOverlayDragHandlers: () => false,
}))

jest.mock("@/lib/hooks/annotation/use-overlay-persistence-refs", () => ({
  useOverlayPersistenceRefs: () => ({
    overlayAdapterRef: { current: null },
    layoutLoadedRef: { current: true },
    layoutRevisionRef: { current: 1 },
    lastSavedLayoutHashRef: { current: null },
    pendingLayoutRef: { current: null },
    saveInFlightRef: { current: null },
    saveTimeoutRef: { current: null },
    isInitialLoadRef: { current: false },
  }),
}))

jest.mock("@/lib/hooks/annotation/use-overlay-layout-persistence", () => ({
  useOverlayLayoutPersistence: () => ({
    applyOverlayLayout: jest.fn(),
  }),
}))

jest.mock("@/lib/hooks/annotation/use-overlay-layout-save-queue", () => ({
  useOverlayLayoutSaveQueue: () => ({
    buildLayoutPayload: jest.fn(() => ({ popups: [] })),
    flushLayoutSave: jest.fn(),
    scheduleLayoutSave: jest.fn(),
    overlayAdapterRef: { current: null },
    layoutRevisionRef: { current: 1 },
    lastSavedLayoutHashRef: { current: null },
    pendingLayoutRef: { current: null },
    saveTimeoutRef: { current: null },
    saveInFlightRef: { current: null },
    layoutLoadedRef: { current: true },
  }),
}))

jest.mock("@/lib/hooks/annotation/use-workspace-overlay-persistence", () => ({
  useWorkspaceOverlayPersistence: () => undefined,
}))

jest.mock("@/lib/hooks/annotation/use-overlay-workspaces", () => ({
  useOverlayWorkspaces: () => ({
    workspaces: [{ id: "ws-1", name: "Workspace 1" }],
    isWorkspaceListLoading: false,
    isWorkspaceSaving: false,
    workspaceDeletionId: null,
    workspaceMenuOpen: false,
    workspaceToggleRef: { current: null },
    setWorkspaceMenuOpen: jest.fn(),
    handleWorkspaceSelect: jest.fn(),
    handleCreateWorkspace: jest.fn(),
    handleDeleteWorkspace: jest.fn(),
  }),
}))

jest.mock("@/lib/hooks/annotation/use-workspace-sidebar-hover", () => ({
  useWorkspaceSidebarHover: () => ({
    hoverHandlers: {
      sidebarFolderPopups: [],
      dismissSidebarPopup: jest.fn(),
      handleSidebarPopupHover: jest.fn(),
      handleSidebarEyeHoverLeave: jest.fn(),
      handleSidebarOrgEyeHover: jest.fn(),
      handleSidebarNotePreviewHover: jest.fn(),
      handleSidebarNotePreviewLeave: jest.fn(),
      handleSidebarPreviewTooltipEnter: jest.fn(),
      handleSidebarPreviewTooltipLeave: jest.fn(),
      handleSidebarPopupFolderClick: jest.fn(),
      handleSidebarNoteOpen: jest.fn(),
    },
    sidebarPreviewProps: {
      popups: [],
      onPopupHover: jest.fn(),
      onPopupLeave: jest.fn(),
      onDismiss: jest.fn(),
      onFolderHover: jest.fn(),
      onFolderClick: jest.fn(),
      onNotePreviewHover: jest.fn(),
      onNotePreviewLeave: jest.fn(),
      onNoteOpen: jest.fn(),
    },
  }),
}))

jest.mock("@/lib/hooks/annotation/use-workspace-notes-widget", () => ({
  useWorkspaceNotesWidget: () => ({
    showNotesWidget: false,
    setShowNotesWidget: jest.fn(),
    notesWidgetPosition: { x: 100, y: 100 },
    setNotesWidgetPosition: jest.fn(),
    activeEditorRef: { current: null },
    activePanelId: null,
    setActivePanelId: jest.fn(),
    toolbarActivePanel: null,
    setToolbarActivePanel: jest.fn(),
    recentNotesRefreshTrigger: 0,
    bumpRecentNotesRefresh: jest.fn(),
    showAddComponentMenu: false,
    setShowAddComponentMenu: jest.fn(),
    handleContextMenu: jest.fn(),
  }),
}))

jest.mock("@/lib/hooks/annotation/use-constellation-view-state", () => ({
  useConstellationViewState: () => ({
    activeSidebarTab: "organization",
    showConstellationPanel: false,
    canvasMode: "default",
    setCanvasMode: jest.fn(),
    handleSidebarTabChange: jest.fn(),
    toggleConstellationView: jest.fn(),
  }),
}))

jest.mock("@/lib/hooks/annotation/use-organization-sidebar-actions", () => ({
  useOrganizationSidebarActions: () => ({
    handleOrganizationSidebarSelect: jest.fn(),
  }),
}))

jest.mock("@/hooks/useConstellation", () => ({
  useConstellation: () => ({
    isLoading: false,
    constellations: [],
    arcs: [],
    crossConstellationConnections: [],
    refreshConstellations: jest.fn(),
  }),
}))

jest.mock("@/lib/hooks/annotation/use-knowledge-base-sidebar", () => ({
  useKnowledgeBaseSidebar: () => ({
    organizationSidebarData: {
      organizationFolders: [],
      items: [],
      stats: { openPopups: 0, totalItems: 0, pinnedPopups: 0 },
    },
    sidebarState: {
      organizationFolders: [],
    },
    knowledgeBaseId: "kb-1",
    noteTitleMapRef: { current: new Map() },
    forceNoteTitleUpdate: jest.fn(),
    setTitleForNote: jest.fn(),
    ensureTitleFromServer: jest.fn(),
  }),
}))

jest.mock("@/lib/hooks/annotation/use-workspace-note-title-sync", () => ({
  useWorkspaceNoteTitleSync: () => undefined,
}))

jest.mock("@/lib/hooks/annotation/use-workspace-panel-positions", () => ({
  useWorkspacePanelPositions: () => ({
    logWorkspaceNotePositions: jest.fn(),
    resolveMainPanelPosition: jest.fn(),
    hasRenderedMainPanel: { current: true },
  }),
}))

jest.mock("@/lib/hooks/annotation/use-workspace-note-selection", () => ({
  useWorkspaceNoteSelection: () => ({
    handleNoteSelect: jest.fn(),
    handleCloseNote: jest.fn(),
    handleCenterNote: jest.fn(),
  }),
}))

jest.mock("@/lib/hooks/annotation/use-workspace-main-only-notes", () => ({
  useWorkspaceMainOnlyNotes: () => ({
    mainOnlyNotes: [],
    requestMainOnlyNote: jest.fn(),
    handleMainOnlyLayoutHandled: jest.fn(),
  }),
}))

jest.mock("@/lib/hooks/annotation/use-workspace-canvas-state", () => ({
  useWorkspaceCanvasState: () => ({
    canvasState: { zoom: 1, showConnections: true, translateX: 0, translateY: 0 },
    setCanvasState: jest.fn(),
    handleCanvasStateChange: jest.fn(),
    lastCanvasInteractionRef: { current: null },
    reopenSequenceRef: { current: { count: 0, lastTimestamp: 0 } },
    newNoteSequenceRef: { current: { count: 0, lastTimestamp: 0 } },
  }),
}))

jest.mock("@/lib/hooks/annotation/use-workspace-overlay-interactions", () => ({
  useWorkspaceOverlayInteractions: () => ({
    handleFolderCreated: jest.fn(),
    handlePopupDragStart: jest.fn(),
    handlePopupHover: jest.fn(),
    handleFolderRenamed: jest.fn(),
  }),
}))

jest.mock("@/lib/hooks/annotation/use-workspace-sidebar-state", () => ({
  useWorkspaceSidebarState: () => ({
    workspaceSidebarProps: {
      visible: true,
      showConstellationPanel: false,
      activeTab: "organization",
      onTabChange: jest.fn(),
      organizationItems: [],
      organizationStats: { openPopups: 0, totalItems: 0, pinnedPopups: 0 },
      onOrganizationSelect: jest.fn(),
      onOrganizationEyeHover: jest.fn(),
      onOrganizationEyeLeave: jest.fn(),
      onOrganizationNoteHover: jest.fn(),
      onOrganizationNoteLeave: jest.fn(),
    },
  }),
}))

jest.mock("@/lib/hooks/annotation/use-workspace-preview-portal", () => ({
  useWorkspacePreviewPortal: () => ({
    preview: null,
    isLoading: false,
    onOpenNote: jest.fn(),
    onDismiss: jest.fn(),
    onMouseEnter: jest.fn(),
    onMouseLeave: jest.fn(),
  }),
}))

jest.mock("@/lib/hooks/annotation/use-workspace-floating-toolbar", () => ({
  useWorkspaceFloatingToolbar: () => ({
    floatingToolbarProps: {
      visible: true,
      onClose: jest.fn(),
    },
    floatingToolbarVisible: false,
  }),
}))

jest.mock("@/lib/hooks/annotation/use-workspace-overlay-props", () => ({
  useWorkspaceOverlayProps: () => ({
    shouldRender: true,
    popups: new Map(),
    draggingPopup: null,
    onClosePopup: jest.fn(),
    onInitiateClose: jest.fn(),
    onConfirmClose: jest.fn(),
    onCancelClose: jest.fn(),
    onTogglePin: jest.fn(),
    onDragStart: jest.fn(),
    onHoverFolder: jest.fn(),
    onLeaveFolder: jest.fn(),
    onPopupHover: jest.fn(),
    onSelectNote: jest.fn(),
    onDeleteSelected: jest.fn(),
    onBulkMove: jest.fn(),
    onFolderCreated: jest.fn(),
    onFolderRenamed: jest.fn(),
    onPopupCardClick: jest.fn(),
    onContextMenu: jest.fn(),
    onPopupPositionChange: jest.fn(),
    onResizePopup: jest.fn(),
    isLocked: false,
    sidebarOpen: false,
    backdropStyle: "opaque",
    workspaceId: "ws-1",
    knowledgeBaseWorkspace: {},
    activeMoveCascadeParentId: null,
    moveCascadeChildIds: [],
    onToggleMoveCascade: jest.fn(),
    moveCascadeState: { parentId: null, childIds: [] },
    onClearMoveCascadeState: jest.fn(),
  }),
}))

jest.mock("@/lib/hooks/annotation/use-workspace-toolbar-props", () => ({
  useWorkspaceToolbarProps: () => ({
    notes: [
      { noteId: "note-1", updatedAt: "2025-01-01T00:00:00.000Z" },
      { noteId: "note-2", updatedAt: "2025-01-01T00:00:00.000Z" },
    ],
    activeNoteId: "note-1",
    isWorkspaceLoading: false,
    isCreatingNote: false,
    formatNoteLabel: (noteId: string) => `Note ${noteId}`,
    onActivateNote: jest.fn(),
    onCenterNote: jest.fn(),
    onCloseNote: jest.fn(),
    onNewNote: jest.fn(),
    onSettings: jest.fn(),
  }),
}))

jest.mock("@/lib/utils/coordinate-bridge", () => ({
  CoordinateBridge: class {},
}))

jest.mock("@/lib/utils/note-creator", () => ({
  createNote: jest.fn(async () => ({ success: true, noteId: "note-new" })),
}))

jest.mock("@/lib/adapters/overlay-layout-adapter", () => ({
  OverlayLayoutConflictError: class OverlayLayoutConflictError extends Error {},
  isOverlayPersistenceEnabled: () => true,
}))

jest.mock("@/lib/utils/debug-logger", () => ({
  debugLog: jest.fn(),
  isDebugEnabled: () => false,
}))

jest.mock("@/hooks/use-toast", () => ({
  toast: jest.fn(),
}))

jest.mock("@/lib/canvas/composite-id", () => ({
  ensurePanelKey: (value: string) => value,
}))

;(globalThis as any).fetch = jest.fn(async () => ({
  ok: true,
  json: async () => ({}),
}))

type Phase = "legacy" | "shell"

async function renderAnnotationApp(phase: Phase) {
  process.env.NEXT_PUBLIC_ANNOTATION_APP_REFACTOR_PHASE =
    phase === "shell" ? "shell" : "off"
  ;(globalThis as any).__annotationWorkspaceViewProps = undefined
  const { AnnotationApp } =
    require("@/components/annotation-app") as typeof import("../../components/annotation-app")
  renderToString(React.createElement(AnnotationApp))
  const props = (globalThis as any).__annotationWorkspaceViewProps
  if (!props) {
    throw new Error("AnnotationWorkspaceView props were not captured")
  }
  return props
}

describe("AnnotationApp shell vs legacy view props", () => {
  it("serializes props for both legacy and shell renders and ensures parity", async () => {
    const legacyProps = await renderAnnotationApp("legacy")
    const shellProps = await renderAnnotationApp("shell")
    const result = compareAnnotationWorkspaceViewProps(legacyProps, shellProps)
    expect(result.isEqual).toBe(true)
  })

  it("detects drift when serialized props diverge", () => {
    const baseline = {
      toolbarProps: { notes: [{ noteId: "a" }] },
    }
    const variant = {
      toolbarProps: { notes: [{ noteId: "a" }, { noteId: "b" }] },
    }

    const serializedBaseline = serializeAnnotationWorkspaceViewProps(
      baseline as any,
    )
    const serializedVariant = serializeAnnotationWorkspaceViewProps(
      variant as any,
    )
    expect(serializedBaseline).not.toEqual(serializedVariant)
  })
})
