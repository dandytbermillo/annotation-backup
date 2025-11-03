"use client"

import React from 'react'

export type CanvasSidebarTab = 'constellation' | 'organization' | 'workspace'

interface CanvasSidebarProps {
  activeTab: CanvasSidebarTab
  onTabChange: (tab: CanvasSidebarTab) => void
  constellationContent?: React.ReactNode
  organizationContent?: React.ReactNode
  workspaceContent?: React.ReactNode
  showWorkspaceTab?: boolean
}

const BASE_TABS: Array<{ id: CanvasSidebarTab; label: string }> = [
  { id: 'constellation', label: 'Constellation' },
  { id: 'organization', label: 'Organization' },
  { id: 'workspace', label: 'Workspace' },
]

export function CanvasSidebar({
  activeTab,
  onTabChange,
  constellationContent,
  organizationContent,
  workspaceContent,
  showWorkspaceTab = true,
}: CanvasSidebarProps) {
  const tabs = React.useMemo(() => {
    if (showWorkspaceTab) return BASE_TABS
    return BASE_TABS.filter(tab => tab.id !== 'workspace')
  }, [showWorkspaceTab])

  const resolvedActiveTab = React.useMemo<CanvasSidebarTab>(() => {
    if (!showWorkspaceTab && activeTab === 'workspace') {
      return 'organization'
    }
    return activeTab
  }, [activeTab, showWorkspaceTab])

  return (
    <aside className="w-80 h-full bg-slate-950/90 border-r border-white/10 flex flex-col backdrop-blur-sm">
      <div className="px-4 py-3 border-b border-white/10 flex items-center gap-2">
        {tabs.map(tab => {
          const isActive = tab.id === resolvedActiveTab
          return (
            <button
              key={tab.id}
              onClick={() => onTabChange(tab.id)}
              className={[
                'flex-1 rounded-full px-3 py-1.5 text-sm font-medium transition-colors',
                isActive
                  ? 'bg-blue-500/80 text-white shadow-lg'
                  : 'bg-white/5 text-white/70 hover:bg-white/10 hover:text-white',
              ].join(' ')}
            >
              {tab.label}
            </button>
          )
        })}
      </div>

      <div className="flex-1 overflow-hidden">
        {resolvedActiveTab === 'constellation' ? (
          <div className="h-full overflow-hidden">
            {constellationContent ?? (
              <div className="flex h-full items-center justify-center text-sm text-white/60 px-4">
                Constellation data will load when the view is available.
              </div>
            )}
          </div>
        ) : resolvedActiveTab === 'organization' ? (
          <div className="h-full overflow-hidden">
            {organizationContent ?? (
              <div className="flex h-full items-center justify-center text-sm text-white/60 px-4">
                No organization data available yet.
              </div>
            )}
          </div>
        ) : (
          <div className="h-full overflow-hidden">
            {workspaceContent ?? (
              <div className="flex h-full items-center justify-center text-sm text-white/60 px-4">
                No workspaces yet. Create one from the canvas toggle.
              </div>
            )}
          </div>
        )}
      </div>
    </aside>
  )
}
