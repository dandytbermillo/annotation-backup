"use client"

import { useState, useCallback, useRef, useEffect } from 'react'
import { debugLog } from '@/lib/utils/debug-logger'

interface AutoScrollState {
  isActive: boolean
  direction: { x: number; y: number } // Normalized direction: -1 to 1 (edge proximity)
  threshold: number
  speedPxPerSec: number // Auto-scroll speed in screen pixels per second
  pendingEdges: string[] // Which edges are in activation delay (e.g., ['TOP', 'LEFT'])
}

interface UseAutoScrollProps {
  enabled?: boolean
  threshold?: number
  /**
   * Auto-scroll speed in screen pixels per second.
   *
   * World-space speed = speedPxPerSec / currentZoom
   *
   * Examples at speedPxPerSec = 500:
   * - zoom 1.0: 500 screen px/s = 500 world px/s
   * - zoom 0.5: 500 screen px/s = 1000 world px/s (zoomed out, moves faster in world)
   * - zoom 2.0: 500 screen px/s = 250 world px/s (zoomed in, moves slower in world)
   *
   * Benchmark: Figma/Miro typically use 400-800 px/s
   */
  speedPxPerSec?: number
  activationDelay?: number
  onScroll?: (deltaX: number, deltaY: number) => void
  onActivationPending?: (isPending: boolean) => void // Callback for visual affordance
}

export const useAutoScroll = ({
  enabled = true,
  threshold = 50, // Reduced from 80px to 50px
  speedPxPerSec = 500, // Default: 500 screen px/s (industry standard)
  activationDelay = 800, // Increased to 800ms - users need time to position panels
  onScroll,
  onActivationPending
}: UseAutoScrollProps = {}) => {
  const [autoScroll, setAutoScroll] = useState<AutoScrollState>({
    isActive: false,
    direction: { x: 0, y: 0 },
    threshold,
    speedPxPerSec,
    pendingEdges: []
  })

  const autoScrollRef = useRef(autoScroll)
  const animationFrameRef = useRef<number | null>(null)
  const activationTimerRef = useRef<NodeJS.Timeout | null>(null)
  const pendingDirectionRef = useRef<{ x: number; y: number } | null>(null)

  // Keep ref in sync
  autoScrollRef.current = autoScroll

  const checkAutoScroll = useCallback((clientX: number, clientY: number) => {
    if (!enabled) {
      debugLog('useAutoScroll', 'auto_scroll_disabled', {
        pointer: { x: clientX, y: clientY }
      })
      return
    }

    let directionX = 0
    let directionY = 0

    // Calculate distances to all edges
    const distanceFromLeft = clientX
    const distanceFromRight = window.innerWidth - clientX
    const distanceFromTop = clientY
    const distanceFromBottom = window.innerHeight - clientY

    // Check horizontal edges - calculate normalized direction (0 to 1)
    if (clientX < threshold) {
      // Near left edge - scroll right (positive direction)
      // Apply 1.3x multiplier to compensate for perceptual asymmetry
      const baseDirection = 1 - (clientX / threshold)
      directionX = baseDirection * 1.3 // 30% faster to feel more responsive
    } else if (clientX > window.innerWidth - threshold) {
      // Near right edge - scroll left (negative direction)
      // Apply 1.3x multiplier to compensate for perceptual asymmetry
      const distFromEdge = window.innerWidth - clientX
      const baseDirection = -(1 - (distFromEdge / threshold))
      directionX = baseDirection * 1.3 // 30% faster to feel more responsive
    }

    // Check vertical edges - calculate normalized direction (0 to 1)
    if (clientY < threshold) {
      // Near top edge - scroll down (positive direction)
      directionY = 1 - (clientY / threshold) // Direction increases as we get closer to edge (0 to 1)
    } else if (clientY > window.innerHeight - threshold) {
      // Near bottom edge - scroll up (negative direction)
      // Apply 1.3x multiplier to compensate for perceptual asymmetry:
      // When user drags UP toward bottom edge, their hand motion masks the scroll speed,
      // making it feel slower than top edge. This boost makes it feel balanced.
      const distFromEdge = window.innerHeight - clientY
      const baseDirection = -(1 - (distFromEdge / threshold))
      directionY = baseDirection * 1.3 // 30% faster to feel symmetric
    }

    const nearEdge = directionX !== 0 || directionY !== 0

    // NEW: Activation delay logic
    if (nearEdge) {
      // Determine which edges are active
      const edges: string[] = []
      if (clientX < threshold) edges.push('LEFT')
      if (clientX > window.innerWidth - threshold) edges.push('RIGHT')
      if (clientY < threshold) edges.push('TOP')
      if (clientY > window.innerHeight - threshold) edges.push('BOTTOM')

      // Only update pendingEdges if they actually changed (avoid unnecessary re-renders that restart animations)
      const currentEdges = autoScrollRef.current.pendingEdges
      const edgesChanged =
        edges.length !== currentEdges.length ||
        edges.some(edge => !currentEdges.includes(edge)) ||
        currentEdges.some(edge => !edges.includes(edge))

      if (edgesChanged) {
        setAutoScroll(prev => ({
          ...prev,
          pendingEdges: edges
        }))

        debugLog('useAutoScroll', 'pending_edges_UPDATED', {
          oldEdges: currentEdges,
          newEdges: edges,
          reason: 'edges_changed'
        })
      }

      // Start delay timer if not already started and not yet scrolling
      if (!activationTimerRef.current && !autoScrollRef.current.isActive) {
        // Store the pending direction
        pendingDirectionRef.current = { x: directionX, y: directionY }

        // Notify visual affordance callback
        if (onActivationPending) {
          onActivationPending(true)
        }

        debugLog('useAutoScroll', 'auto_scroll_DELAY_STARTED', {
          pointer: { x: clientX, y: clientY },
          direction: { x: directionX, y: directionY },
          edges: edges.join('+'),
          edgeDistances: {
            left: distanceFromLeft,
            right: distanceFromRight,
            top: distanceFromTop,
            bottom: distanceFromBottom
          },
          threshold,
          activationDelay,
          reason: 'cursor_entered_edge_zone'
        })

        // Start activation timer
        activationTimerRef.current = setTimeout(() => {
          // Delay passed - activate auto-scroll (keep pendingEdges visible)
          const pendingDir = pendingDirectionRef.current || { x: 0, y: 0 }

          setAutoScroll(prev => ({
            ...prev,
            isActive: true,
            direction: pendingDir
            // DON'T clear pendingEdges - keep them visible while in zone
          }))

          // Clear visual affordance callback (but keep glow)
          if (onActivationPending) {
            onActivationPending(false)
          }

          debugLog('useAutoScroll', 'auto_scroll_ACTIVATED', {
            pointer: { x: clientX, y: clientY },
            direction: pendingDir,
            threshold,
            speedPxPerSec,
            viewport: { width: window.innerWidth, height: window.innerHeight },
            stateTransition: 'START_AFTER_DELAY'
          })

          activationTimerRef.current = null
        }, activationDelay)
      } else if (autoScrollRef.current.isActive) {
        // Already scrolling - update direction (pendingEdges already set above)
        setAutoScroll(prev => ({
          ...prev,
          direction: { x: directionX, y: directionY }
        }))
      }
    } else {
      // Cursor NOT near edge

      // Cancel pending activation if exists
      if (activationTimerRef.current) {
        clearTimeout(activationTimerRef.current)
        activationTimerRef.current = null
        pendingDirectionRef.current = null

        // Clear pending edges
        setAutoScroll(prev => ({
          ...prev,
          pendingEdges: []
        }))

        debugLog('useAutoScroll', 'pending_edges_CLEARED_cancelled', {
          reason: 'cursor_moved_away',
          clearedEdges: autoScrollRef.current.pendingEdges
        })

        // Clear visual affordance
        if (onActivationPending) {
          onActivationPending(false)
        }

        debugLog('useAutoScroll', 'auto_scroll_DELAY_CANCELLED', {
          pointer: { x: clientX, y: clientY },
          edgeDistances: {
            left: distanceFromLeft,
            right: distanceFromRight,
            top: distanceFromTop,
            bottom: distanceFromBottom
          },
          threshold,
          reason: 'cursor_moved_away_before_delay_completed'
        })
      }

      // Stop scrolling if active
      if (autoScrollRef.current.isActive) {
        setAutoScroll(prev => ({
          ...prev,
          isActive: false,
          direction: { x: 0, y: 0 },
          pendingEdges: [] // Clear pending edges
        }))

        debugLog('useAutoScroll', 'auto_scroll_DEACTIVATED', {
          pointer: { x: clientX, y: clientY },
          edgeDistances: {
            left: distanceFromLeft,
            right: distanceFromRight,
            top: distanceFromTop,
            bottom: distanceFromBottom
          },
          threshold,
          reason: 'cursor_moved_away_from_edges'
        })
      }
    }
  }, [enabled, threshold, speedPxPerSec, activationDelay, onActivationPending])

  const stopAutoScroll = useCallback(() => {
    // Clear activation timer if pending
    if (activationTimerRef.current) {
      clearTimeout(activationTimerRef.current)
      activationTimerRef.current = null
      pendingDirectionRef.current = null

      // Clear visual affordance
      if (onActivationPending) {
        onActivationPending(false)
      }
    }

    setAutoScroll(prev => {
      if (!prev.isActive && prev.direction.x === 0 && prev.direction.y === 0 && prev.pendingEdges.length === 0) {
        return prev
      }

      return {
        ...prev,
        isActive: false,
        direction: { x: 0, y: 0 },
        pendingEdges: [] // Clear pending edges
      }
    })

    debugLog('useAutoScroll', 'stop_auto_scroll_manual', {})
  }, [onActivationPending])

  // Auto-scroll animation loop with time-based calculation
  useEffect(() => {
    if (!autoScroll.isActive || !onScroll) {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
        animationFrameRef.current = null
      }
      return
    }

    let lastTimestamp: number | null = null
    const activationTime = performance.now() // Track when scrolling started for ease-in
    const easeInDuration = 200 // 200ms ease-in period (cubic ease-out)

    const animate = (timestamp: number) => {
      if (!autoScrollRef.current.isActive) {
        return
      }

      // Calculate deltaTime in seconds
      if (lastTimestamp === null) {
        lastTimestamp = timestamp
        animationFrameRef.current = requestAnimationFrame(animate)
        return
      }

      const deltaTimeMs = timestamp - lastTimestamp
      const deltaTimeSec = deltaTimeMs / 1000 // Convert to seconds
      lastTimestamp = timestamp

      // Calculate ease-in factor (0 to 1) using cubic ease-out
      const elapsedSinceActivation = timestamp - activationTime
      let easeInFactor = 1.0
      if (elapsedSinceActivation < easeInDuration) {
        // Cubic ease-out: 1 - (1-t)^3
        const t = elapsedSinceActivation / easeInDuration // 0 to 1
        easeInFactor = 1 - Math.pow(1 - t, 3) // Smooth acceleration
      }

      // Time-based physics calculation:
      // pixels = speedPxPerSec × direction × deltaTime × easeInFactor
      const { direction, speedPxPerSec } = autoScrollRef.current
      const deltaX = speedPxPerSec * direction.x * deltaTimeSec * easeInFactor
      const deltaY = speedPxPerSec * direction.y * deltaTimeSec * easeInFactor

      // Apply scroll
      onScroll(deltaX, deltaY)

      // Continue animation
      animationFrameRef.current = requestAnimationFrame(animate)
    }

    animationFrameRef.current = requestAnimationFrame(animate)

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
        animationFrameRef.current = null
      }
    }
  }, [autoScroll.isActive, onScroll])

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (activationTimerRef.current) {
        clearTimeout(activationTimerRef.current)
        activationTimerRef.current = null
      }
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
        animationFrameRef.current = null
      }
    }
  }, [])

  return {
    autoScroll,
    checkAutoScroll,
    stopAutoScroll
  }
}
