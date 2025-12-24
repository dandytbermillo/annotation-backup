"use client"

import { AnnotationAppShell } from "@/components/annotation-app-shell"
import { ChatNavigationRoot } from "@/components/chat"
import { DashboardInitializer } from "@/components/dashboard"
import { ChatNavigationProvider } from "@/lib/chat"

export function AnnotationApp() {
  return (
    <ChatNavigationProvider>
      <DashboardInitializer>
        <AnnotationAppShell />
      </DashboardInitializer>
      <ChatNavigationRoot />
    </ChatNavigationProvider>
  )
}
