"use client"

import { useState, useCallback, useRef, useEffect } from 'react'

interface AutoScrollState {
  isActive: boolean
  velocity: { x: number; y: number }
  threshold: number
  speed: number
}

interface UseAutoScrollProps {
  enabled?: boolean
  threshold?: number
  speed?: number
  onScroll?: (deltaX: number, deltaY: number) => void
}

export const useAutoScroll = ({
  enabled = true,
  threshold = 80,
  speed = 5,
  onScroll
}: UseAutoScrollProps = {}) => {
  const [autoScroll, setAutoScroll] = useState<AutoScrollState>({
    isActive: false,
    velocity: { x: 0, y: 0 },
    threshold,
    speed
  })

  const autoScrollRef = useRef(autoScroll)
  const animationFrameRef = useRef<number | null>(null)
  
  // Keep ref in sync
  autoScrollRef.current = autoScroll

  const checkAutoScroll = useCallback((clientX: number, clientY: number) => {
    if (!enabled) return

    let velocityX = 0
    let velocityY = 0

    // Check horizontal edges
    if (clientX < threshold) {
      // Near left edge - scroll right (positive velocity)
      velocityX = speed * (1 - clientX / threshold) // Speed increases as we get closer to edge
    } else if (clientX > window.innerWidth - threshold) {
      // Near right edge - scroll left (negative velocity)
      const distFromEdge = window.innerWidth - clientX
      velocityX = -speed * (1 - distFromEdge / threshold)
    }

    // Check vertical edges
    if (clientY < threshold) {
      // Near top edge - scroll down (positive velocity)
      velocityY = speed * (1 - clientY / threshold)
    } else if (clientY > window.innerHeight - threshold) {
      // Near bottom edge - scroll up (negative velocity)
      const distFromEdge = window.innerHeight - clientY
      velocityY = -speed * (1 - distFromEdge / threshold)
    }

    const shouldScroll = velocityX !== 0 || velocityY !== 0
    
    setAutoScroll(prev => ({
      ...prev,
      isActive: shouldScroll,
      velocity: { x: velocityX, y: velocityY }
    }))
  }, [enabled, threshold, speed])

  const stopAutoScroll = useCallback(() => {
    setAutoScroll(prev => ({
      ...prev,
      isActive: false,
      velocity: { x: 0, y: 0 }
    }))
  }, [])

  // Auto-scroll animation loop
  useEffect(() => {
    if (!autoScroll.isActive || !onScroll) {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
        animationFrameRef.current = null
      }
      return
    }

    const animate = () => {
      if (autoScrollRef.current.isActive) {
        // Apply scroll velocity
        onScroll(autoScrollRef.current.velocity.x, autoScrollRef.current.velocity.y)
        
        // Continue animation
        animationFrameRef.current = requestAnimationFrame(animate)
      }
    }

    animationFrameRef.current = requestAnimationFrame(animate)

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
        animationFrameRef.current = null
      }
    }
  }, [autoScroll.isActive, onScroll])

  return {
    autoScroll,
    checkAutoScroll,
    stopAutoScroll
  }
}