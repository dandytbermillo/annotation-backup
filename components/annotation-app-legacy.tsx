"use client"

import { AnnotationAppShell } from "@/components/annotation-app-shell"

/**
 * LegacyAnnotationApp keeps the pre-shell code path available so we can
 * flip the flag off without redeploying a new build. For now it simply
 * reuses the shell wiring; when we diverge we can swap this component
 * without touching the flag orchestrator.
 */
export function LegacyAnnotationApp() {
  return <AnnotationAppShell />
}
