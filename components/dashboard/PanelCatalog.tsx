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
    'rounded-xl overflow-hidden',
    mode === 'dropdown' && 'w-64 max-h-80 overflow-auto',
    mode === 'modal' && 'w-96 max-h-[80vh] overflow-auto',
    mode === 'inline' && 'w-full'
  )

  return (
    <div
      className={containerClass}
      style={{
        background: '#1e222a',
        border: '1px solid rgba(255, 255, 255, 0.1)',
        boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
      }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-3 py-2"
        style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.08)' }}
      >
        <span className="text-sm font-medium" style={{ color: '#f0f0f0' }}>
          Add Panel
        </span>
        {onClose && (
          <button
            onClick={onClose}
            aria-label="Close panel catalog"
            style={{
              width: 24,
              height: 24,
              background: 'transparent',
              border: 'none',
              borderRadius: 4,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              color: '#5c6070',
            }}
          >
            <X size={14} />
          </button>
        )}
      </div>

      {/* Error message */}
      {error && (
        <div className="px-3 py-2" style={{ background: 'rgba(239,68,68,0.1)', borderBottom: '1px solid rgba(239,68,68,0.2)' }}>
          <p className="text-xs" style={{ color: '#ef4444' }}>{error}</p>
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
              'w-full flex items-start gap-3 p-3 rounded-lg text-left transition-all',
              isAdding !== null && isAdding !== panelType.id && 'opacity-50'
            )}
            style={{
              background: isAdding === panelType.id ? 'rgba(255, 255, 255, 0.04)' : 'transparent',
              border: 'none',
              cursor: 'pointer',
            }}
            onMouseEnter={(e) => {
              if (isAdding !== panelType.id) e.currentTarget.style.background = 'rgba(255, 255, 255, 0.04)'
            }}
            onMouseLeave={(e) => {
              if (isAdding !== panelType.id) e.currentTarget.style.background = 'transparent'
            }}
          >
            {/* Icon */}
            <span className="text-xl shrink-0 mt-0.5">{panelType.icon}</span>

            {/* Info */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium" style={{ color: '#f0f0f0' }}>
                  {panelType.name}
                </span>
                {isAdding === panelType.id && (
                  <Loader2 size={12} className="animate-spin" style={{ color: '#5c6070' }} />
                )}
              </div>
              <p className="text-xs mt-0.5 line-clamp-2" style={{ color: '#8b8fa3' }}>
                {panelType.description}
              </p>
            </div>

            {/* Add indicator */}
            <Plus size={16} className="shrink-0 mt-0.5" style={{ color: '#5c6070' }} />
          </button>
        ))}
      </div>

      {/* Size hints */}
      {mode !== 'dropdown' && (
        <div className="px-3 py-2" style={{ borderTop: '1px solid rgba(255, 255, 255, 0.08)' }}>
          <p className="text-xs" style={{ color: '#8b8fa3' }}>
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
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-1.5"
        style={{
          padding: '7px 14px',
          borderRadius: 8,
          background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
          color: '#fff',
          border: 'none',
          fontSize: 13,
          fontWeight: 500,
          cursor: 'pointer',
          boxShadow: isOpen ? '0 0 0 2px rgba(99, 102, 241, 0.3)' : 'none',
        }}
      >
        <Plus size={14} />
        Add Panel
      </button>

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
