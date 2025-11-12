"use client"

import { Eye } from "lucide-react"
import type { MouseEvent as ReactMouseEvent } from "react"

import { getFolderColorTheme, type OrgItem } from "@/components/floating-toolbar"
import { Z_INDEX } from "@/lib/constants/z-index"
import type { SidebarFolderPopup } from "@/lib/hooks/annotation/use-sidebar-folder-popups"

type SidebarPreviewPopupsProps = {
  popups: SidebarFolderPopup[]
  onPopupHover: (folderId: string) => void
  onPopupLeave: (folderId: string) => void
  onDismiss: (popupId: string) => void
  onFolderHover: (folder: OrgItem, event: ReactMouseEvent<HTMLElement>, parentFolderId?: string) => void
  onFolderClick: (folder: OrgItem, event: ReactMouseEvent<HTMLElement>) => void
  onNotePreviewHover: (noteId: string, event: ReactMouseEvent<HTMLElement>, sourceFolderId?: string) => void
  onNotePreviewLeave: () => void
  onNoteOpen: (noteId: string) => void
}

export function SidebarPreviewPopups({
  popups,
  onPopupHover,
  onPopupLeave,
  onDismiss,
  onFolderHover,
  onFolderClick,
  onNotePreviewHover,
  onNotePreviewLeave,
  onNoteOpen,
}: SidebarPreviewPopupsProps) {
  if (!popups.length) {
    return null
  }

  return (
    <>
      {popups.map((popup) => {
        const popupColorTheme = popup.folderColor ? getFolderColorTheme(popup.folderColor) : null

        return (
          <div
            key={popup.id}
            className="fixed w-72 rounded-2xl border border-white/20 bg-gray-900 shadow-2xl"
            style={{
              backgroundColor: "rgba(17, 24, 39, 0.98)",
              left: `${popup.position.x}px`,
              top: `${popup.position.y}px`,
              zIndex: Z_INDEX.DROPDOWN + 20,
            }}
            onClick={(event) => event.stopPropagation()}
            onMouseEnter={() => onPopupHover(popup.folderId)}
            onMouseLeave={() => onPopupLeave(popup.folderId)}
          >
            <div
              className="flex items-center justify-between px-4 py-3 border-b text-sm font-medium"
              style={{
                backgroundColor: "transparent",
                color: "rgba(255, 255, 255, 0.8)",
                borderBottomColor: "rgba(255, 255, 255, 0.1)",
              }}
            >
              <div className="flex items-center gap-2">
                {popupColorTheme && (
                  <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: popupColorTheme.bg }} />
                )}
                <span>{popup.folderName}</span>
              </div>
              <button className="text-white/60 hover:text-white" onClick={() => onDismiss(popup.id)} aria-label="Close preview popup">
                ×
              </button>
            </div>
            <div className="max-h-64 overflow-y-auto p-3 space-y-1">
              {popup.isLoading ? (
                <div className="py-4 text-center text-sm text-white/60">Loading...</div>
              ) : popup.children.length === 0 ? (
                <div className="py-4 text-center text-sm text-white/60">Empty folder</div>
              ) : (
                popup.children.map((child) => (
                  <div key={child.id} className="group relative">
                    <button
                      className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-left text-white/90 transition hover:border-blue-400/40 hover:bg-blue-500/20"
                      onDoubleClick={() => {
                        if (child.type === "note") {
                          onNoteOpen(child.id)
                        }
                      }}
                    >
                      <div className="flex items-center justify-between gap-2 text-sm font-medium">
                        <div className="flex min-w-0 flex-1 items-center gap-2">
                          <span>{child.icon ?? (child.type === "folder" ? "📁" : "📄")}</span>
                          <span className="truncate">{child.name}</span>
                        </div>
                        {child.type === "folder" ? (
                          <div
                            className="rounded p-0.5 opacity-0 transition-opacity hover:bg-white/10 group-hover:opacity-100"
                            onMouseEnter={(event) => onFolderHover(child, event, popup.folderId)}
                            onMouseLeave={() => onPopupLeave(child.id)}
                            onClick={(event) => {
                              event.stopPropagation()
                              onFolderClick(child, event)
                            }}
                          >
                            <Eye className="h-3.5 w-3.5 text-blue-400" />
                          </div>
                        ) : child.type === "note" ? (
                          <div
                            className="rounded p-0.5 opacity-0 transition-opacity hover:bg-white/10 group-hover:opacity-100"
                            onMouseEnter={(event) => onNotePreviewHover(child.id, event, popup.folderId)}
                            onMouseLeave={onNotePreviewLeave}
                          >
                            <Eye className="h-3.5 w-3.5 text-blue-400" />
                          </div>
                        ) : null}
                      </div>
                      <div className="mt-1 text-xs text-white/60">{child.type === "folder" ? "Folder" : "Note"}</div>
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        )
      })}
    </>
  )
}
