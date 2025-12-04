"use client"

/**
 * Panel Skeleton Loading States
 * Part of Dashboard Implementation - Phase 4.4
 *
 * Provides skeleton placeholders for panel content while loading.
 */

import React from 'react'
import { cn } from '@/lib/utils'

interface PanelSkeletonProps {
  className?: string
}

// Dark theme skeleton bar
function SkeletonBar({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <div
      className={cn('animate-pulse rounded', className)}
      style={{
        background: 'rgba(255, 255, 255, 0.06)',
        ...style,
      }}
    />
  )
}

/**
 * Skeleton for ContinuePanel content
 */
export function ContinuePanelSkeleton({ className }: PanelSkeletonProps) {
  return (
    <div className={cn('flex flex-col gap-3 p-4', className)}>
      <div className="flex flex-col gap-1">
        <SkeletonBar style={{ height: 20, width: '75%' }} />
        <SkeletonBar style={{ height: 12, width: '50%' }} />
        <SkeletonBar style={{ height: 12, width: '33%', marginTop: 4 }} />
      </div>
      <SkeletonBar style={{ height: 32, width: '100%' }} />
    </div>
  )
}

/**
 * Skeleton for EntryNavigatorPanel content
 */
export function NavigatorPanelSkeleton({ className }: PanelSkeletonProps) {
  return (
    <div className={cn('flex flex-col gap-1 p-2', className)}>
      {/* Root level items */}
      <div className="flex items-center gap-2 py-1.5 px-2">
        <SkeletonBar style={{ height: 16, width: 16 }} className="shrink-0" />
        <SkeletonBar style={{ height: 16, width: 16 }} className="shrink-0" />
        <SkeletonBar style={{ height: 16, width: 96 }} />
      </div>
      <div className="flex items-center gap-2 py-1.5 px-2">
        <SkeletonBar style={{ height: 16, width: 16 }} className="shrink-0" />
        <SkeletonBar style={{ height: 16, width: 16 }} className="shrink-0" />
        <SkeletonBar style={{ height: 16, width: 128 }} />
      </div>
      {/* Nested items */}
      <div className="flex items-center gap-2 py-1.5 px-2 ml-4">
        <SkeletonBar style={{ height: 12, width: 12 }} className="shrink-0" />
        <SkeletonBar style={{ height: 12, width: 12 }} className="shrink-0" />
        <SkeletonBar style={{ height: 12, width: 80 }} />
      </div>
      <div className="flex items-center gap-2 py-1.5 px-2 ml-4">
        <SkeletonBar style={{ height: 12, width: 12 }} className="shrink-0" />
        <SkeletonBar style={{ height: 12, width: 12 }} className="shrink-0" />
        <SkeletonBar style={{ height: 12, width: 112 }} />
      </div>
      {/* More root items */}
      <div className="flex items-center gap-2 py-1.5 px-2">
        <SkeletonBar style={{ height: 16, width: 16 }} className="shrink-0" />
        <SkeletonBar style={{ height: 16, width: 16 }} className="shrink-0" />
        <SkeletonBar style={{ height: 16, width: 80 }} />
      </div>
    </div>
  )
}

/**
 * Skeleton for RecentPanel content
 */
export function RecentPanelSkeleton({ className }: PanelSkeletonProps) {
  return (
    <div className={cn('flex flex-col gap-2 p-3', className)}>
      {[...Array(4)].map((_, i) => (
        <div key={i} className="flex items-center gap-2 p-2 rounded">
          <SkeletonBar style={{ height: 16, width: 16, borderRadius: '50%' }} className="shrink-0" />
          <div className="flex-1">
            <SkeletonBar style={{ height: 16, width: '75%', marginBottom: 4 }} />
            <SkeletonBar style={{ height: 12, width: '50%' }} />
          </div>
          <SkeletonBar style={{ height: 12, width: 32 }} />
        </div>
      ))}
    </div>
  )
}

/**
 * Skeleton for QuickCapturePanel content
 */
export function QuickCapturePanelSkeleton({ className }: PanelSkeletonProps) {
  return (
    <div className={cn('flex flex-col gap-2 p-3', className)}>
      <SkeletonBar style={{ height: 80, width: '100%', borderRadius: 8 }} />
      <div className="flex items-center justify-between">
        <SkeletonBar style={{ height: 12, width: 96 }} />
        <SkeletonBar style={{ height: 32, width: 80 }} />
      </div>
    </div>
  )
}

/**
 * Generic panel skeleton with customizable line count
 */
export function GenericPanelSkeleton({
  className,
  lines = 4,
}: PanelSkeletonProps & { lines?: number }) {
  return (
    <div className={cn('flex flex-col gap-2 p-4', className)}>
      {[...Array(lines)].map((_, i) => (
        <SkeletonBar
          key={i}
          style={{ height: 16, width: `${Math.random() * 30 + 50}%` }}
        />
      ))}
    </div>
  )
}

/**
 * Dashboard grid skeleton (multiple panels)
 */
export function DashboardGridSkeleton({ className }: PanelSkeletonProps) {
  return (
    <div className={cn('grid grid-cols-2 gap-4', className)}>
      <div
        style={{
          background: '#1e222a',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          borderRadius: 12,
          overflow: 'hidden',
        }}
      >
        <div
          className="p-3"
          style={{
            borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
            background: 'rgba(255, 255, 255, 0.02)',
          }}
        >
          <SkeletonBar style={{ height: 16, width: 80 }} />
        </div>
        <ContinuePanelSkeleton />
      </div>
      <div
        style={{
          background: '#1e222a',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          borderRadius: 12,
          overflow: 'hidden',
        }}
      >
        <div
          className="p-3"
          style={{
            borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
            background: 'rgba(255, 255, 255, 0.02)',
          }}
        >
          <SkeletonBar style={{ height: 16, width: 64 }} />
        </div>
        <RecentPanelSkeleton />
      </div>
      <div
        style={{
          background: '#1e222a',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          borderRadius: 12,
          overflow: 'hidden',
        }}
      >
        <div
          className="p-3"
          style={{
            borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
            background: 'rgba(255, 255, 255, 0.02)',
          }}
        >
          <SkeletonBar style={{ height: 16, width: 96 }} />
        </div>
        <NavigatorPanelSkeleton />
      </div>
      <div
        style={{
          background: '#1e222a',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          borderRadius: 12,
          overflow: 'hidden',
        }}
      >
        <div
          className="p-3"
          style={{
            borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
            background: 'rgba(255, 255, 255, 0.02)',
          }}
        >
          <SkeletonBar style={{ height: 16, width: 112 }} />
        </div>
        <QuickCapturePanelSkeleton />
      </div>
    </div>
  )
}
