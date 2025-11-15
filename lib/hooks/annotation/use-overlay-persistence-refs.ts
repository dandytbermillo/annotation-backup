import { useRef } from "react"
import type { MutableRefObject } from "react"

import type {
  OverlayLayoutAdapter,
  OverlayLayoutPayload,
} from "@/lib/adapters/overlay-layout-adapter"

type OverlayPersistenceRefs = {
  overlayAdapterRef: MutableRefObject<OverlayLayoutAdapter | null>
  layoutLoadedRef: MutableRefObject<boolean>
  layoutRevisionRef: MutableRefObject<string | null>
  lastSavedLayoutHashRef: MutableRefObject<string | null>
  pendingLayoutRef: MutableRefObject<{ payload: OverlayLayoutPayload; hash: string } | null>
  saveInFlightRef: MutableRefObject<boolean>
  saveTimeoutRef: MutableRefObject<NodeJS.Timeout | null>
  isInitialLoadRef: MutableRefObject<boolean>
  layoutLoadStartedAtRef: MutableRefObject<number>
  hydrationRunIdRef: MutableRefObject<string | null>
  layoutDirtyRef: MutableRefObject<boolean>
}

export function useOverlayPersistenceRefs(): OverlayPersistenceRefs {
  const overlayAdapterRef = useRef<OverlayLayoutAdapter | null>(null)
  const layoutLoadedRef = useRef(false)
  const layoutRevisionRef = useRef<string | null>(null)
  const lastSavedLayoutHashRef = useRef<string | null>(null)
  const pendingLayoutRef = useRef<{ payload: OverlayLayoutPayload; hash: string } | null>(null)
  const saveInFlightRef = useRef(false)
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const isInitialLoadRef = useRef(false)
  const layoutLoadStartedAtRef = useRef(0)
  const hydrationRunIdRef = useRef<string | null>(null)
  const layoutDirtyRef = useRef(false)

  return {
    overlayAdapterRef,
    layoutLoadedRef,
    layoutRevisionRef,
    lastSavedLayoutHashRef,
    pendingLayoutRef,
    saveInFlightRef,
    saveTimeoutRef,
    isInitialLoadRef,
    layoutLoadStartedAtRef,
    hydrationRunIdRef,
    layoutDirtyRef,
  }
}
