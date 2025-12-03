/**
 * Dashboard Components
 * Part of Dashboard Implementation - Phase 2 & 3
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

// Workspace link picker (Phase 3)
export { WorkspaceLinkPicker, useWorkspaceLinkPicker } from './WorkspaceLinkPicker'
export type { WorkspaceOption } from './WorkspaceLinkPicker'
