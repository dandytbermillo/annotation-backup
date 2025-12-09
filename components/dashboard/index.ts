/**
 * Dashboard Components
 * Part of Dashboard Implementation - Phase 2, 3, 4 & 5
 *
 * Exports all dashboard-related components for use in the application.
 */

// Panel components
export * from './panels'

// Panel renderer
export { DashboardPanelRenderer, useDashboardPanels } from './DashboardPanelRenderer'

// Panel catalog
export { PanelCatalog, AddPanelButton } from './PanelCatalog'

// Navigation & Breadcrumb (Phase 3)
export { DashboardBreadcrumb, CompactBreadcrumb } from './DashboardBreadcrumb'

// Pinned Entries (State Preservation Feature)
export { PinEntryButton, PinnedIndicator } from './PinEntryButton'
export { PinWorkspaceButton, WorkspacePinnedDot } from './PinWorkspaceButton'

// Workspace link picker (Phase 3)
export { WorkspaceLinkPicker, useWorkspaceLinkPicker } from './WorkspaceLinkPicker'
export type { WorkspaceOption } from './WorkspaceLinkPicker'

// Layout management (Phase 4)
export { DashboardLayoutManager, useDashboardInit } from './DashboardLayoutManager'

// Welcome tooltip (Phase 5)
export {
  DashboardWelcomeTooltip,
  useDashboardWelcome,
  clearWelcomeStorage,
} from './DashboardWelcomeTooltip'

// Dashboard initializer (App integration)
export { DashboardInitializer, useShouldShowDashboard } from './DashboardInitializer'

// Dashboard view (Main dashboard UI)
export { DashboardView } from './DashboardView'
