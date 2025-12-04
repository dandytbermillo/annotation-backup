/**
 * Dashboard Panel Components
 * Part of Dashboard Implementation - Phase 2.2 (Updated in Phase 4.4)
 *
 * Exports all panel components for use in the dashboard workspace.
 */

export { BaseDashboardPanel } from './BaseDashboardPanel'
export type { BaseDashboardPanelProps } from './BaseDashboardPanel'

export { ContinuePanel } from './ContinuePanel'
export { EntryNavigatorPanel } from './EntryNavigatorPanel'
export { RecentPanel } from './RecentPanel'
export { QuickCapturePanel } from './QuickCapturePanel'
export { LinksNotePanel } from './LinksNotePanel'

// Skeleton loading states (Phase 4.4)
export {
  ContinuePanelSkeleton,
  NavigatorPanelSkeleton,
  RecentPanelSkeleton,
  QuickCapturePanelSkeleton,
  GenericPanelSkeleton,
  DashboardGridSkeleton,
} from './PanelSkeletons'
