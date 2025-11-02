"use client"

interface OrganizationSidebarItem {
  id: string
  name: string
  count: number
  icon?: string
  pinned?: boolean
}

interface OrganizationSidebarStats {
  openPopups: number
  totalItems: number
  pinnedPopups: number
}

interface OrganizationSidebarContentProps {
  items: OrganizationSidebarItem[]
  stats: OrganizationSidebarStats
  onSelect?: (id: string) => void
}

export function OrganizationSidebarContent({
  items,
  stats,
  onSelect,
}: OrganizationSidebarContentProps) {
  return (
    <div className="flex h-full flex-col bg-slate-900/95">
      <div className="px-4 py-4 border-b border-white/10">
        <h2 className="text-lg font-semibold text-blue-300">Workspace Organization</h2>
        <p className="text-xs text-white/60 mt-1">
          Manage folders visible in the overlay canvas
        </p>
        <div className="mt-3 flex gap-3 text-[11px] uppercase tracking-wide text-white/40">
          <span>Open: {stats.openPopups}</span>
          <span>Items: {stats.totalItems}</span>
          <span>Pinned: {stats.pinnedPopups}</span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {items.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-white/50 px-4 text-center">
            No overlay folders are active yet. Toggle the overlay canvas to populate this list.
          </div>
        ) : (
          items.map(item => (
            <button
              key={item.id}
              onClick={() => onSelect?.(item.id)}
              className="w-full text-left px-4 py-3 border-b border-white/5 hover:bg-white/10 transition-colors"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="text-lg leading-none">{item.icon ?? '📁'}</span>
                  <div className="flex flex-col">
                    <span className="text-sm font-medium text-white/90">{item.name}</span>
                    {item.pinned && (
                      <span className="text-[10px] uppercase tracking-wider text-yellow-300/70">
                        Pinned
                      </span>
                    )}
                  </div>
                </div>
                <span className="text-xs font-semibold text-white/60 px-2 py-1 rounded-full bg-white/10">
                  {item.count}
                </span>
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  )
}
