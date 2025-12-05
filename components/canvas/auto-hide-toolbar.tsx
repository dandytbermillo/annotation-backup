"use client"

import React, { type ReactNode, useState, useEffect, useRef } from "react"

interface AutoHideToolbarProps {
  children: ReactNode
  /** Y-coordinate threshold (px from top) to trigger toolbar visibility */
  edgeThreshold?: number
  /** Delay (ms) before hiding toolbar after mouse leaves */
  hideDelay?: number
  /** Show toolbar for initial duration on mount (ms) */
  showOnMount?: boolean
  initialVisibilityDuration?: number
  /** Top offset in pixels (for embedding below another header) */
  topOffset?: number
}

/**
 * Auto-hide toolbar that appears when mouse approaches top edge of screen
 * and hides when mouse moves away. Provides Figma/Miro-style edge hover UX.
 */
export function AutoHideToolbar({
  children,
  edgeThreshold = 50,
  hideDelay = 800,
  showOnMount = true,
  initialVisibilityDuration = 3000,
  topOffset = 0,
}: AutoHideToolbarProps) {
  const [isVisible, setIsVisible] = useState(showOnMount)
  const [isHovering, setIsHovering] = useState(false)
  const hideTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const toolbarRef = useRef<HTMLDivElement>(null)


  // Clear any pending hide timeout
  const clearHideTimeout = () => {
    if (hideTimeoutRef.current) {
      clearTimeout(hideTimeoutRef.current)
      hideTimeoutRef.current = null
    }
  }

  // Schedule toolbar to hide after delay
  const scheduleHide = () => {
    clearHideTimeout()
    hideTimeoutRef.current = setTimeout(() => {
      if (!isHovering) {
        setIsVisible(false)
      }
    }, hideDelay)
  }

  // Show toolbar for initial duration on mount
  useEffect(() => {
    if (showOnMount) {
      setIsVisible(true)
      const timeout = setTimeout(() => {
        if (!isHovering) {
          setIsVisible(false)
        }
      }, initialVisibilityDuration)

      return () => clearTimeout(timeout)
    }
  }, [showOnMount, initialVisibilityDuration, isHovering])

  // Edge detection via mousemove listener
  // Account for topOffset when detecting edge proximity
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      const mouseY = e.clientY

      // Show toolbar when mouse is near top edge (adjusted for offset)
      if (mouseY <= topOffset + edgeThreshold && mouseY >= topOffset) {
        clearHideTimeout()
        setIsVisible(true)
      }
      // Start hide timer when mouse moves away from toolbar area
      else if (mouseY > topOffset + edgeThreshold + 100 && !isHovering) {
        scheduleHide()
      }
    }

    window.addEventListener("mousemove", handleMouseMove)

    return () => {
      window.removeEventListener("mousemove", handleMouseMove)
      clearHideTimeout()
    }
  }, [edgeThreshold, hideDelay, isHovering, topOffset])

  // Handle toolbar hover - keep visible while hovering
  const handleMouseEnter = () => {
    setIsHovering(true)
    clearHideTimeout()
    setIsVisible(true)
  }

  const handleMouseLeave = () => {
    setIsHovering(false)
    scheduleHide()
  }

  // Handle focus events for keyboard accessibility
  const handleFocus = () => {
    clearHideTimeout()
    setIsVisible(true)
  }

  const handleBlur = () => {
    if (!isHovering) {
      scheduleHide()
    }
  }

  return (
    <div
      ref={toolbarRef}
      style={{
        transform: isVisible ? 'translateY(0)' : 'translateY(-100%)',
        transition: 'transform 300ms ease-in-out',
        top: topOffset,
      }}
      className="fixed left-0 right-0 z-50 border-b border-neutral-800 bg-neutral-950/80 backdrop-blur overflow-visible"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onFocus={handleFocus}
      onBlur={handleBlur}
      aria-hidden={!isVisible}
    >
      {children}
    </div>
  )
}
