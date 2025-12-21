"use client"

import { forwardRef, useState } from "react"
import { Trash2, Plus } from "lucide-react"
import { PinWorkspaceButton, WorkspacePinnedDot } from "@/components/dashboard/PinWorkspaceButton"

type WorkspaceSummary = {
  id: string
  name: string
  popupCount?: number
  noteCount?: number
  updatedAt?: string | null
  isDefault?: boolean
}

type WorkspaceToggleMenuProps = {
  statusLabel: string
  statusHelperText?: string | null
  isOpen: boolean
  onToggleMenu: () => void
  onCreateWorkspace: () => void
  disableCreate: boolean
  isListLoading: boolean
  workspaces: WorkspaceSummary[]
  currentWorkspaceId: string | null
  deletingWorkspaceId: string | null
  onSelectWorkspace: (workspaceId: string) => void | Promise<void>
  onDeleteWorkspace: (workspaceId: string) => void | Promise<void>
  onRenameWorkspace?: (workspaceId: string, name: string) => void | Promise<void>
  className?: string
  labelTitle?: string
  /** Entry ID for workspace pinning (optional - enables pin buttons when provided) */
  entryId?: string
  /** When true, hides the header bar (trigger button) - used when controlled by dock button */
  hideHeader?: boolean
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
      labelTitle = "Workspace",
      onRenameWorkspace,
      entryId,
      hideHeader = false,
    },
    ref,
  ) {
    const [renameState, setRenameState] = useState<{ id: string | null; value: string }>({ id: null, value: "" })

    const commitRename = async () => {
      if (!renameState.id || !onRenameWorkspace) return
      const trimmed = renameState.value.trim()
      if (!trimmed || trimmed.length === 0) {
        setRenameState({ id: null, value: "" })
        return
      }
      await onRenameWorkspace(renameState.id, trimmed)
      setRenameState({ id: null, value: "" })
    }

    const cancelRename = () => setRenameState({ id: null, value: "" })

    return (
      <div ref={ref} className={["relative flex flex-col items-center gap-2 pointer-events-auto", className].filter(Boolean).join(" ")}>
        {/* Header bar - hidden when hideHeader is true (controlled by dock button) */}
        {!hideHeader && (
          <div className="flex items-center gap-2 rounded-full bg-slate-950/85 px-2 py-1.5 shadow-lg ring-1 ring-white/15 backdrop-blur-xl">
            <button
              type="button"
              onClick={onToggleMenu}
              aria-expanded={isOpen}
              aria-label="Choose workspace"
              className="flex items-center gap-2 rounded-full px-3 py-1 text-sm font-medium text-white transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
            >
              <span className="text-[11px] uppercase tracking-wide text-white/60">{labelTitle}</span>
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
        )}
        {!hideHeader && statusHelperText ? (
          <div className="rounded-full bg-slate-900/70 px-3 py-1 text-xs text-slate-200 pointer-events-none select-none">
            {statusHelperText}
          </div>
        ) : null}

        {isOpen && (
          <div className={[
            "w-72 rounded-2xl border border-white/10 bg-slate-950/95 p-2 shadow-2xl backdrop-blur-xl z-[100]",
            hideHeader ? "" : "absolute top-full left-1/2 -translate-x-1/2 mt-2"
          ].filter(Boolean).join(" ")}>
            {isListLoading ? (
              <div className="py-6 text-center text-sm text-white/60">Loading workspaces...</div>
            ) : workspaces.length === 0 ? (
              <div className="py-6 px-4 text-center text-sm text-white/60">
                No saved workspaces yet. Use the + button to snapshot this layout.
              </div>
            ) : (
              <>
                <ul className="flex max-h-64 flex-col gap-1 overflow-y-auto">
                  {workspaces.map((workspace) => {
                    const isActive = workspace.id === currentWorkspaceId
                    const isDeleting = deletingWorkspaceId === workspace.id
                    const disableDelete = workspace.isDefault || isDeleting
                    const updatedDate = workspace.updatedAt ? new Date(workspace.updatedAt) : null
                    const lastUpdated =
                      updatedDate && !Number.isNaN(updatedDate.getTime()) ? updatedDate.toLocaleString() : "Never saved"
                    const itemCount =
                      typeof workspace.popupCount === "number"
                        ? workspace.popupCount
                        : typeof workspace.noteCount === "number"
                          ? workspace.noteCount
                          : undefined
                    const countLabel =
                      typeof itemCount === "number"
                        ? `${itemCount} item${itemCount === 1 ? "" : "s"}`
                        : undefined

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
                            {renameState.id === workspace.id ? (
                              <input
                                autoFocus
                                value={renameState.value}
                                onChange={(event) =>
                                  setRenameState((prev) => ({ ...prev, value: event.target.value }))
                                }
                                onKeyDown={(event) => {
                                  if (event.key === "Enter") {
                                    event.preventDefault()
                                    void commitRename()
                                  }
                                  if (event.key === "Escape") {
                                    event.preventDefault()
                                    cancelRename()
                                  }
                                }}
                                onBlur={() => void commitRename()}
                                className="w-full rounded-md bg-slate-900/60 px-2 py-1 text-sm text-white focus:outline-none"
                                placeholder="Workspace name"
                              />
                            ) : (
                              <span className="flex items-center gap-1.5">
                                <span className="font-medium">{workspace.name}</span>
                                {entryId && (
                                  <WorkspacePinnedDot
                                    entryId={entryId}
                                    workspaceId={workspace.id}
                                  />
                                )}
                              </span>
                            )}
                            {countLabel ? <span className="text-xs text-white/60">{countLabel}</span> : null}
                          </div>
                          <div className="mt-1 text-[11px] text-white/50">{lastUpdated}</div>
                        </button>
                        {/* Pin workspace button - only shown when entry is provided and pinned */}
                        {entryId && (
                          <div className="absolute right-[4.5rem] top-2 opacity-0 transition-all group-hover:opacity-100">
                            <PinWorkspaceButton
                              entryId={entryId}
                              workspaceId={workspace.id}
                              size="xs"
                            />
                          </div>
                        )}
                        {onRenameWorkspace ? (
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation()
                              setRenameState({ id: workspace.id, value: workspace.name })
                            }}
                            className="absolute right-10 top-2 inline-flex h-6 w-6 items-center justify-center rounded-full border border-white/10 bg-slate-900/80 text-white/70 opacity-0 transition-all group-hover:opacity-100 hover:border-blue-400/60 hover:bg-blue-500/20 hover:text-blue-200"
                            aria-label="Rename workspace"
                          >
                            <span className="text-[11px] font-semibold">✎</span>
                          </button>
                        ) : null}
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
                {/* Footer */}
                <div className="flex items-center justify-between border-t border-white/10 mt-2 pt-2 px-1">
                  <span className="text-[11px] text-white/50">
                    Click to switch workspace
                  </span>
                  <button
                    type="button"
                    onClick={onCreateWorkspace}
                    disabled={disableCreate}
                    className="flex items-center gap-1 rounded-lg border border-indigo-500/30 bg-indigo-500/10 px-2.5 py-1 text-[11px] font-medium text-indigo-300 transition-colors hover:border-indigo-500/50 hover:bg-indigo-500/20 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Plus className="h-3 w-3" />
                    New Workspace
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    )
  },
)
