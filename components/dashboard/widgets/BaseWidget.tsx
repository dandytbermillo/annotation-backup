"use client"

/**
 * Base Widget Component
 * Part of Widget Architecture - macOS-style dashboard widgets
 *
 * Key differences from BaseDashboardPanel:
 * - No header/title bar (content IS the widget)
 * - No close button or menu
 * - Double-click opens full panel in drawer
 * - Compact, read-only summary view
 *
 * Design: Glassmorphism with subtle gradients and soft shadows
 */

import React, { forwardRef } from 'react'
import { cn } from '@/lib/utils'
import type { WorkspacePanel } from '@/lib/dashboard/panel-registry'

export interface BaseWidgetProps {
  /** The panel data */
  panel: WorkspacePanel
  /** Widget content */
  children: React.ReactNode
  /** Size variant */
  size?: 'small' | 'medium' | 'tall' | 'large'
  /** Double-click handler to open full panel drawer */
  onDoubleClick?: () => void
  /** Whether this widget is currently active/selected */
  isActive?: boolean
  /** Additional CSS classes */
  className?: string
  /** Mouse down handler for drag initiation */
  onMouseDown?: (e: React.MouseEvent) => void
}

/**
 * Size dimensions matching grid system
 * GRID_CELL_SIZE = 170px, PANEL_UNIT = 154px, GRID_GAP = 16px
 */
const sizeStyles: Record<string, string> = {
  small: 'min-h-[154px]',    // 1x1
  medium: 'min-h-[154px]',   // 2x1
  tall: 'min-h-[324px]',     // 1x2
  large: 'min-h-[324px]',    // 2x2
}

export const BaseWidget = forwardRef<HTMLDivElement, BaseWidgetProps>(
  function BaseWidget(
    {
      panel,
      children,
      size = 'small',
      onDoubleClick,
      isActive = false,
      className,
      onMouseDown,
    },
    ref
  ) {
    return (
      <div
        ref={ref}
        className={cn(
          // Base layout
          'relative w-full h-full rounded-2xl p-4 cursor-pointer select-none overflow-hidden',
          'transition-all duration-300 ease-out',
          // Glassmorphism background
          'bg-slate-800/90 backdrop-blur-xl',
          // Border
          'border border-white/10',
          // Soft ambient shadow
          'shadow-lg shadow-black/20',
          // Hover effects
          'hover:border-indigo-500/30 hover:shadow-xl hover:shadow-indigo-500/10',
          'hover:scale-[1.01]',
          // Active press effect
          'active:scale-[0.99]',
          // Active selection state
          isActive && 'ring-1 ring-indigo-500/40 border-indigo-500/30',
          // Size variant
          sizeStyles[size],
          className
        )}
        onDoubleClick={onDoubleClick}
        onMouseDown={onMouseDown}
        data-panel-id={panel.id}
        data-panel-type={panel.panelType}
        style={{
          // Fallback inline styles for gradient + top highlight
          background: 'linear-gradient(135deg, rgba(30,34,43,0.95) 0%, rgba(26,30,38,0.95) 100%)',
          boxShadow: '0 4px 24px rgba(0,0,0,0.25), 0 1px 3px rgba(0,0,0,0.15), inset 0 1px 0 rgba(255,255,255,0.06)',
        }}
      >
        {/* Inner content wrapper for z-index stacking */}
        <div className="relative z-10 h-full flex flex-col">
          {children}
        </div>
      </div>
    )
  }
)

// ============ Shared Widget Sub-Components ============

/** Widget label - small uppercase text (e.g., "RECENT", "QUICK LINKS A") */
export function WidgetLabel({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'text-[10px] font-semibold uppercase tracking-[0.08em] mb-3',
        'text-gray-400/80',
        className
      )}
    >
      {children}
    </div>
  )
}

/** Widget value - large prominent number/stat */
export function WidgetValue({ children, unit, className }: { children: React.ReactNode; unit?: string; className?: string }) {
  return (
    <div className={cn('flex items-baseline gap-1', className)}>
      <span className="text-[36px] font-bold text-white leading-none tracking-tight">
        {children}
      </span>
      {unit && (
        <span className="text-sm font-medium text-gray-400 ml-0.5">{unit}</span>
      )}
    </div>
  )
}

/** Widget subtitle - accent colored text below value */
export function WidgetSubtitle({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('text-[13px] text-indigo-400/90 mt-1.5 font-medium', className)}>
      {children}
    </div>
  )
}

/** Widget list container */
export function WidgetList({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <ul className={cn('list-none m-0 p-0 space-y-0.5', className)}>
      {children}
    </ul>
  )
}

/** Widget list item */
export function WidgetListItem({
  icon,
  children,
  className
}: {
  icon?: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  return (
    <li className={cn(
      'flex items-center gap-2.5 py-1.5 px-1 -mx-1 rounded-lg',
      'transition-colors duration-150',
      'hover:bg-white/[0.03]',
      className
    )}>
      {icon && (
        <div className="w-6 h-6 bg-white/[0.06] rounded-md flex items-center justify-center flex-shrink-0 text-gray-400/80">
          {icon}
        </div>
      )}
      <span className="text-[13px] text-gray-300/90 truncate font-medium">{children}</span>
    </li>
  )
}

/** Widget list item with gradient icon (for workspaces) */
export function WidgetListItemGradient({
  letter,
  children,
  className
}: {
  letter: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <li className={cn(
      'flex items-center gap-2.5 py-1.5 px-1 -mx-1 rounded-lg',
      'transition-colors duration-150',
      'hover:bg-white/[0.03]',
      className
    )}>
      <div className="w-6 h-6 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-md flex items-center justify-center text-[11px] font-bold flex-shrink-0 text-white shadow-sm shadow-indigo-500/25">
        {letter}
      </div>
      <span className="text-[13px] text-gray-300/90 truncate font-medium">{children}</span>
    </li>
  )
}

/** Widget empty state */
export function WidgetEmpty({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn(
      'flex-1 flex items-center justify-center',
      'text-[13px] text-gray-500 text-center py-4',
      className
    )}>
      {children}
    </div>
  )
}

/** Widget content wrapper with margin-top */
export function WidgetContent({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('mt-2 flex-1', className)}>
      {children}
    </div>
  )
}

/** Widget text preview (for notes-style widgets) */
export function WidgetPreview({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <p
      className={cn(
        'text-sm text-gray-400/90 leading-relaxed mt-2',
        'line-clamp-4', // Truncate at 4 lines
        className
      )}
    >
      {children}
    </p>
  )
}

/** Widget footer - positioned at bottom */
export function WidgetFooter({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn(
      'mt-auto pt-3 border-t border-white/[0.04]',
      'text-[11px] text-gray-500',
      className
    )}>
      {children}
    </div>
  )
}

export default BaseWidget
