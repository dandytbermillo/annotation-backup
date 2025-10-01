'use client'

/**
 * FloatingOverlayProvider
 *
 * React context provider for FloatingOverlayController.
 *
 * NOTE: Phase 3 provides controller skeleton only. Adapter registration
 * will be implemented in Phase 4 (CanvasOverlayAdapter, IdentityOverlayAdapter).
 *
 * Usage:
 *   <FloatingOverlayProvider>
 *     <YourApp />
 *   </FloatingOverlayProvider>
 *
 * Hooks:
 *   - useOverlayController(): Access the controller instance
 *   - useOverlayTransform(): Subscribe to transform changes
 *   - useOverlayCapabilities(): Get current capabilities
 */

import React, {
  createContext,
  useContext,
  useRef,
  useEffect,
  useState,
  useCallback,
  type ReactNode,
} from 'react'
import { FloatingOverlayController } from '@/lib/overlay/floating-overlay-controller'
import type { Transform, OverlayCapabilities } from '@/lib/overlay/types'

// Context
interface OverlayContextValue {
  controller: FloatingOverlayController
}

const OverlayContext = createContext<OverlayContextValue | null>(null)

// Provider Props
interface FloatingOverlayProviderProps {
  children: ReactNode
}

/**
 * Provider component
 */
export function FloatingOverlayProvider({
  children,
}: FloatingOverlayProviderProps) {
  const controllerRef = useRef<FloatingOverlayController | null>(null)

  // Initialize controller once
  if (!controllerRef.current) {
    controllerRef.current = new FloatingOverlayController()
  }

  const value = {
    controller: controllerRef.current,
  }

  return (
    <OverlayContext.Provider value={value}>{children}</OverlayContext.Provider>
  )
}

/**
 * Hook: Access the overlay controller
 */
export function useOverlayController(): FloatingOverlayController {
  const context = useContext(OverlayContext)
  if (!context) {
    throw new Error(
      'useOverlayController must be used within FloatingOverlayProvider'
    )
  }
  return context.controller
}

/**
 * Hook: Subscribe to transform changes
 */
export function useOverlayTransform(): Transform {
  const controller = useOverlayController()
  const [transform, setTransform] = useState<Transform>(() =>
    controller.getTransform()
  )

  useEffect(() => {
    const cleanup = controller.onTransformChange(setTransform)
    return cleanup
  }, [controller])

  return transform
}

/**
 * Hook: Get current capabilities
 */
export function useOverlayCapabilities(): OverlayCapabilities {
  const controller = useOverlayController()
  const [capabilities, setCapabilities] = useState<OverlayCapabilities>(() =>
    controller.capabilities
  )

  useEffect(() => {
    // Update capabilities when transform changes (indicates adapter change)
    const cleanup = controller.onTransformChange(() => {
      setCapabilities(controller.capabilities)
    })
    return cleanup
  }, [controller])

  return capabilities
}

/**
 * Hook: Register popup with controller
 */
export function usePopupRegistration(
  id: string,
  initialState: {
    folderId: string | null
    parentId: string | null
    canvasPosition: { x: number; y: number }
    overlayPosition: { x: number; y: number }
    level: number
    height?: number
  }
): void {
  const controller = useOverlayController()

  useEffect(() => {
    controller.registerPopup({
      id,
      ...initialState,
    })

    return () => {
      controller.unregisterPopup(id)
    }
  }, [controller, id]) // Deliberately omit initialState to avoid re-registration
}

/**
 * Hook: Update popup position
 */
export function usePopupPosition(id: string) {
  const controller = useOverlayController()

  const updatePosition = useCallback(
    (position: { x: number; y: number }) => {
      controller.updatePopupPosition(id, position)
    },
    [controller, id]
  )

  return updatePosition
}
