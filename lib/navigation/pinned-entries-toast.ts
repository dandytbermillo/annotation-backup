/**
 * Pinned Entries Toast Notifications
 * Part of Pinned Entries Feature - Phase 5
 *
 * Provides toast notification utilities for pinned entries actions.
 */

import { toast } from "@/hooks/use-toast"
import type { PinnedEntry } from "./pinned-entry-types"

/**
 * Show toast when an entry is pinned
 */
export function showEntryPinnedToast(entryName: string): void {
  toast({
    title: "Entry pinned",
    description: `"${entryName}" will preserve state when switching entries`,
  })
}

/**
 * Show toast when an entry is unpinned
 */
export function showEntryUnpinnedToast(entryName: string): void {
  toast({
    title: "Entry unpinned",
    description: `"${entryName}" will no longer preserve state`,
  })
}

/**
 * Show toast when a workspace is pinned
 */
export function showWorkspacePinnedToast(workspaceName?: string): void {
  toast({
    title: "Workspace pinned",
    description: workspaceName
      ? `"${workspaceName}" will preserve state`
      : "Workspace will preserve state when switching entries",
  })
}

/**
 * Show toast when a workspace is unpinned
 */
export function showWorkspaceUnpinnedToast(workspaceName?: string): void {
  toast({
    title: "Workspace unpinned",
    description: workspaceName
      ? `"${workspaceName}" will no longer preserve state`
      : "Workspace will no longer preserve state",
  })
}

/**
 * Show toast when an entry is auto-unpinned due to limit exceeded
 */
export function showAutoUnpinnedEntryToast(unpinnedEntry: PinnedEntry): void {
  toast({
    title: "Entry auto-unpinned",
    description: `"${unpinnedEntry.entryName}" was unpinned to make room for the new entry`,
    variant: "default",
  })
}

/**
 * Show toast when a workspace is auto-unpinned due to limit exceeded
 */
export function showAutoUnpinnedWorkspaceToast(_workspaceId: string): void {
  toast({
    title: "Workspace auto-unpinned",
    description: "A workspace was unpinned to make room for the new one",
    variant: "default",
  })
}

/**
 * Show toast when pinning fails
 */
export function showPinErrorToast(error: string): void {
  toast({
    title: "Pinning failed",
    description: error,
    variant: "destructive",
  })
}

/**
 * Show toast when entry cannot be pinned because feature is disabled
 */
export function showFeatureDisabledToast(): void {
  toast({
    title: "Feature not available",
    description: "Pinned entries feature is not enabled",
    variant: "destructive",
  })
}
