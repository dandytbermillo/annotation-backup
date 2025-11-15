"use client"

import { forwardRef } from "react"
import { Trash2 } from "lucide-react"
import type { OverlayWorkspaceSummary } from "@/lib/adapters/overlay-layout-adapter"

type WorkspaceToggleMenuProps = {
  statusLabel: string
  statusHelperText?: string | null
  isOpen: boolean
  onToggleMenu: () => void
  onCreateWorkspace: () => void
  disableCreate: boolean
  isListLoading: boolean
  workspaces: OverlayWorkspaceSummary[]
  currentWorkspaceId: string | null
  deletingWorkspaceId: string | null
  onSelectWorkspace: (workspaceId: string) => void | Promise<void>
  onDeleteWorkspace: (workspaceId: string) => void | Promise<void>
  className?: string
}

export const WorkspaceToggleMenu = forwardRef<HTMLDivElement, WorkspaceToggleMenuProps>(
  function WorkspaceToggleMenu(
    {
      statusLabel,
      statusHelperText,
      isOpen,
      onToggleMenu,
      onCreateWorkspace,
      disableCreate,
      isListLoading,
      workspaces,
      currentWorkspaceId,
      deletingWorkspaceId,
      onSelectWorkspace,
      onDeleteWorkspace,
      className,
    },
    ref,
  ) {
    return (
      <div ref={ref} className={["flex flex-col items-center gap-2 pointer-events-auto", className].filter(Boolean).join(" ")}>
        <div className="flex items-center gap-2 rounded-full bg-slate-950/85 px-2 py-1.5 shadow-lg ring-1 ring-white/15 backdrop-blur-xl">
          <button
            type="button"
            onClick={onToggleMenu}
            aria-expanded={isOpen}
            aria-label="Choose workspace"
            className="flex items-center gap-2 rounded-full px-3 py-1 text-sm font-medium text-white transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
          >
            <span className="text-[11px] uppercase tracking-wide text-white/60">Workspace</span>
            <span>{statusLabel}</span>
            <svg
              aria-hidden="true"
              className={`h-3 w-3 transition-transform ${isOpen ? "rotate-180" : ""}`}
              viewBox="0 0 12 12"
              fill="none"
            >
              <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <button
            type="button"
            onClick={onCreateWorkspace}
            disabled={disableCreate}
            className="flex h-7 w-7 items-center justify-center rounded-full bg-blue-500/90 text-slate-950 transition-transform hover:translate-y-[-1px] disabled:translate-y-0 disabled:opacity-60 disabled:cursor-not-allowed"
            aria-label="Snapshot current workspace"
          >
            <span className="text-lg font-semibold leading-none">+</span>
          </button>
        </div>
        {statusHelperText ? (
          <div className="rounded-full bg-slate-900/70 px-3 py-1 text-xs text-slate-200 pointer-events-none select-none">
            {statusHelperText}
          </div>
        ) : null}

        {isOpen && (
          <div className="mt-2 w-72 rounded-2xl border border-white/10 bg-slate-950/95 p-2 shadow-2xl backdrop-blur-xl">
            {isListLoading ? (
              <div className="py-6 text-center text-sm text-white/60">Loading workspaces...</div>
            ) : workspaces.length === 0 ? (
              <div className="py-6 px-4 text-center text-sm text-white/60">
                No saved workspaces yet. Use the + button to snapshot this layout.
              </div>
            ) : (
              <ul className="flex max-h-64 flex-col gap-1 overflow-y-auto">
                {workspaces.map((workspace) => {
                  const isActive = workspace.id === currentWorkspaceId
                  const isDeleting = deletingWorkspaceId === workspace.id
                  const disableDelete = workspace.isDefault || isDeleting
                  const updatedDate = workspace.updatedAt ? new Date(workspace.updatedAt) : null
                  const lastUpdated =
                    updatedDate && !Number.isNaN(updatedDate.getTime()) ? updatedDate.toLocaleString() : "Never saved"

                  return (
                    <li key={workspace.id} className="group relative">
                      <button
                        type="button"
                        onClick={() => onSelectWorkspace(workspace.id)}
                        className={[
                          "w-full rounded-xl border px-3 py-2 text-left text-sm transition-colors",
                          isActive
                            ? "border-blue-400/60 bg-blue-500/20 text-white shadow-lg"
                            : "border-white/10 bg-white/5 text-white/80 hover:border-white/20 hover:bg-white/10",
                        ].join(" ")}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium">{workspace.name}</span>
                          <span className="text-xs text-white/60">
                            {workspace.popupCount} panel{workspace.popupCount === 1 ? "" : "s"}
                          </span>
                        </div>
                        <div className="mt-1 text-[11px] text-white/50">{lastUpdated}</div>
                      </button>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation()
                          onDeleteWorkspace(workspace.id)
                        }}
                        disabled={disableDelete}
                        className={[
                          "absolute right-2 top-2 inline-flex h-6 w-6 items-center justify-center rounded-full border border-white/10 bg-slate-900/80 text-white/70 opacity-0 transition-all group-hover:opacity-100",
                          disableDelete
                            ? "cursor-not-allowed opacity-30"
                            : "hover:border-red-400/60 hover:bg-red-600/20 hover:text-red-200",
                        ].join(" ")}
                        aria-label={workspace.isDefault ? "Default workspace cannot be deleted" : "Delete workspace"}
                      >
                        {isDeleting ? (
                          <span className="text-[10px] font-semibold uppercase tracking-wide">…</span>
                        ) : (
                          <Trash2 className="h-3.5 w-3.5" />
                        )}
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        )}
      </div>
    )
  },
)
