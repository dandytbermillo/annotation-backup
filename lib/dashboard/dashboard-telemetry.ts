/**
 * Dashboard Telemetry & Debug Logging
 * Part of Dashboard Implementation - Phase 5.4
 *
 * Provides standardized logging for dashboard operations including:
 * - Dashboard load events
 * - Panel interactions
 * - Error tracking
 * - Performance metrics
 */

import { debugLog } from '@/lib/utils/debug-logger'

// Telemetry event types
export type DashboardEventType =
  | 'dashboard_load'
  | 'dashboard_load_error'
  | 'panel_created'
  | 'panel_deleted'
  | 'panel_resized'
  | 'panel_moved'
  | 'panel_config_updated'
  | 'layout_reset'
  | 'continue_clicked'
  | 'quick_capture_submitted'
  | 'quick_capture_failed'
  | 'navigator_entry_expanded'
  | 'navigator_workspace_clicked'
  | 'recent_workspace_clicked'
  | 'workspace_link_clicked'
  | 'breadcrumb_clicked'
  | 'home_shortcut_used'

// Telemetry metadata interface
export interface DashboardEventMetadata {
  workspaceId?: string
  panelId?: string
  panelType?: string
  entryId?: string
  noteId?: string
  error?: string
  duration?: number
  retryCount?: number
  [key: string]: unknown
}

/**
 * Log a dashboard telemetry event
 */
export async function logDashboardEvent(
  action: DashboardEventType,
  metadata: DashboardEventMetadata = {}
): Promise<void> {
  try {
    await debugLog({
      component: 'Dashboard',
      action,
      metadata: {
        timestamp: new Date().toISOString(),
        ...metadata,
      },
    })
  } catch (err) {
    // Silently fail - telemetry should not break functionality
    console.debug('[DashboardTelemetry] Failed to log event:', action, err)
  }
}

/**
 * Log dashboard load timing
 */
export async function logDashboardLoad(
  workspaceId: string,
  panelCount: number,
  duration: number,
  success: boolean,
  error?: string
): Promise<void> {
  await logDashboardEvent(success ? 'dashboard_load' : 'dashboard_load_error', {
    workspaceId,
    panelCount,
    duration,
    error,
  })
}

/**
 * Log panel creation
 */
export async function logPanelCreated(
  panelId: string,
  panelType: string,
  workspaceId: string
): Promise<void> {
  await logDashboardEvent('panel_created', {
    panelId,
    panelType,
    workspaceId,
  })
}

/**
 * Log panel deletion
 */
export async function logPanelDeleted(
  panelId: string,
  panelType: string,
  workspaceId: string
): Promise<void> {
  await logDashboardEvent('panel_deleted', {
    panelId,
    panelType,
    workspaceId,
  })
}

/**
 * Log quick capture submission
 */
export async function logQuickCapture(
  success: boolean,
  noteId?: string,
  error?: string
): Promise<void> {
  await logDashboardEvent(success ? 'quick_capture_submitted' : 'quick_capture_failed', {
    noteId,
    error,
  })
}

/**
 * Log continue panel click
 */
export async function logContinueClicked(
  workspaceId: string,
  workspaceName: string
): Promise<void> {
  await logDashboardEvent('continue_clicked', {
    workspaceId,
    workspaceName,
  })
}

/**
 * Log layout reset
 */
export async function logLayoutReset(
  workspaceId: string,
  panelCount: number,
  success: boolean,
  retryCount?: number,
  error?: string
): Promise<void> {
  await logDashboardEvent('layout_reset', {
    workspaceId,
    panelCount,
    success,
    retryCount,
    error,
  })
}

/**
 * Log workspace link click
 */
export async function logWorkspaceLinkClicked(
  targetWorkspaceId: string,
  sourceWorkspaceId?: string
): Promise<void> {
  await logDashboardEvent('workspace_link_clicked', {
    targetWorkspaceId,
    sourceWorkspaceId,
  })
}

/**
 * Log home shortcut usage
 */
export async function logHomeShortcutUsed(method: 'keyboard' | 'logo' | 'breadcrumb'): Promise<void> {
  await logDashboardEvent('home_shortcut_used', {
    method,
  })
}

/**
 * Performance timer utility
 */
export function createPerformanceTimer() {
  const start = performance.now()

  return {
    elapsed: () => Math.round(performance.now() - start),
    logWith: async (
      action: DashboardEventType,
      metadata: DashboardEventMetadata = {}
    ) => {
      await logDashboardEvent(action, {
        ...metadata,
        duration: Math.round(performance.now() - start),
      })
    },
  }
}

/**
 * Dashboard metrics aggregator (for monitoring dashboards)
 */
export interface DashboardMetrics {
  loadTime: number
  panelCount: number
  errorCount: number
  lastError?: string
  sessionStart: number
}

let sessionMetrics: DashboardMetrics | null = null

export function initSessionMetrics(): void {
  sessionMetrics = {
    loadTime: 0,
    panelCount: 0,
    errorCount: 0,
    sessionStart: Date.now(),
  }
}

export function updateSessionMetrics(updates: Partial<DashboardMetrics>): void {
  if (sessionMetrics) {
    sessionMetrics = { ...sessionMetrics, ...updates }
  }
}

export function incrementErrorCount(error?: string): void {
  if (sessionMetrics) {
    sessionMetrics.errorCount++
    if (error) {
      sessionMetrics.lastError = error
    }
  }
}

export function getSessionMetrics(): DashboardMetrics | null {
  return sessionMetrics
}
