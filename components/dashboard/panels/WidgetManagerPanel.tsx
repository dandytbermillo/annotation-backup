"use client"

/**
 * Widget Manager Panel (Drawer View)
 * Full panel version of WidgetManager for the FullPanelDrawer
 *
 * Renders widget management UI in the drawer when double-clicking WidgetManager widget.
 * Design inspired by: docs/proposal/components/workspace/ui/widget-template-demo.html
 */

import React, { useEffect, useState, useCallback } from 'react'
import { ExternalLink, RefreshCw, Loader2, FolderOpen, Store } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useToast } from '@/hooks/use-toast'
import type { BasePanelProps } from '@/lib/dashboard/panel-registry'

// =============================================================================
// Types
// =============================================================================

interface WidgetManifestIntent {
  name: string
  description?: string
  examples: string[]
}

interface WidgetManifest {
  panelId: string
  panelType?: string
  title: string
  icon?: string
  intents: WidgetManifestIntent[]
}

interface InstalledWidget {
  id: string
  name: string
  slug: string
  source_type: 'url' | 'file' | 'store' | 'builtin'
  source_ref: string | null
  version: string
  enabled: boolean
  created_at: string
  updated_at: string
  manifest: WidgetManifest
}

// =============================================================================
// API Functions
// =============================================================================

async function fetchWidgets(): Promise<InstalledWidget[]> {
  const response = await fetch('/api/widgets/list')
  if (!response.ok) throw new Error('Failed to fetch widgets')
  const data = await response.json()
  return data.widgets || []
}

async function toggleWidgetEnabled(id: string, enabled: boolean): Promise<void> {
  const response = await fetch('/api/widgets/enable', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, enabled }),
  })
  if (!response.ok) throw new Error('Failed to update widget')
}

interface InstallResult {
  success: boolean
  message?: string
  widget?: InstalledWidget
  error?: { code: string; message: string; field?: string }
}

async function installWidgetFromUrl(url: string): Promise<InstallResult> {
  const response = await fetch('/api/widgets/install', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  })
  return response.json()
}

async function installWidgetFromFile(file: File): Promise<InstallResult> {
  const formData = new FormData()
  formData.append('file', file)
  const response = await fetch('/api/widgets/install-file', {
    method: 'POST',
    body: formData,
  })
  return response.json()
}

async function uninstallWidget(id: string): Promise<{ success: boolean; message?: string; error?: string }> {
  const response = await fetch('/api/widgets/uninstall', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id }),
  })
  return response.json()
}

// =============================================================================
// Toggle Switch Component (from demo)
// =============================================================================

interface ToggleSwitchProps {
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
}

function ToggleSwitch({ checked, onChange, disabled }: ToggleSwitchProps) {
  return (
    <label className={cn('relative inline-block w-[42px] h-[24px] cursor-pointer', disabled && 'opacity-50 cursor-not-allowed')}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => !disabled && onChange(e.target.checked)}
        className="sr-only"
        disabled={disabled}
      />
      <span
        className={cn(
          'absolute inset-0 rounded-full transition-all duration-200',
          checked ? 'bg-blue-500' : 'bg-zinc-700 border border-white/10'
        )}
      />
      <span
        className={cn(
          'absolute w-[18px] h-[18px] left-[3px] top-[3px] rounded-full transition-all duration-200',
          checked ? 'translate-x-[18px] bg-white' : 'translate-x-0 bg-gray-400'
        )}
      />
    </label>
  )
}

// =============================================================================
// Status Dot Component
// =============================================================================

function StatusDot({ enabled }: { enabled: boolean }) {
  return (
    <span
      className={cn(
        'inline-block w-2 h-2 rounded-full',
        enabled ? 'bg-green-500' : 'bg-gray-500'
      )}
    />
  )
}

// =============================================================================
// Widget Icon Component
// =============================================================================

function WidgetIcon({ widget }: { widget: InstalledWidget }) {
  // Use manifest icon if available, otherwise default based on source type
  const icon = widget.manifest.icon

  if (icon) {
    // If icon is an emoji or text character, show it directly
    if (icon.length <= 2 || /^\p{Emoji}/u.test(icon)) {
      return (
        <div className="w-10 h-10 rounded-lg bg-white/5 flex items-center justify-center text-lg flex-shrink-0">
          {icon}
        </div>
      )
    }
    // If icon is a URL, show as image
    if (icon.startsWith('http') || icon.startsWith('/')) {
      return (
        <div className="w-10 h-10 rounded-lg bg-white/5 flex items-center justify-center overflow-hidden flex-shrink-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={icon} alt="" className="w-6 h-6 object-contain" />
        </div>
      )
    }
  }

  // Default icons based on source type
  const defaultIcons: Record<string, string> = {
    builtin: '⚙️',
    url: '🌐',
    file: '📁',
    store: '🏪',
  }

  return (
    <div className="w-10 h-10 rounded-lg bg-white/5 flex items-center justify-center text-lg flex-shrink-0">
      {defaultIcons[widget.source_type] || '📦'}
    </div>
  )
}

// =============================================================================
// Component
// =============================================================================

export function WidgetManagerPanel(_props: BasePanelProps) {
  const { toast } = useToast()
  const [widgets, setWidgets] = useState<InstalledWidget[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Install form state
  const [installUrl, setInstallUrl] = useState('')
  const [installing, setInstalling] = useState(false)
  const [installError, setInstallError] = useState<string | null>(null)

  // Load widgets
  const loadWidgets = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await fetchWidgets()
      setWidgets(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load widgets')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadWidgets()
  }, [loadWidgets])

  // Handle enable/disable toggle
  const handleToggle = useCallback(async (widget: InstalledWidget, enabled: boolean) => {
    setWidgets((prev) =>
      prev.map((w) => (w.id === widget.id ? { ...w, enabled } : w))
    )
    try {
      await toggleWidgetEnabled(widget.id, enabled)
      toast({
        title: enabled ? 'Widget Enabled' : 'Widget Disabled',
        description: `"${widget.name}" ${enabled ? 'enabled' : 'disabled'} for chat.`,
      })
    } catch {
      setWidgets((prev) =>
        prev.map((w) => (w.id === widget.id ? { ...w, enabled: !enabled } : w))
      )
    }
  }, [toast])

  // Handle install from URL
  const handleInstallFromUrl = useCallback(async () => {
    if (!installUrl.trim()) return
    setInstalling(true)
    setInstallError(null)
    try {
      const result = await installWidgetFromUrl(installUrl.trim())
      if (result.success && result.widget) {
        setWidgets((prev) => [...prev, result.widget!])
        setInstallUrl('')
        toast({ title: 'Widget Installed', description: `"${result.widget.name}" installed successfully.` })
      } else {
        setInstallError(result.error?.message || 'Failed to install widget')
      }
    } catch (err) {
      setInstallError(err instanceof Error ? err.message : 'Failed to install widget')
    } finally {
      setInstalling(false)
    }
  }, [installUrl, toast])

  // Handle install from file
  const handleInstallFromFile = useCallback(async (file: File) => {
    setInstalling(true)
    setInstallError(null)
    try {
      const result = await installWidgetFromFile(file)
      if (result.success && result.widget) {
        setWidgets((prev) => [...prev, result.widget!])
        toast({ title: 'Widget Installed', description: `"${result.widget.name}" installed from file.` })
      } else {
        setInstallError(result.error?.message || 'Failed to install widget')
      }
    } catch (err) {
      setInstallError(err instanceof Error ? err.message : 'Failed to install widget')
    } finally {
      setInstalling(false)
    }
  }, [toast])

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) handleInstallFromFile(file)
    e.target.value = ''
  }, [handleInstallFromFile])

  // Handle uninstall
  const handleUninstall = useCallback(async (widget: InstalledWidget) => {
    setWidgets((prev) => prev.filter((w) => w.id !== widget.id))
    try {
      const result = await uninstallWidget(widget.id)
      if (result.success) {
        toast({ title: 'Widget Uninstalled', description: `"${widget.name}" has been removed.` })
      } else {
        toast({ title: 'Failed to Uninstall', description: result.error || 'Unknown error', variant: 'destructive' })
        await loadWidgets()
      }
    } catch {
      toast({ title: 'Failed to Uninstall', description: 'An error occurred while uninstalling.', variant: 'destructive' })
      await loadWidgets()
    }
  }, [loadWidgets, toast])

  const builtinWidgets = widgets.filter((w) => w.source_type === 'builtin')
  const customWidgets = widgets.filter((w) => w.source_type !== 'builtin')

  // Render directly without BaseDashboardPanel wrapper (drawer provides header)
  return (
    <div className="flex flex-col h-full">
      {/* INSTALL NEW WIDGET section - always visible at top */}
      <div className="mb-4 p-4 rounded-xl bg-zinc-900/50 border border-white/[0.06]">
        <div className="text-xs uppercase text-gray-400 font-semibold tracking-wide mb-3">
          Install New Widget
        </div>

        {/* URL input row */}
        <div className="flex gap-2 mb-3">
          <input
            type="url"
            value={installUrl}
            onChange={(e) => setInstallUrl(e.target.value)}
            placeholder="Paste widget URL..."
            className="flex-1 px-3 py-2.5 text-sm bg-zinc-800/80 border border-white/10 rounded-lg text-white placeholder:text-gray-500 focus:outline-none focus:border-blue-500/50"
            onKeyDown={(e) => e.key === 'Enter' && handleInstallFromUrl()}
          />
          <button
            onClick={handleInstallFromUrl}
            disabled={installing || !installUrl.trim()}
            className="px-5 py-2.5 text-sm bg-blue-500 text-white font-medium rounded-lg hover:bg-blue-400 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {installing ? <Loader2 size={16} className="animate-spin" /> : 'Install'}
          </button>
        </div>

        {/* From File and Widget Store buttons */}
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => document.getElementById('widget-file-input-panel')?.click()}
            disabled={installing}
            className="flex items-center justify-center gap-2 px-4 py-3 bg-zinc-800/60 border border-white/10 rounded-lg text-gray-300 hover:bg-zinc-700/60 hover:text-white transition-colors disabled:opacity-50"
          >
            <FolderOpen size={18} className="text-gray-400" />
            <span className="text-sm">From File</span>
          </button>
          <input
            id="widget-file-input-panel"
            type="file"
            accept=".json"
            onChange={handleFileChange}
            className="hidden"
          />
          <button
            disabled
            className="flex items-center justify-center gap-2 px-4 py-3 bg-zinc-800/60 border border-white/10 rounded-lg text-gray-500 cursor-not-allowed opacity-60"
            title="Widget Store coming soon"
          >
            <Store size={18} />
            <span className="text-sm">Widget Store</span>
          </button>
        </div>

        {installError && (
          <div className="mt-2 text-xs text-red-400">{installError}</div>
        )}
      </div>

      {/* Loading/Error states */}
      {loading && (
        <div className="text-sm text-gray-500 py-8 text-center">Loading widgets...</div>
      )}
      {error && (
        <div className="text-sm text-red-400 py-8 text-center">{error}</div>
      )}

      {/* Widget lists */}
      {!loading && !error && (
        <div className="flex-1 overflow-y-auto space-y-4">
          {/* CUSTOM WIDGETS section */}
          {customWidgets.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="text-xs uppercase text-gray-400 font-semibold tracking-wide">
                  Custom Widgets
                </div>
                <span className="text-xs text-gray-500">
                  {customWidgets.length}
                </span>
              </div>
              <div className="space-y-3">
                {customWidgets.map((widget) => (
                  <WidgetCard
                    key={widget.id}
                    widget={widget}
                    onToggle={handleToggle}
                    onUninstall={handleUninstall}
                  />
                ))}
              </div>
            </div>
          )}

          {/* BUILT-IN WIDGETS section */}
          {builtinWidgets.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="text-xs uppercase text-gray-400 font-semibold tracking-wide">
                  Built-in Widgets
                </div>
                <span className="text-xs text-gray-500">
                  {builtinWidgets.length}
                </span>
              </div>
              <div className="space-y-3">
                {builtinWidgets.map((widget) => (
                  <WidgetCard
                    key={widget.id}
                    widget={widget}
                    onToggle={handleToggle}
                  />
                ))}
              </div>
            </div>
          )}

          {widgets.length === 0 && (
            <div className="text-sm text-gray-500 py-8 text-center">
              <div className="text-4xl mb-2 opacity-50">📦</div>
              No widgets installed
            </div>
          )}
        </div>
      )}

      {/* Refresh button at bottom */}
      <div className="pt-3 mt-3 border-t border-white/5">
        <button
          onClick={() => loadWidgets()}
          disabled={loading}
          className="w-full flex items-center justify-center gap-2 py-2 text-sm text-gray-400 hover:text-white transition-colors disabled:opacity-50"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>
    </div>
  )
}

// =============================================================================
// Widget Card Component (matches demo design)
// =============================================================================

interface WidgetCardProps {
  widget: InstalledWidget
  onToggle: (widget: InstalledWidget, enabled: boolean) => void
  onUninstall?: (widget: InstalledWidget) => void
}

function WidgetCard({ widget, onToggle, onUninstall }: WidgetCardProps) {
  const [confirmingUninstall, setConfirmingUninstall] = useState(false)

  const chatCommands = widget.manifest.intents
    .flatMap((i) => i.examples.slice(0, 2))
    .slice(0, 4)

  const isCustom = widget.source_type !== 'builtin'
  const displayUrl = widget.source_ref
    ? widget.source_ref.replace(/^https?:\/\//, '').split('/').slice(0, 2).join('/')
    : null

  return (
    <div
      className={cn(
        'rounded-xl p-4 transition-all duration-150',
        'bg-zinc-900/50 border border-white/[0.06]',
        !widget.enabled && 'opacity-70'
      )}
    >
      {/* Header: Icon, Name/URL, Toggle */}
      <div className="flex items-start gap-3 mb-3">
        <WidgetIcon widget={widget} />

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-base font-semibold text-white truncate">{widget.name}</span>
            {isCustom && widget.source_ref && (
              <a
                href={widget.source_ref}
                target="_blank"
                rel="noopener noreferrer"
                className="text-gray-500 hover:text-blue-400 transition-colors"
              >
                <ExternalLink size={12} />
              </a>
            )}
          </div>
          <div className="text-xs text-gray-500 truncate">
            {isCustom && displayUrl ? displayUrl : 'Built-in'}
          </div>
        </div>

        <ToggleSwitch
          checked={widget.enabled}
          onChange={(enabled) => onToggle(widget, enabled)}
        />
      </div>

      {/* Chat commands section */}
      <div className="bg-zinc-800/50 rounded-lg p-3">
        <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-gray-500 mb-2">
          <StatusDot enabled={widget.enabled} />
          <span>Chat Commands</span>
          {!widget.enabled && (
            <span className="text-red-400 ml-1">(Chat Off)</span>
          )}
        </div>
        {widget.enabled && chatCommands.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {chatCommands.map((cmd, i) => (
              <span
                key={i}
                className="text-xs px-2 py-1 rounded bg-cyan-500/15 text-cyan-400 font-mono"
              >
                &quot;{cmd}&quot;
              </span>
            ))}
          </div>
        ) : (
          <div className="text-xs text-gray-500">
            {widget.enabled ? 'No chat commands' : 'Enable widget to use chat commands'}
          </div>
        )}
      </div>

      {/* Footer: Version and Uninstall (custom widgets only) */}
      {isCustom && (
        <div className="flex items-center justify-between mt-3 pt-3 border-t border-white/5">
          <div className="text-xs text-gray-500">v{widget.version}</div>
          {onUninstall && !confirmingUninstall && (
            <button
              onClick={() => setConfirmingUninstall(true)}
              className="text-xs text-red-400/80 hover:text-red-400 transition-colors"
            >
              Uninstall
            </button>
          )}
          {confirmingUninstall && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-red-400">Uninstall?</span>
              <button
                onClick={() => { setConfirmingUninstall(false); onUninstall?.(widget) }}
                className="px-2 py-0.5 text-xs rounded bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors"
              >
                Yes
              </button>
              <button
                onClick={() => setConfirmingUninstall(false)}
                className="px-2 py-0.5 text-xs rounded bg-white/5 text-gray-400 hover:bg-white/10 transition-colors"
              >
                No
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default WidgetManagerPanel
