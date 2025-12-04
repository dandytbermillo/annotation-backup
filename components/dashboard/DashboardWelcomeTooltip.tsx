"use client"

/**
 * Dashboard Welcome Tooltip
 * Part of Dashboard Implementation - Phase 5.3
 *
 * Shows a welcome tooltip on first visit explaining dashboard customization.
 * Remembers when the user has seen it and doesn't show again.
 */

import React, { useState, useEffect, useCallback } from 'react'
import { X, Move, Plus, RotateCcw, Settings } from 'lucide-react'
import { cn } from '@/lib/utils'

const STORAGE_KEY = 'dashboard_welcome_tooltip_seen'

interface DashboardWelcomeTooltipProps {
  className?: string
  forceShow?: boolean
  onDismiss?: () => void
}

export function DashboardWelcomeTooltip({
  className,
  forceShow = false,
  onDismiss,
}: DashboardWelcomeTooltipProps) {
  const [isVisible, setIsVisible] = useState(false)
  const [isAnimating, setIsAnimating] = useState(false)

  useEffect(() => {
    if (forceShow) {
      setIsVisible(true)
      setIsAnimating(true)
      return
    }

    // Check if user has already seen the tooltip
    if (typeof window !== 'undefined') {
      const hasSeen = localStorage.getItem(STORAGE_KEY)
      if (!hasSeen) {
        // Small delay before showing to let dashboard render first
        const timer = setTimeout(() => {
          setIsVisible(true)
          setIsAnimating(true)
        }, 1500)
        return () => clearTimeout(timer)
      }
    }
  }, [forceShow])

  const handleDismiss = useCallback(() => {
    setIsAnimating(false)

    // Wait for animation to complete
    setTimeout(() => {
      setIsVisible(false)

      if (!forceShow && typeof window !== 'undefined') {
        localStorage.setItem(STORAGE_KEY, 'true')
      }

      onDismiss?.()
    }, 200)
  }, [forceShow, onDismiss])

  if (!isVisible) return null

  return (
    <div
      className={cn(
        'fixed bottom-6 right-6 z-50',
        'transition-all duration-300 ease-out',
        isAnimating
          ? 'opacity-100 translate-y-0'
          : 'opacity-0 translate-y-4',
        className
      )}
    >
      <div
        style={{
          background: '#1e222a',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          borderRadius: 12,
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.5)',
          maxWidth: 360,
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-4 py-3"
          style={{
            background: 'rgba(99, 102, 241, 0.1)',
            borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
          }}
        >
          <div className="flex items-center gap-2">
            <Settings className="w-4 h-4" style={{ color: '#6366f1' }} />
            <span className="text-sm font-medium" style={{ color: '#f0f0f0' }}>
              Welcome to your Dashboard
            </span>
          </div>
          <button
            onClick={handleDismiss}
            className="p-1 rounded"
            aria-label="Dismiss"
            style={{
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              color: '#5c6070',
            }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-4">
          <p className="text-sm" style={{ color: '#8b8fa3' }}>
            Your dashboard is fully customizable! Here's what you can do:
          </p>

          <div className="space-y-3">
            <div className="flex items-start gap-3">
              <div
                className="p-1.5 rounded"
                style={{ background: 'rgba(99, 102, 241, 0.15)', color: '#6366f1' }}
              >
                <Move size={14} />
              </div>
              <div>
                <p className="text-sm font-medium" style={{ color: '#f0f0f0' }}>
                  Drag & Resize
                </p>
                <p className="text-xs" style={{ color: '#8b8fa3' }}>
                  Move panels anywhere and resize them to fit your workflow
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <div
                className="p-1.5 rounded"
                style={{ background: 'rgba(99, 102, 241, 0.15)', color: '#6366f1' }}
              >
                <Plus size={14} />
              </div>
              <div>
                <p className="text-sm font-medium" style={{ color: '#f0f0f0' }}>
                  Add Panels
                </p>
                <p className="text-xs" style={{ color: '#8b8fa3' }}>
                  Use the "Add Panel" button to add more tools to your dashboard
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <div
                className="p-1.5 rounded"
                style={{ background: 'rgba(99, 102, 241, 0.15)', color: '#6366f1' }}
              >
                <RotateCcw size={14} />
              </div>
              <div>
                <p className="text-sm font-medium" style={{ color: '#f0f0f0' }}>
                  Reset Layout
                </p>
                <p className="text-xs" style={{ color: '#8b8fa3' }}>
                  Click "Reset Layout" to restore the default panel arrangement
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div
          className="px-4 py-3"
          style={{
            background: 'rgba(255, 255, 255, 0.02)',
            borderTop: '1px solid rgba(255, 255, 255, 0.08)',
          }}
        >
          <button
            onClick={handleDismiss}
            className="w-full"
            style={{
              padding: '8px 16px',
              borderRadius: 8,
              background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
              color: '#fff',
              border: 'none',
              fontSize: 14,
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            Got it!
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * Hook to manage welcome tooltip visibility
 */
export function useDashboardWelcome() {
  const [hasSeenWelcome, setHasSeenWelcome] = useState(true)

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const hasSeen = localStorage.getItem(STORAGE_KEY)
      setHasSeenWelcome(!!hasSeen)
    }
  }, [])

  const markAsSeen = useCallback(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, 'true')
      setHasSeenWelcome(true)
    }
  }, [])

  const resetWelcome = useCallback(() => {
    if (typeof window !== 'undefined') {
      localStorage.removeItem(STORAGE_KEY)
      setHasSeenWelcome(false)
    }
  }, [])

  return {
    hasSeenWelcome,
    markAsSeen,
    resetWelcome,
  }
}

/**
 * Clear welcome tooltip storage (for testing)
 */
export function clearWelcomeStorage() {
  if (typeof window !== 'undefined') {
    localStorage.removeItem(STORAGE_KEY)
  }
}
