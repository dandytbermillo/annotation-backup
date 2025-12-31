/**
 * Navigation Toast Notifications
 *
 * Provides toast notification utilities for chat navigation actions.
 * Uses the existing toast system for consistent, minimal feedback.
 */

import { toast } from '@/hooks/use-toast'

/**
 * Show toast when workspace is opened.
 */
export function showWorkspaceOpenedToast(workspaceName: string, entryName?: string): void {
  toast({
    title: `Opened "${workspaceName}"`,
    description: entryName ? `in ${entryName}` : undefined,
  })
}

/**
 * Show toast when workspace is created.
 */
export function showWorkspaceCreatedToast(workspaceName: string): void {
  toast({
    title: `Created "${workspaceName}"`,
  })
}

/**
 * Show toast when workspace is renamed.
 */
export function showWorkspaceRenamedToast(fromName: string, toName: string): void {
  toast({
    title: `Renamed to "${toName}"`,
    description: `from "${fromName}"`,
  })
}

/**
 * Show toast when workspace is deleted.
 */
export function showWorkspaceDeletedToast(workspaceName: string): void {
  toast({
    title: `Deleted "${workspaceName}"`,
  })
}

/**
 * Show toast when navigating to dashboard.
 */
export function showDashboardToast(): void {
  toast({
    title: 'Dashboard',
  })
}

/**
 * Show toast when navigating to home.
 */
export function showHomeToast(): void {
  toast({
    title: 'Home',
  })
}

/**
 * Show toast when entry is opened.
 */
export function showEntryOpenedToast(entryName: string): void {
  toast({
    title: `Opened "${entryName}"`,
  })
}
