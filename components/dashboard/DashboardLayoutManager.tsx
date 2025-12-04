"use client"

/**
 * Dashboard Layout Manager Component
 * Part of Dashboard Implementation - Phase 4.2 & 4.3
 *
 * Provides layout management controls including:
 * - Reset Layout button
 * - Seed Defaults CTA for empty dashboards
 * - Retry functionality for failed operations
 */

import React, { useState, useCallback } from 'react'
import { RotateCcw, Loader2, AlertTriangle, Layout, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { withRetry } from '@/lib/dashboard/retry-utils'

interface DashboardLayoutManagerProps {
  workspaceId: string | null
  panelCount: number
  isLoading: boolean
  error: string | null
  onLayoutReset?: () => void
  className?: string
}

export function DashboardLayoutManager({
  workspaceId,
  panelCount,
  isLoading,
  error,
  onLayoutReset,
  className,
}: DashboardLayoutManagerProps) {
  const [isResetting, setIsResetting] = useState(false)
  const [resetError, setResetError] = useState<string | null>(null)
  const [resetSuccess, setResetSuccess] = useState(false)

  const handleResetLayout = useCallback(async () => {
    if (!workspaceId || isResetting) return

    setIsResetting(true)
    setResetError(null)
    setResetSuccess(false)

    try {
      await withRetry(
        async () => {
          const response = await fetch('/api/dashboard/panels/reset-layout', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ workspaceId }),
          })

          if (!response.ok) {
            const data = await response.json().catch(() => ({}))
            throw new Error(data.error || 'Failed to reset layout')
          }

          return response.json()
        },
        {
          maxRetries: 3,
          initialDelay: 500,
          onRetry: (attempt, error, delay) => {
            console.log(`[DashboardLayoutManager] Retry attempt ${attempt}, waiting ${delay}ms`)
          },
        }
      )

      setResetSuccess(true)
      onLayoutReset?.()

      // Clear success message after delay
      setTimeout(() => setResetSuccess(false), 3000)
    } catch (err) {
      console.error('[DashboardLayoutManager] Failed to reset layout:', err)
      setResetError(err instanceof Error ? err.message : 'Failed to reset layout')
    } finally {
      setIsResetting(false)
    }
  }, [workspaceId, isResetting, onLayoutReset])

  const handleSeedDefaults = useCallback(async () => {
    // Use the same logic as reset - it will create default panels
    await handleResetLayout()
  }, [handleResetLayout])

  // Show seed defaults CTA if no panels and not loading
  if (!isLoading && panelCount === 0 && workspaceId) {
    return (
      <div className={cn(
        'flex flex-col items-center justify-center p-8 bg-muted/30 rounded-lg border border-dashed border-border',
        className
      )}>
        <Layout size={40} className="text-muted-foreground mb-4" />
        <h3 className="text-lg font-medium text-foreground mb-2">
          No panels configured
        </h3>
        <p className="text-sm text-muted-foreground text-center mb-4 max-w-md">
          Your dashboard is empty. Add default panels to get started with Continue, Navigator, Recent, and Quick Capture.
        </p>

        {resetError && (
          <div className="flex items-center gap-2 text-destructive text-sm mb-3">
            <AlertTriangle size={14} />
            <span>{resetError}</span>
          </div>
        )}

        <Button
          onClick={handleSeedDefaults}
          disabled={isResetting}
          className="gap-2"
        >
          {isResetting ? (
            <>
              <Loader2 size={16} className="animate-spin" />
              Setting up...
            </>
          ) : (
            <>
              <Plus size={16} />
              Seed Default Panels
            </>
          )}
        </Button>
      </div>
    )
  }

  // Show error state with retry
  if (error && !isLoading) {
    return (
      <div className={cn(
        'flex flex-col items-center justify-center p-6 bg-destructive/5 rounded-lg border border-destructive/20',
        className
      )}>
        <AlertTriangle size={32} className="text-destructive mb-3" />
        <h3 className="text-sm font-medium text-destructive mb-1">
          Failed to load dashboard
        </h3>
        <p className="text-xs text-muted-foreground text-center mb-3">
          {error}
        </p>
        <Button
          onClick={onLayoutReset}
          variant="outline"
          size="sm"
          className="gap-1"
        >
          <RotateCcw size={14} />
          Retry
        </Button>
      </div>
    )
  }

  // Normal state - show reset layout option (as a small button)
  return (
    <div className={cn('flex items-center gap-2', className)}>
      {resetSuccess && (
        <span className="text-xs text-green-600">
          Layout reset!
        </span>
      )}
      {resetError && (
        <span className="text-xs text-destructive">
          {resetError}
        </span>
      )}
      <Button
        onClick={handleResetLayout}
        disabled={isResetting || !workspaceId}
        variant="ghost"
        size="sm"
        className="gap-1 text-muted-foreground hover:text-foreground"
        title="Reset dashboard layout to defaults"
      >
        {isResetting ? (
          <Loader2 size={14} className="animate-spin" />
        ) : (
          <RotateCcw size={14} />
        )}
        <span className="hidden sm:inline">Reset Layout</span>
      </Button>
    </div>
  )
}

/**
 * Hook to manage dashboard initialization with retry
 */
export function useDashboardInit(userId: string | null) {
  const [isInitializing, setIsInitializing] = useState(false)
  const [initError, setInitError] = useState<string | null>(null)
  const [retryCount, setRetryCount] = useState(0)

  const initializeDashboard = useCallback(async () => {
    if (!userId) return null

    setIsInitializing(true)
    setInitError(null)

    try {
      const result = await withRetry(
        async () => {
          const response = await fetch('/api/dashboard/info')
          if (!response.ok) {
            const data = await response.json().catch(() => ({}))
            throw new Error(data.error || 'Failed to initialize dashboard')
          }
          return response.json()
        },
        {
          maxRetries: 5,
          initialDelay: 1000,
          maxDelay: 15000,
          backoffFactor: 2,
          onRetry: (attempt) => {
            setRetryCount(attempt)
          },
        }
      )

      setRetryCount(0)
      return result
    } catch (err) {
      console.error('[useDashboardInit] Failed to initialize:', err)
      setInitError(err instanceof Error ? err.message : 'Initialization failed')
      return null
    } finally {
      setIsInitializing(false)
    }
  }, [userId])

  return {
    initializeDashboard,
    isInitializing,
    initError,
    retryCount,
    canRetry: retryCount < 5,
  }
}
