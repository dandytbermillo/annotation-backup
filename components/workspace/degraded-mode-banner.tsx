"use client"

import { useCallback, useState } from "react"
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { AlertTriangle, RefreshCw, X } from "lucide-react"
import { toast } from "@/hooks/use-toast"
import { Z_INDEX } from "@/lib/constants/z-index"

export interface DegradedModeBannerProps {
  /** Whether the system is in degraded mode */
  isDegradedMode: boolean
  /** Callback to reset degraded mode and retry */
  onRetry: () => void
}

/**
 * Degraded Mode Banner
 *
 * Displays a persistent banner when the workspace system enters degraded mode
 * (after consecutive persist failures). Provides a Retry action to reset
 * degraded mode and attempt workspace operations again.
 *
 * Part of Hard-Safe 4-Cap Eviction - wires resetDegradedMode() to UI.
 */
export function DegradedModeBanner({ isDegradedMode, onRetry }: DegradedModeBannerProps) {
  const [isDismissed, setIsDismissed] = useState(false)

  // Reset dismissed state when degraded mode changes
  // (so banner reappears if we enter degraded mode again)
  const isVisible = isDegradedMode && !isDismissed

  const handleRetry = useCallback(() => {
    // Phase 3 guardrail: Check online status before retry
    if (!navigator.onLine) {
      toast({
        title: "You are offline",
        description: "Please check your connection and try again.",
        variant: "destructive",
      })
      return
    }

    // Reset degraded mode
    onRetry()
    setIsDismissed(true)

    toast({
      title: "Retry enabled",
      description: "You can now try switching workspaces again.",
    })
  }, [onRetry])

  const handleDismiss = useCallback(() => {
    setIsDismissed(true)
  }, [])

  if (!isVisible) {
    return null
  }

  return (
    <div
      className="fixed top-2 left-1/2 -translate-x-1/2 w-full max-w-lg px-4"
      style={{ zIndex: Z_INDEX.MODAL + 10 }}
    >
      <Alert variant="destructive" className="shadow-lg border-destructive/50 bg-destructive/10">
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle className="flex items-center justify-between">
          <span>Workspace System Degraded</span>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0 hover:bg-destructive/20"
            onClick={handleDismiss}
            aria-label="Dismiss"
          >
            <X className="h-4 w-4" />
          </Button>
        </AlertTitle>
        <AlertDescription className="mt-2">
          <p className="text-sm mb-3">
            Multiple save failures detected. Opening new workspaces is blocked to prevent data loss.
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={handleRetry}
            className="gap-2"
          >
            <RefreshCw className="h-3 w-3" />
            Retry
          </Button>
        </AlertDescription>
      </Alert>
    </div>
  )
}
