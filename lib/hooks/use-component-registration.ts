"use client"

import { useEffect, useRef } from "react"
import {
  registerComponent,
  deregisterComponent,
  isComponentRegistered,
  registerRuntimeComponent,
  updateRuntimeComponent,
  touchRuntimeComponent,
  type RuntimeComponentInput,
} from "@/lib/workspace/runtime-manager"

type UseComponentRegistrationOptions = {
  workspaceId: string | null | undefined
  componentId: string
  componentType: "calculator" | "timer" | "alarm" | "widget" | string
  /**
   * If true (default in dev mode), throws an error when workspaceId is missing.
   * Set to false for legacy components that don't yet have workspaceId wired up.
   */
  strict?: boolean
  /**
   * Phase 1 Unification: Component position for runtime ledger
   */
  position?: { x: number; y: number }
  /**
   * Phase 1 Unification: Component size for runtime ledger
   */
  size?: { width: number; height: number } | null
  /**
   * Phase 1 Unification: Component metadata for runtime ledger
   */
  metadata?: Record<string, unknown>
  /**
   * Phase 1 Unification: Component z-index for runtime ledger
   */
  zIndex?: number
}

/**
 * Hook for registering a component (calculator, timer, alarm, etc.) with a workspace runtime.
 *
 * Components must use this hook to participate in the workspace lifecycle.
 * The hook automatically:
 * - Registers to the runtime ledger (authoritative data, persists across unmounts)
 * - Registers to React lifecycle tracking (for hot runtime detection)
 * - Updates the runtime ledger when position/metadata changes
 * - Deregisters from React lifecycle on unmount (but NOT from runtime ledger)
 *
 * @example
 * ```tsx
 * function Calculator({ componentId, workspaceId, position }: Props) {
 *   useComponentRegistration({
 *     workspaceId,
 *     componentId,
 *     componentType: "calculator",
 *     position,
 *   })
 *
 *   // ... rest of component
 * }
 * ```
 *
 * Dev-mode behavior:
 * - Throws error if workspaceId is missing (unless strict: false)
 * - Logs registration/deregistration events
 */
export function useComponentRegistration({
  workspaceId,
  componentId,
  componentType,
  strict = process.env.NODE_ENV === "development",
  position,
  size,
  metadata,
  zIndex,
}: UseComponentRegistrationOptions): void {
  // Track whether we've registered to avoid duplicate registrations
  const isRegisteredRef = useRef(false)
  const lastWorkspaceIdRef = useRef<string | null>(null)
  const isRuntimeRegisteredRef = useRef(false)

  // Phase 1 Unification: Register to runtime ledger (authoritative data)
  // This runs on mount and when key props change
  useEffect(() => {
    if (!workspaceId) return

    // Register/update in runtime ledger
    if (position) {
      registerRuntimeComponent(workspaceId, {
        componentId,
        componentType,
        position,
        size,
        metadata,
        zIndex,
      })
      isRuntimeRegisteredRef.current = true
    }
  }, [workspaceId, componentId, componentType, position, size, metadata, zIndex])

  // Phase 1 Unification: Update runtime ledger when position/metadata changes
  useEffect(() => {
    if (!workspaceId || !isRuntimeRegisteredRef.current) return

    // Only update if we have position (component is positioned)
    if (position) {
      updateRuntimeComponent(workspaceId, componentId, {
        position,
        size,
        metadata,
        zIndex,
      })
    }
  }, [workspaceId, componentId, position, size, metadata, zIndex])

  // Phase 1 Unification: Touch component when visible (update lastSeenAt)
  useEffect(() => {
    if (!workspaceId) return
    touchRuntimeComponent(workspaceId, componentId)
  }, [workspaceId, componentId])

  // React lifecycle registration (for hot runtime detection)
  useEffect(() => {
    // Dev-mode assertion: workspaceId is required (unless strict is false)
    if (!workspaceId) {
      if (strict) {
        console.error(
          `[useComponentRegistration] Missing workspaceId for component "${componentId}" (type: ${componentType}). ` +
          `All components must specify their target workspace. ` +
          `If this is a legacy component, pass strict: false to suppress this error.`
        )
        throw new Error(
          `Component "${componentId}" (type: ${componentType}) rendered without workspaceId. ` +
          `All components must be associated with a workspace.`
        )
      }
      return
    }

    // If workspace changed, deregister from old workspace first (React lifecycle only)
    if (lastWorkspaceIdRef.current && lastWorkspaceIdRef.current !== workspaceId) {
      if (isRegisteredRef.current) {
        deregisterComponent(lastWorkspaceIdRef.current, componentId)
        isRegisteredRef.current = false
      }
    }

    // Register with new workspace (React lifecycle)
    if (!isRegisteredRef.current || !isComponentRegistered(workspaceId, componentId)) {
      registerComponent(workspaceId, componentId, componentType)
      isRegisteredRef.current = true
      lastWorkspaceIdRef.current = workspaceId
    }

    // Cleanup on unmount - ONLY deregister from React lifecycle
    // Do NOT remove from runtime ledger - data should persist across unmounts
    return () => {
      if (isRegisteredRef.current && workspaceId) {
        deregisterComponent(workspaceId, componentId)
        isRegisteredRef.current = false
        // Note: We intentionally do NOT call removeRuntimeComponent here
        // The runtime ledger should preserve component data across unmounts
      }
    }
  }, [workspaceId, componentId, componentType, strict])
}

/**
 * Dev-mode assertion to check if a component has workspaceId.
 * Call this at the top of component render functions to catch missing workspaceId early.
 *
 * @example
 * ```tsx
 * function Calculator({ componentId, workspaceId }: Props) {
 *   assertWorkspaceId(workspaceId, componentId, "calculator")
 *   // ...
 * }
 * ```
 */
export function assertWorkspaceId(
  workspaceId: string | null | undefined,
  componentId: string,
  componentType: string,
): asserts workspaceId is string {
  if (process.env.NODE_ENV === "development") {
    if (!workspaceId || typeof workspaceId !== "string" || workspaceId.trim() === "") {
      console.error(
        `[assertWorkspaceId] Component "${componentId}" (type: ${componentType}) ` +
        `is missing workspaceId. This is required for workspace isolation.`,
        { workspaceId, componentId, componentType }
      )
      throw new Error(
        `Component "${componentId}" (type: ${componentType}) rendered without workspaceId.`
      )
    }
  }
}
