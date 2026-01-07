"use client"

/**
 * Widget Manager - Manage Installed Widgets
 *
 * Phase 1 + Phase 2 Implementation:
 * - Lists all installed widgets (builtin + custom)
 * - Enable/disable widgets for chat integration
 * - Shows chat commands preview for each widget
 * - Install widgets from URL (Phase 2)
 * - Uninstall custom widgets (Phase 2)
 *
 * Reference: docs/proposal/chat-navigation/plan/panels/widget_manager/widget-manager-plan.md
 */

import React, { useEffect, useState, useCallback } from 'react'
import { Settings, Power, MessageCircle, ExternalLink, Plus, Trash2, RefreshCw, Loader2, LayoutDashboard, Upload, FileJson } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useToast } from '@/hooks/use-toast'
import type { WorkspacePanel } from '@/lib/dashboard/panel-registry'
import { upsertWidgetState, removeWidgetState } from '@/lib/widgets/widget-state-store'
import {
  BaseWidget,
  WidgetLabel,
} from './BaseWidget'

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

interface AddToDashboardResult {
  success: boolean
  instance?: {
    id: string
    panel_id: string
  }
  error?: string
}

async function addWidgetToDashboard(
  widgetId: string,
  options?: { workspaceId?: string; entryId?: string; panelId?: string }
): Promise<AddToDashboardResult> {
  const response = await fetch('/api/widgets/instances', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      widgetId,
      workspaceId: options?.workspaceId,
      entryId: options?.entryId,
      panelId: options?.panelId,
    }),
  })
  return response.json()
}

// =============================================================================
// Widget Component
// =============================================================================

export interface WidgetManagerProps {
  /** The panel data */
  panel: WorkspacePanel
  /** Double-click handler to open full panel drawer */
  onDoubleClick: () => void
  /** Whether this widget is currently active/selected */
  isActive?: boolean
  /** Mouse down handler for drag initiation */
  onMouseDown?: (e: React.MouseEvent) => void
}

export function WidgetManager({
  panel,
  onDoubleClick,
  isActive = false,
  onMouseDown,
}: WidgetManagerProps) {
  const { toast } = useToast()
  const [widgets, setWidgets] = useState<InstalledWidget[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Install form state
  const [installUrl, setInstallUrl] = useState('')
  const [installing, setInstalling] = useState(false)
  const [installError, setInstallError] = useState<string | null>(null)
  const [showInstallForm, setShowInstallForm] = useState(false)

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

  // Fetch widgets on mount
  useEffect(() => {
    loadWidgets()
  }, [loadWidgets])

  // Handle enable/disable toggle
  const handleToggle = useCallback(async (widget: InstalledWidget) => {
    const newEnabled = !widget.enabled
    // Optimistic update
    setWidgets((prev) =>
      prev.map((w) => (w.id === widget.id ? { ...w, enabled: newEnabled } : w))
    )
    try {
      await toggleWidgetEnabled(widget.id, newEnabled)
    } catch {
      // Revert on error
      setWidgets((prev) =>
        prev.map((w) => (w.id === widget.id ? { ...w, enabled: !newEnabled } : w))
      )
    }
  }, [])

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
        setShowInstallForm(false)
        toast({
          title: 'Widget Installed',
          description: `"${result.widget.name}" installed successfully.`,
        })
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
        setShowInstallForm(false)
        toast({
          title: 'Widget Installed',
          description: `"${result.widget.name}" installed from file.`,
        })
      } else {
        setInstallError(result.error?.message || 'Failed to install widget')
      }
    } catch (err) {
      setInstallError(err instanceof Error ? err.message : 'Failed to install widget')
    } finally {
      setInstalling(false)
    }
  }, [toast])

  // Handle file input change
  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      handleInstallFromFile(file)
    }
    // Reset input so same file can be selected again
    e.target.value = ''
  }, [handleInstallFromFile])

  // Handle drag and drop
  const [isDragging, setIsDragging] = useState(false)
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }, [])
  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
  }, [])
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    const file = e.dataTransfer.files?.[0]
    if (file && file.name.endsWith('.json')) {
      handleInstallFromFile(file)
    } else if (file) {
      setInstallError('Please drop a .json file')
    }
  }, [handleInstallFromFile])

  // Handle uninstall (confirmation is handled inline in WidgetListRow)
  const handleUninstall = useCallback(async (widget: InstalledWidget) => {
    // Optimistic removal
    setWidgets((prev) => prev.filter((w) => w.id !== widget.id))

    try {
      const result = await uninstallWidget(widget.id)
      if (result.success) {
        toast({
          title: 'Widget Uninstalled',
          description: `"${widget.name}" has been removed.`,
        })
      } else {
        // Restore on error
        toast({
          title: 'Failed to Uninstall',
          description: result.error || 'Unknown error',
          variant: 'destructive',
        })
        await loadWidgets()
      }
    } catch {
      // Restore on error
      toast({
        title: 'Failed to Uninstall',
        description: 'An error occurred while uninstalling.',
        variant: 'destructive',
      })
      await loadWidgets()
    }
  }, [loadWidgets, toast])

  // Handle add to dashboard
  const [addingWidget, setAddingWidget] = useState<string | null>(null)
  const handleAddToDashboard = useCallback(async (widget: InstalledWidget) => {
    setAddingWidget(widget.id)
    try {
      const result = await addWidgetToDashboard(widget.id)
      if (result.success) {
        toast({
          title: 'Added to Dashboard',
          description: `"${widget.name}" added as panel: ${result.instance?.panel_id}`,
        })
      } else {
        toast({
          title: 'Failed to Add',
          description: result.error || 'Unknown error',
          variant: 'destructive',
        })
      }
    } catch (err) {
      toast({
        title: 'Failed to Add',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      })
    } finally {
      setAddingWidget(null)
    }
  }, [toast])

  // Separate builtin vs custom
  const builtinWidgets = widgets.filter((w) => w.source_type === 'builtin')
  const customWidgets = widgets.filter((w) => w.source_type !== 'builtin')
  const enabledCount = widgets.filter((w) => w.enabled).length

  // Widget Chat State: Report internal state for LLM context
  useEffect(() => {
    // Only report once loaded
    if (loading) return

    const summary = error
      ? 'Error loading widgets'
      : widgets.length === 0
        ? 'No widgets installed'
        : `${enabledCount} of ${widgets.length} widgets enabled`

    upsertWidgetState({
      _version: 1,
      widgetId: 'widget-manager',
      instanceId: panel.id,
      title: 'Widget Manager',
      view: showInstallForm ? 'install_form' : 'list',
      selection: null,
      summary,
      updatedAt: Date.now(),
      counts: {
        total: widgets.length,
        enabled: enabledCount,
        builtin: builtinWidgets.length,
        custom: customWidgets.length,
      },
    })

    return () => {
      removeWidgetState(panel.id)
    }
  }, [panel.id, loading, error, widgets.length, enabledCount, builtinWidgets.length, customWidgets.length, showInstallForm])

  return (
    <BaseWidget
      panel={panel}
      onDoubleClick={onDoubleClick}
      isActive={isActive}
      onMouseDown={onMouseDown}
      size="tall"
    >
      <WidgetLabel>
        Widget Manager
        <Settings size={12} className="ml-1 text-blue-400 inline" />
      </WidgetLabel>

      {/* Header with actions */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-baseline gap-1">
          <span className="text-2xl font-bold text-white">{enabledCount}</span>
          <span className="text-sm text-gray-400">
            / {widgets.length} enabled
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setShowInstallForm(!showInstallForm)}
            className={cn(
              'p-1.5 rounded transition-colors',
              showInstallForm
                ? 'bg-blue-500/20 text-blue-400'
                : 'text-gray-400 hover:bg-white/5 hover:text-white'
            )}
            title="Install widget"
          >
            <Plus size={14} />
          </button>
          <button
            onClick={() => loadWidgets()}
            disabled={loading}
            className="p-1.5 rounded text-gray-400 hover:bg-white/5 hover:text-white transition-colors disabled:opacity-50"
            title="Refresh"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Install form */}
      {showInstallForm && (
        <div className="mb-3 p-2 rounded-lg bg-white/[0.03] border border-white/[0.08]">
          {/* URL install section */}
          <div className="text-[10px] uppercase text-blue-400/80 font-semibold tracking-wide mb-2">
            Install from URL
          </div>
          <div className="flex gap-2">
            <input
              type="url"
              value={installUrl}
              onChange={(e) => setInstallUrl(e.target.value)}
              placeholder="https://example.com/widget-manifest.json"
              className="flex-1 px-2 py-1.5 text-xs bg-black/30 border border-white/10 rounded text-white placeholder:text-gray-500 focus:outline-none focus:border-blue-500/50"
              onKeyDown={(e) => e.key === 'Enter' && handleInstallFromUrl()}
            />
            <button
              onClick={handleInstallFromUrl}
              disabled={installing || !installUrl.trim()}
              className="px-3 py-1.5 text-xs bg-blue-500/20 text-blue-400 rounded hover:bg-blue-500/30 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-1"
            >
              {installing ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
              Install
            </button>
          </div>
          <div className="mt-2 text-[10px] text-gray-500">
            Try: <button
              onClick={() => setInstallUrl(`${window.location.origin}/api/widgets/sample-manifest`)}
              className="text-blue-400 hover:underline"
            >
              sample manifest
            </button>
          </div>

          {/* Divider */}
          <div className="flex items-center gap-2 my-3">
            <div className="flex-1 h-px bg-white/10" />
            <span className="text-[10px] text-gray-500">or</span>
            <div className="flex-1 h-px bg-white/10" />
          </div>

          {/* File upload section */}
          <div className="text-[10px] uppercase text-purple-400/80 font-semibold tracking-wide mb-2">
            Install from File
          </div>
          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={cn(
              'flex flex-col items-center justify-center gap-2 p-3 rounded border-2 border-dashed transition-colors cursor-pointer',
              isDragging
                ? 'border-purple-400 bg-purple-500/10'
                : 'border-white/10 hover:border-purple-400/50 hover:bg-purple-500/5'
            )}
            onClick={() => document.getElementById('widget-file-input')?.click()}
          >
            <input
              id="widget-file-input"
              type="file"
              accept=".json"
              onChange={handleFileChange}
              className="hidden"
            />
            {installing ? (
              <Loader2 size={20} className="text-purple-400 animate-spin" />
            ) : (
              <FileJson size={20} className="text-purple-400/60" />
            )}
            <div className="text-[10px] text-gray-400 text-center">
              {isDragging ? (
                <span className="text-purple-400">Drop JSON file here</span>
              ) : (
                <>
                  <span className="text-purple-400 hover:underline">Choose file</span>
                  {' '}or drag & drop
                </>
              )}
            </div>
          </div>

          {/* Error display */}
          {installError && (
            <div className="mt-2 text-[10px] text-red-400">{installError}</div>
          )}
        </div>
      )}

      {/* Loading/Error states */}
      {loading && (
        <div className="text-sm text-gray-500 py-4 text-center">Loading widgets...</div>
      )}
      {error && (
        <div className="text-sm text-red-400 py-4 text-center">{error}</div>
      )}

      {/* Widget lists */}
      {!loading && !error && (
        <div className="flex-1 overflow-y-auto space-y-4 -mx-1 px-1">
          {/* Custom widgets */}
          {customWidgets.length > 0 && (
            <div>
              <div className="text-[10px] uppercase text-orange-400/80 font-semibold tracking-wide mb-2">
                Custom ({customWidgets.length})
              </div>
              <div className="space-y-2">
                {customWidgets.map((widget) => (
                  <WidgetListRow
                    key={widget.id}
                    widget={widget}
                    onToggle={handleToggle}
                    onUninstall={handleUninstall}
                    onAddToDashboard={handleAddToDashboard}
                    isAdding={addingWidget === widget.id}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Builtin widgets */}
          {builtinWidgets.length > 0 && (
            <div>
              <div className="text-[10px] uppercase text-teal-400/80 font-semibold tracking-wide mb-2">
                Built-in ({builtinWidgets.length})
              </div>
              <div className="space-y-2">
                {builtinWidgets.map((widget) => (
                  <WidgetListRow
                    key={widget.id}
                    widget={widget}
                    onToggle={handleToggle}
                    onAddToDashboard={handleAddToDashboard}
                    isAdding={addingWidget === widget.id}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Empty state */}
          {widgets.length === 0 && (
            <div className="text-sm text-gray-500 py-8 text-center">
              No widgets installed
            </div>
          )}
        </div>
      )}

      {/* Footer hint */}
      <div className="mt-auto pt-2 border-t border-white/[0.04] text-[10px] text-gray-500">
        Double-click to manage widgets
      </div>
    </BaseWidget>
  )
}

// =============================================================================
// Widget List Row
// =============================================================================

interface WidgetListRowProps {
  widget: InstalledWidget
  onToggle: (widget: InstalledWidget) => void
  onUninstall?: (widget: InstalledWidget) => void
  onAddToDashboard?: (widget: InstalledWidget) => void
  isAdding?: boolean
}

function WidgetListRow({ widget, onToggle, onUninstall, onAddToDashboard, isAdding }: WidgetListRowProps) {
  const [confirmingUninstall, setConfirmingUninstall] = useState(false)

  const chatCommands = widget.manifest.intents
    .flatMap((i) => i.examples.slice(0, 2))
    .slice(0, 3)

  const handleUninstallClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    setConfirmingUninstall(true)
  }

  const handleConfirmUninstall = (e: React.MouseEvent) => {
    e.stopPropagation()
    setConfirmingUninstall(false)
    onUninstall?.(widget)
  }

  const handleCancelUninstall = (e: React.MouseEvent) => {
    e.stopPropagation()
    setConfirmingUninstall(false)
  }

  return (
    <div
      className={cn(
        'rounded-lg p-2.5 transition-all duration-150',
        'bg-white/[0.03] border border-white/[0.05]',
        widget.enabled
          ? 'border-white/[0.08]'
          : 'opacity-60'
      )}
    >
      {/* Header row */}
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm font-medium text-white truncate">
            {widget.name}
          </span>
          {widget.source_type !== 'builtin' && (
            <ExternalLink size={10} className="text-orange-400/60 flex-shrink-0" />
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1">
          {/* Add to Dashboard button */}
          {onAddToDashboard && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                onAddToDashboard(widget)
              }}
              disabled={isAdding}
              className="p-1 rounded text-gray-500 hover:text-purple-400 hover:bg-purple-500/10 transition-colors disabled:opacity-50"
              title="Add to dashboard"
            >
              {isAdding ? <Loader2 size={14} className="animate-spin" /> : <LayoutDashboard size={14} />}
            </button>
          )}

          {/* Toggle button */}
          <button
            onClick={(e) => {
              e.stopPropagation()
              onToggle(widget)
            }}
            className={cn(
              'p-1 rounded transition-colors',
              widget.enabled
                ? 'text-green-400 hover:bg-green-500/10'
                : 'text-gray-500 hover:bg-gray-500/10'
            )}
            title={widget.enabled ? 'Disable for chat' : 'Enable for chat'}
          >
            <Power size={14} />
          </button>

          {/* Uninstall button (custom widgets only) */}
          {onUninstall && widget.source_type !== 'builtin' && !confirmingUninstall && (
            <button
              onClick={handleUninstallClick}
              className="p-1 rounded text-gray-500 hover:text-red-400 hover:bg-red-500/10 transition-colors"
              title="Uninstall widget"
            >
              <Trash2 size={14} />
            </button>
          )}

          {/* Inline uninstall confirmation */}
          {confirmingUninstall && (
            <div className="flex items-center gap-1">
              <span className="text-[10px] text-red-400 mr-1">Uninstall?</span>
              <button
                onClick={handleConfirmUninstall}
                className="px-1.5 py-0.5 text-[10px] rounded bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors"
              >
                Yes
              </button>
              <button
                onClick={handleCancelUninstall}
                className="px-1.5 py-0.5 text-[10px] rounded bg-white/5 text-gray-400 hover:bg-white/10 transition-colors"
              >
                No
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Chat commands preview */}
      {widget.enabled && chatCommands.length > 0 && (
        <div className="flex items-start gap-1.5 mt-1.5">
          <MessageCircle size={10} className="text-blue-400/60 mt-0.5 flex-shrink-0" />
          <div className="flex flex-wrap gap-1">
            {chatCommands.map((cmd, i) => (
              <span
                key={i}
                className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400/80"
              >
                "{cmd}"
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Disabled state message */}
      {!widget.enabled && (
        <div className="text-[10px] text-gray-500 mt-1">
          Chat commands disabled
        </div>
      )}
    </div>
  )
}

export default WidgetManager
