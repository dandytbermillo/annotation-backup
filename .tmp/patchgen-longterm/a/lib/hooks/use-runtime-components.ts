"use client"

import { useEffect, useState, useCallback, useRef } from "react"
import {
  listRuntimeComponents,
  getRuntimeComponentCount,
  type RuntimeComponent,
} from "@/lib/workspace/runtime-manager"

/**
 * Phase 3 Unification: Hook to read components from the runtime ledger.
 *
 * This hook provides a reactive way to access the runtime component ledger,
 * which is the authoritative source for component state during the session.
 *
 * The runtime ledger:
 * - Persists across React unmounts (unlike LayerManager)
 * - Is populated during hydration/replay (Phase 2)
 * - Is updated by useComponentRegistration when components render (Phase 1)
 *
 * @param workspaceId - The workspace to read components from
 * @returns Array of runtime components for the workspace
 */
export function useRuntimeComponents(workspaceId: string | null | undefined): RuntimeComponent[] {
  const [components, setComponents] = useState<RuntimeComponent[]>([])
  const workspaceIdRef = useRef(workspaceId)

  // Sync components from runtime ledger
  const syncComponents = useCallback(() => {
    if (!workspaceId) {
      setComponents([])
      return
    }
    const runtimeComponents = listRuntimeComponents(workspaceId)
    setComponents(runtimeComponents)
  }, [workspaceId])

  // Initial sync and workspace change
  useEffect(() => {
    workspaceIdRef.current = workspaceId
    syncComponents()
  }, [workspaceId, syncComponents])

  // Set up polling to detect runtime ledger changes
  // This is a simple approach; could be replaced with an event system later
  useEffect(() => {
    if (!workspaceId) return

    const interval = setInterval(() => {
      // Only sync if the count changed (optimization)
      const currentCount = getRuntimeComponentCount(workspaceId)
      if (currentCount !== components.length) {
        syncComponents()
      }
    }, 100) // Check every 100ms

    return () => clearInterval(interval)
  }, [workspaceId, components.length, syncComponents])

  return components
}

/**
 * Convert runtime components to canvas items format.
 *
 * @param components - Array of runtime components from the ledger
 * @returns Array of canvas items in the format expected by canvasItems state
 */
export function runtimeComponentsToCanvasItems(components: RuntimeComponent[]): Array<{
  id: string
  itemType: "component"
  componentType: string
  position: { x: number; y: number }
  zIndex?: number
  dimensions?: { width: number; height: number } | null
  metadata?: Record<string, unknown>
  componentState?: Record<string, unknown>
}> {
  return components.map((component) => ({
    id: component.componentId,
    itemType: "component" as const,
    componentType: component.componentType,
    position: component.position,
    zIndex: component.zIndex,
    dimensions: component.size,
    metadata: component.metadata,
    // Map metadata to componentState for ComponentPanel's initialState prop
    componentState: component.metadata,
  }))
}

/**
 * Hook that provides runtime components as canvas items.
 *
 * This is a convenience wrapper that combines useRuntimeComponents with
 * the conversion to canvas item format.
 *
 * @param workspaceId - The workspace to read components from
 * @returns Array of canvas items representing the runtime components
 */
export function useRuntimeComponentsAsCanvasItems(workspaceId: string | null | undefined) {
  const components = useRuntimeComponents(workspaceId)
  return runtimeComponentsToCanvasItems(components)
}
