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
      className={cn('flex flex-col overflow-hidden h-full', className)}
      style={{
        background: '#1e222a',
        border: '1px solid rgba(255, 255, 255, 0.1)',
        borderRadius: 12,
        boxShadow: '0 4px 24px rgba(0, 0, 0, 0.4)',
        ...(isActive ? { boxShadow: '0 4px 24px rgba(0, 0, 0, 0.4), 0 0 0 2px rgba(99, 102, 241, 0.3)' } : {}),
      }}
    >
      {/* Header - acts as drag handle */}
      <div
        className={cn('flex items-center justify-between cursor-grab select-none', headerClassName)}
        style={{
          padding: '10px 14px',
          borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
          borderRadius: '12px 12px 0 0',
        }}
      >
        <div className="flex items-center gap-2 min-w-0">
          <span style={{ fontSize: 14, opacity: 0.8 }} aria-hidden="true">
            {panelDef.icon}
          </span>
          <span className="truncate" style={{ fontSize: 13, fontWeight: 600, color: '#f0f0f0' }}>
            {panel.title || panelDef.name}
          </span>
        </div>
        <div className="flex items-center gap-1">
          {headerActions}
          {showCloseButton && onClose && (
            <button
              onClick={onClose}
              aria-label={`Close ${panelDef.name} panel`}
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
      </div>

      {/* Content */}
      <div
        className={cn('flex-1 overflow-auto', contentClassName)}
        style={{ padding: 14, color: '#f0f0f0' }}
      >
        {children}
      </div>
    </div>
  )
}
