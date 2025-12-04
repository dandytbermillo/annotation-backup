"use client"

import { AnnotationAppShell } from "@/components/annotation-app-shell"
import { DashboardInitializer } from "@/components/dashboard"

export function AnnotationApp() {
  return (
    <DashboardInitializer>
      <AnnotationAppShell />
    </DashboardInitializer>
  )
}
