"use client"

import { AnnotationAppShell, getAnnotationAppPhase } from "@/components/annotation-app-shell"
import { LegacyAnnotationApp } from "@/components/annotation-app-legacy"

const SHELL_PHASES = new Set(["shell", "shell_test", "all"])

export function AnnotationApp() {
  const phase = getAnnotationAppPhase()
  if (SHELL_PHASES.has(phase)) {
    return <AnnotationAppShell />
  }
  return <LegacyAnnotationApp />
}

export { getAnnotationAppPhase }
