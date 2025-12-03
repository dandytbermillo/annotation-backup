"use client"

/**
 * Base Dashboard Panel Component
 * Part of Dashboard Implementation - Phase 2.2
 *
 * Provides a consistent wrapper for all dashboard panel types.
 * Handles common functionality: header, close button, drag handle area.
 */

import React from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { BasePanelProps, PanelTypeDefinition } from '@/lib/dashboard/panel-registry'

export interface BaseDashboardPanelProps extends BasePanelProps {
  panelDef: PanelTypeDefinition
  children: React.ReactNode
  className?: string
  headerClassName?: string
  contentClassName?: string
  showCloseButton?: boolean
  headerActions?: React.ReactNode
}

export function BaseDashboardPanel({
  panel,
  panelDef,
  onClose,
  isActive,
  children,
  className,
  headerClassName,
  contentClassName,
  showCloseButton = true,
  headerActions,
}: BaseDashboardPanelProps) {
  return (
    <div
      className={cn(
        'flex flex-col bg-card border border-border rounded-lg shadow-sm overflow-hidden',
        isActive && 'ring-2 ring-primary/50',
        className
      )}
    >
      {/* Header - acts as drag handle */}
      <div
        className={cn(
          'dashboard-panel-header flex items-center justify-between px-3 py-2 bg-muted/50 border-b border-border cursor-move select-none',
          headerClassName
        )}
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-base" aria-hidden="true">
            {panelDef.icon}
          </span>
          <span className="text-sm font-medium text-foreground truncate">
            {panel.title || panelDef.name}
          </span>
        </div>
        <div className="flex items-center gap-1">
          {headerActions}
          {showCloseButton && onClose && (
            <button
              onClick={onClose}
              className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
              aria-label={`Close ${panelDef.name} panel`}
            >
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      <div className={cn('flex-1 overflow-auto', contentClassName)}>
        {children}
      </div>
    </div>
  )
}
