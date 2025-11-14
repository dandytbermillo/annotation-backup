"use client"

import type { UseCanvasSnapshotOptions } from "@/lib/hooks/annotation/use-canvas-snapshot"
import { useCanvasSnapshot } from "@/lib/hooks/annotation/use-canvas-snapshot"

type UseCanvasSnapshotLifecycleOptions = Omit<UseCanvasSnapshotOptions, "skipSnapshotForNote"> & {
  skipSnapshotForNote?: string | null
}

export function useCanvasSnapshotLifecycle({
  skipSnapshotForNote,
  ...rest
}: UseCanvasSnapshotLifecycleOptions) {
  useCanvasSnapshot({
    ...rest,
    skipSnapshotForNote: skipSnapshotForNote ?? null,
  })
}
