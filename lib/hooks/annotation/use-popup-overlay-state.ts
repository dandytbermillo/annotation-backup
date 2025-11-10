import { useMemo, useState } from "react"
import type { OverlayPopup } from "@/components/floating-toolbar"

type UsePopupOverlayStateOptions = {
  initialPopups?: OverlayPopup[]
}

type UsePopupOverlayStateResult = {
  popups: OverlayPopup[]
  setPopups: React.Dispatch<React.SetStateAction<OverlayPopup[]>>
  draggingPopup: string | null
  setDraggingPopup: React.Dispatch<React.SetStateAction<string | null>>
  overlayPanning: boolean
  setOverlayPanning: (active: boolean) => void
}

export function usePopupOverlayState({
  initialPopups = [],
}: UsePopupOverlayStateOptions = {}): UsePopupOverlayStateResult {
  const [popups, setPopups] = useState<OverlayPopup[]>(initialPopups)
  const [draggingPopup, setDraggingPopup] = useState<string | null>(null)
  const [overlayPanning, setOverlayPanning] = useState(false)
  return useMemo(
    () => ({
      popups,
      setPopups,
      draggingPopup,
      setDraggingPopup,
      overlayPanning,
      setOverlayPanning,
    }),
    [
      draggingPopup,
      overlayPanning,
      setOverlayPanning,
      popups,
      setPopups,
    ],
  )
}
