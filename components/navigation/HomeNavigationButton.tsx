"use client"

/**
 * Home Navigation Button
 *
 * Displays a home icon in the upper left corner.
 * - Click: Go to current entry's Dashboard
 * - Shows navigation popup on hover/click with full path
 */

import React, { useState, useEffect, useRef, useCallback } from "react"
import { Home, ChevronRight, LayoutDashboard, FolderOpen, MapPin, X } from "lucide-react"
import {
  getNavigationStack,
  getCurrentNavigationEntry,
  subscribeToNavigation,
  navigateToStackEntry,
  getCurrentViewMode,
  type NavigationEntry,
} from "@/lib/navigation/navigation-context"

interface HomeNavigationButtonProps {
  /** Callback when user wants to navigate to a dashboard */
  onNavigate?: (entryId: string, workspaceId: string) => void
  /** Whether currently on a dashboard (vs workspace) */
  isOnDashboard?: boolean
  /** Callback when user wants to return to dashboard from embedded workspace mode */
  onReturnToDashboard?: () => void
  /** Whether this button is in embedded mode (inside DashboardView's workspace) */
  isEmbeddedMode?: boolean
}

export function HomeNavigationButton({
  onNavigate,
  isOnDashboard = false,
  onReturnToDashboard,
  isEmbeddedMode = false,
}: HomeNavigationButtonProps) {
  const [stack, setStack] = useState<NavigationEntry[]>([])
  const [isPopupOpen, setIsPopupOpen] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const popupRef = useRef<HTMLDivElement>(null)

  // Track current view mode for display
  const [viewMode, setViewMode] = useState<'dashboard' | 'workspace'>('dashboard')

  // Subscribe to navigation changes
  useEffect(() => {
    setStack(getNavigationStack())
    const unsubscribe = subscribeToNavigation((newStack) => {
      setStack(newStack)
      // Update viewMode from navigation context
      const currentViewMode = getCurrentViewMode()
      if (currentViewMode) {
        setViewMode(currentViewMode.viewMode)
      }
    })
    // Initialize viewMode
    const currentViewMode = getCurrentViewMode()
    if (currentViewMode) {
      setViewMode(currentViewMode.viewMode)
    }
    return unsubscribe
  }, [])

  // Close popup when clicking outside
  useEffect(() => {
    if (!isPopupOpen) return

    const handleClickOutside = (e: MouseEvent) => {
      if (
        popupRef.current &&
        !popupRef.current.contains(e.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(e.target as Node)
      ) {
        setIsPopupOpen(false)
      }
    }

    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [isPopupOpen])

  const currentEntry = getCurrentNavigationEntry()

  // Handle click on home button - go to current entry's dashboard
  // Phase 4: In embedded mode, return to dashboard view first
  const handleHomeClick = useCallback(() => {
    // In embedded workspace mode, return to dashboard first
    if (isEmbeddedMode && viewMode === 'workspace' && onReturnToDashboard) {
      onReturnToDashboard()
      return
    }

    if (currentEntry && onNavigate) {
      // If already on dashboard, toggle popup instead
      if (isOnDashboard) {
        setIsPopupOpen(prev => !prev)
      } else {
        // Go to current entry's dashboard
        onNavigate(currentEntry.entryId, currentEntry.dashboardWorkspaceId)
      }
    } else {
      setIsPopupOpen(prev => !prev)
    }
  }, [currentEntry, onNavigate, isOnDashboard, isEmbeddedMode, viewMode, onReturnToDashboard])

  // Handle navigation to a stack entry
  const handleStackEntryClick = useCallback((index: number) => {
    const entry = navigateToStackEntry(index)
    if (entry && onNavigate) {
      onNavigate(entry.entryId, entry.dashboardWorkspaceId)
    }
    setIsPopupOpen(false)
  }, [onNavigate])

  // Don't render if no navigation stack
  if (stack.length === 0) {
    return null
  }

  return (
    <div className="relative">
      {/* Home Button */}
      <button
        ref={buttonRef}
        onClick={handleHomeClick}
        onContextMenu={(e) => {
          e.preventDefault()
          setIsPopupOpen(prev => !prev)
        }}
        style={{
          width: 36,
          height: 36,
          borderRadius: 8,
          background: isPopupOpen ? 'rgba(99, 102, 241, 0.15)' : 'rgba(255, 255, 255, 0.05)',
          border: isPopupOpen ? '1px solid rgba(99, 102, 241, 0.3)' : '1px solid rgba(255, 255, 255, 0.1)',
          color: isPopupOpen ? '#818cf8' : '#f0f0f0',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transition: 'all 0.15s ease',
        }}
        onMouseEnter={(e) => {
          if (!isPopupOpen) {
            e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)'
          }
        }}
        onMouseLeave={(e) => {
          if (!isPopupOpen) {
            e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)'
          }
        }}
        title={isOnDashboard ? "Navigation" : "Back to Dashboard"}
      >
        <Home size={18} />
      </button>

      {/* Navigation Popup */}
      {isPopupOpen && (
        <div
          ref={popupRef}
          style={{
            position: 'absolute',
            top: 'calc(100% + 8px)',
            left: 0,
            minWidth: 280,
            maxWidth: 360,
            background: '#1a1d24',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            borderRadius: 12,
            boxShadow: '0 12px 40px rgba(0, 0, 0, 0.5)',
            zIndex: 1000,
            overflow: 'hidden',
          }}
        >
          {/* Header */}
          <div
            style={{
              padding: '12px 16px',
              borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <span style={{ fontSize: 12, fontWeight: 600, color: '#8b8fa3', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Navigation
            </span>
            <button
              onClick={() => setIsPopupOpen(false)}
              style={{
                background: 'transparent',
                border: 'none',
                color: '#8b8fa3',
                cursor: 'pointer',
                padding: 4,
                borderRadius: 4,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <X size={14} />
            </button>
          </div>

          {/* Navigation Stack */}
          <div style={{ padding: '8px 0' }}>
            {stack.map((entry, index) => {
              const isLast = index === stack.length - 1
              const isHome = index === 0

              return (
                <button
                  key={entry.entryId}
                  onClick={() => handleStackEntryClick(index)}
                  style={{
                    width: '100%',
                    padding: '10px 16px',
                    background: isLast ? 'rgba(99, 102, 241, 0.1)' : 'transparent',
                    border: 'none',
                    borderLeft: isLast ? '3px solid #6366f1' : '3px solid transparent',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    transition: 'background 0.1s ease',
                    textAlign: 'left',
                  }}
                  onMouseEnter={(e) => {
                    if (!isLast) {
                      e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)'
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!isLast) {
                      e.currentTarget.style.background = 'transparent'
                    }
                  }}
                >
                  {/* Icon */}
                  <div
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: 6,
                      background: isHome
                        ? 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)'
                        : 'rgba(255, 255, 255, 0.08)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}
                  >
                    {isHome ? (
                      <Home size={14} color="#fff" />
                    ) : isLast ? (
                      <MapPin size={14} color="#818cf8" />
                    ) : (
                      <FolderOpen size={14} color="#8b8fa3" />
                    )}
                  </div>

                  {/* Entry Info */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 13,
                        fontWeight: isLast ? 600 : 500,
                        color: isLast ? '#f0f0f0' : '#c0c4d0',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {entry.entryName}
                    </div>
                    {isLast && (
                      <div
                        style={{
                          fontSize: 11,
                          color: '#8b8fa3',
                          marginTop: 2,
                          display: 'flex',
                          alignItems: 'center',
                          gap: 4,
                        }}
                      >
                        <LayoutDashboard size={10} />
                        <span>
                          {/* Show viewMode-aware label for current entry */}
                          {viewMode === 'workspace' && entry.activeWorkspaceId
                            ? `Workspace`
                            : entry.workspaceName || 'Dashboard'}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Current Indicator or Arrow */}
                  {isLast ? (
                    <span
                      style={{
                        fontSize: 10,
                        color: '#6366f1',
                        background: 'rgba(99, 102, 241, 0.15)',
                        padding: '2px 8px',
                        borderRadius: 10,
                        fontWeight: 500,
                      }}
                    >
                      current
                    </span>
                  ) : (
                    <ChevronRight size={14} color="#5c6070" />
                  )}
                </button>
              )
            })}
          </div>

          {/* Footer hint */}
          <div
            style={{
              padding: '10px 16px',
              borderTop: '1px solid rgba(255, 255, 255, 0.08)',
              fontSize: 11,
              color: '#5c6070',
            }}
          >
            Click any entry to navigate
          </div>
        </div>
      )}
    </div>
  )
}
