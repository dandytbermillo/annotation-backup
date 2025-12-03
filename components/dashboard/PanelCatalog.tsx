"use client"

/**
 * Panel Catalog Component
 * Part of Dashboard Implementation - Phase 2.3
 *
 * Provides a UI for users to browse available panel types and add them
 * to their dashboard/workspace. Can be used as a dropdown, modal, or sidebar.
 */

import React, { useState } from 'react'
import { Plus, X, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  getAllPanelTypes,
  getDashboardPanelTypes,
  type PanelTypeDefinition,
  type PanelTypeId,
} from '@/lib/dashboard/panel-registry'
import { cn } from '@/lib/utils'

interface PanelCatalogProps {
  workspaceId: string
  onPanelAdded?: (panelId: string, panelType: PanelTypeId) => void
  onClose?: () => void
  /** If true, show all panel types including note. Otherwise show dashboard-only types */
  showAllTypes?: boolean
  /** Default position for new panels */
  defaultPosition?: { x: number; y: number }
  /** Mode: 'dropdown' (compact), 'modal' (full), 'inline' (embedded) */
  mode?: 'dropdown' | 'modal' | 'inline'
}

export function PanelCatalog({
  workspaceId,
  onPanelAdded,
  onClose,
  showAllTypes = false,
  defaultPosition = { x: 100, y: 100 },
  mode = 'dropdown',
}: PanelCatalogProps) {
  const [isAdding, setIsAdding] = useState<PanelTypeId | null>(null)
  const [error, setError] = useState<string | null>(null)

  const panelTypes = showAllTypes ? getAllPanelTypes() : getDashboardPanelTypes()

  const handleAddPanel = async (panelType: PanelTypeDefinition) => {
    if (isAdding) return

    try {
      setIsAdding(panelType.id)
      setError(null)

      const response = await fetch('/api/dashboard/panels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspaceId,
          panelType: panelType.id,
          positionX: defaultPosition.x,
          positionY: defaultPosition.y,
        }),
      })

      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to add panel')
      }

      const data = await response.json()
      onPanelAdded?.(data.panel.id, panelType.id)

      // Close catalog after successful add in dropdown mode
      if (mode === 'dropdown') {
        onClose?.()
      }
    } catch (err) {
      console.error('[PanelCatalog] Failed to add panel:', err)
      setError(err instanceof Error ? err.message : 'Failed to add panel')
    } finally {
      setIsAdding(null)
    }
  }

  const containerClass = cn(
    'bg-popover border border-border rounded-lg shadow-lg',
    mode === 'dropdown' && 'w-64 max-h-80 overflow-auto',
    mode === 'modal' && 'w-96 max-h-[80vh] overflow-auto',
    mode === 'inline' && 'w-full'
  )

  return (
    <div className={containerClass}>
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <span className="text-sm font-medium text-foreground">Add Panel</span>
        {onClose && (
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Close panel catalog"
          >
            <X size={14} />
          </button>
        )}
      </div>

      {/* Error message */}
      {error && (
        <div className="px-3 py-2 bg-destructive/10 border-b border-destructive/20">
          <p className="text-xs text-destructive">{error}</p>
        </div>
      )}

      {/* Panel types list */}
      <div className="p-2 space-y-1">
        {panelTypes.map(panelType => (
          <button
            key={panelType.id}
            onClick={() => handleAddPanel(panelType)}
            disabled={isAdding !== null}
            className={cn(
              'w-full flex items-start gap-3 p-2 rounded-md text-left transition-colors',
              'hover:bg-muted/50 focus:bg-muted/50 focus:outline-none',
              isAdding === panelType.id && 'bg-muted/50',
              isAdding !== null && isAdding !== panelType.id && 'opacity-50'
            )}
          >
            {/* Icon */}
            <span className="text-xl shrink-0 mt-0.5">{panelType.icon}</span>

            {/* Info */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-foreground">
                  {panelType.name}
                </span>
                {isAdding === panelType.id && (
                  <Loader2 size={12} className="animate-spin text-muted-foreground" />
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                {panelType.description}
              </p>
            </div>

            {/* Add indicator */}
            <Plus size={16} className="shrink-0 text-muted-foreground mt-0.5" />
          </button>
        ))}
      </div>

      {/* Size hints */}
      {mode !== 'dropdown' && (
        <div className="px-3 py-2 border-t border-border">
          <p className="text-xs text-muted-foreground">
            Panels can be resized and repositioned after adding.
          </p>
        </div>
      )}
    </div>
  )
}

/**
 * Floating Add Panel Button
 * A button that opens the panel catalog as a dropdown
 */
interface AddPanelButtonProps {
  workspaceId: string
  onPanelAdded?: (panelId: string, panelType: PanelTypeId) => void
  showAllTypes?: boolean
  defaultPosition?: { x: number; y: number }
  className?: string
}

export function AddPanelButton({
  workspaceId,
  onPanelAdded,
  showAllTypes,
  defaultPosition,
  className,
}: AddPanelButtonProps) {
  const [isOpen, setIsOpen] = useState(false)

  return (
    <div className={cn('relative', className)}>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setIsOpen(!isOpen)}
        className="gap-1"
      >
        <Plus size={14} />
        Add Panel
      </Button>

      {isOpen && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-40"
            onClick={() => setIsOpen(false)}
          />

          {/* Dropdown */}
          <div className="absolute top-full left-0 mt-1 z-50">
            <PanelCatalog
              workspaceId={workspaceId}
              onPanelAdded={(panelId, panelType) => {
                onPanelAdded?.(panelId, panelType)
                setIsOpen(false)
              }}
              onClose={() => setIsOpen(false)}
              showAllTypes={showAllTypes}
              defaultPosition={defaultPosition}
              mode="dropdown"
            />
          </div>
        </>
      )}
    </div>
  )
}
