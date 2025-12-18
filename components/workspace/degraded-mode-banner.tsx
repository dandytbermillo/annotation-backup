"use client"

import { useCallback } from "react"
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { AlertTriangle, RefreshCw } from "lucide-react"
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
 *
 * Design decision: No dismiss (X) button while in degraded mode.
 * Degraded mode is a hard gate that blocks cold workspace opens to prevent
 * data loss. Allowing users to hide the only explanation creates confusion
 * ("why can't I open workspaces?"). User must click Retry to dismiss.
 */
export function DegradedModeBanner({ isDegradedMode, onRetry }: DegradedModeBannerProps) {
  const handleRetry = useCallback(() => {
    // Check online status before retry
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

    toast({
      title: "Retry enabled",
      description: "You can now try switching workspaces again.",
    })
  }, [onRetry])

  if (!isDegradedMode) {
    return null
  }

  return (
    <div
      className="fixed top-2 left-1/2 -translate-x-1/2 w-full max-w-lg px-4"
      style={{ zIndex: Z_INDEX.MODAL + 10 }}
    >
      <Alert variant="destructive" className="shadow-lg border-destructive/50 bg-destructive/10">
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle>Workspace System Degraded</AlertTitle>
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
