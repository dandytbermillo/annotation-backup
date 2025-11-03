"use client"

import React from 'react'

import type { OverlayWorkspaceSummary } from '@/lib/adapters/overlay-layout-adapter'

interface WorkspaceSidebarContentProps {
  workspaces: OverlayWorkspaceSummary[]
  currentWorkspaceId: string | null
  isLoading: boolean
  isSaving: boolean
  onSelectWorkspace: (workspaceId: string) => void
  onCreateWorkspace: () => void
}

function formatUpdatedAt(updatedAt?: string | null): string {
  if (!updatedAt) return 'Never saved'
  const date = new Date(updatedAt)
  if (Number.isNaN(date.getTime())) return 'Never saved'

  const now = Date.now()
  const diffMs = now - date.getTime()
  const diffMinutes = Math.max(0, Math.round(diffMs / 60000))

  if (diffMinutes < 1) return 'Updated just now'
  if (diffMinutes < 60) return `Updated ${diffMinutes} min ago`

  const diffHours = Math.round(diffMinutes / 60)
  if (diffHours < 24) return `Updated ${diffHours} hr ago`

  const diffDays = Math.round(diffHours / 24)
  if (diffDays <= 7) return `Updated ${diffDays} day${diffDays === 1 ? '' : 's'} ago`

  return `Updated ${new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date)}`
}

export function WorkspaceSidebarContent({
  workspaces,
  currentWorkspaceId,
  isLoading,
  isSaving,
  onSelectWorkspace,
  onCreateWorkspace,
}: WorkspaceSidebarContentProps) {
  return (
    <div className="flex h-full flex-col bg-slate-900/95">
      <div className="px-4 py-4 border-b border-white/10">
        <h2 className="text-lg font-semibold text-blue-300">Overlay Workspaces</h2>
        <p className="text-xs text-white/60 mt-1">
          Switch between saved popup layouts or snapshot the one you&apos;re viewing.
        </p>
      </div>

      <div className="px-4 pt-3 pb-2 border-b border-white/10 text-xs uppercase tracking-wide text-white/40">
        Saved Workspaces
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
        {isLoading ? (
          <div className="flex h-full items-center justify-center text-sm text-white/60">
            Loading workspaces…
          </div>
        ) : workspaces.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-white/60 text-center px-4">
            No workspaces yet. Use the &#43; button above the canvas to snapshot the current layout.
          </div>
        ) : (
          workspaces.map(workspace => {
            const isActive = workspace.id === currentWorkspaceId
            return (
              <button
                key={workspace.id}
                onClick={() => onSelectWorkspace(workspace.id)}
                className={[
                  'w-full text-left rounded-xl border px-4 py-3 transition-colors',
                  isActive
                    ? 'border-blue-400/60 bg-blue-500/15 text-white'
                    : 'border-white/10 bg-white/5 text-white/80 hover:border-white/20 hover:bg-white/10',
                ].join(' ')}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium">{workspace.name}</span>
                  <span className="text-[11px] text-white/50">
                    {workspace.popupCount} panel{workspace.popupCount === 1 ? '' : 's'}
                  </span>
                </div>
                <div className="mt-1 text-xs text-white/50">
                  {formatUpdatedAt(workspace.updatedAt)}
                </div>
              </button>
            )
          })
        )}
      </div>

      <div className="px-4 py-3 border-t border-white/10 bg-slate-900/90">
        <button
          onClick={onCreateWorkspace}
          disabled={isSaving}
          className="w-full rounded-lg bg-blue-500/80 text-slate-950 font-semibold py-2.5 text-sm shadow-lg transition-transform hover:translate-y-[-1px] disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {isSaving ? 'Saving…' : 'Snapshot Current Layout'}
        </button>
      </div>
    </div>
  )
}
