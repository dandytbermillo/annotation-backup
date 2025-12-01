"use client"

import { useEffect, useRef } from "react"
import {
  registerComponent,
  deregisterComponent,
  isComponentRegistered,
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
}

/**
 * Hook for registering a component (calculator, timer, alarm, etc.) with a workspace runtime.
 *
 * Components must use this hook to participate in the workspace lifecycle.
 * The hook automatically registers on mount and deregisters on unmount.
 *
 * @example
 * ```tsx
 * function Calculator({ componentId, workspaceId }: Props) {
 *   useComponentRegistration({
 *     workspaceId,
 *     componentId,
 *     componentType: "calculator",
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
}: UseComponentRegistrationOptions): void {
  // Track whether we've registered to avoid duplicate registrations
  const isRegisteredRef = useRef(false)
  const lastWorkspaceIdRef = useRef<string | null>(null)

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

    // If workspace changed, deregister from old workspace first
    if (lastWorkspaceIdRef.current && lastWorkspaceIdRef.current !== workspaceId) {
      if (isRegisteredRef.current) {
        deregisterComponent(lastWorkspaceIdRef.current, componentId)
        isRegisteredRef.current = false
      }
    }

    // Register with new workspace
    if (!isRegisteredRef.current || !isComponentRegistered(workspaceId, componentId)) {
      registerComponent(workspaceId, componentId, componentType)
      isRegisteredRef.current = true
      lastWorkspaceIdRef.current = workspaceId
    }

    // Cleanup on unmount
    return () => {
      if (isRegisteredRef.current && workspaceId) {
        deregisterComponent(workspaceId, componentId)
        isRegisteredRef.current = false
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
