import { useCallback, useEffect, useState } from 'react'

import type { LayerContextValue } from '@/components/canvas/layer-provider'

export type CanvasMode = 'overlay' | 'notes' | 'constellation'

interface UseCanvasModeOptions {
  layerContext: LayerContextValue | null
  onModeChange?: (mode: CanvasMode) => void
}

export function useCanvasMode({
  layerContext,
  onModeChange,
}: UseCanvasModeOptions) {
  const [mode, setModeState] = useState<CanvasMode>('overlay')

  useEffect(() => {
    if (!layerContext) return
    if (layerContext.activeLayer === 'popups') {
      setModeState(prev => (prev === 'overlay' ? prev : 'overlay'))
      return
    }

    // Active layer is notes; preserve constellation if already selected
    setModeState(prev => {
      if (prev === 'constellation') return prev
      if (prev === 'notes') return prev
      return 'notes'
    })
  }, [layerContext?.activeLayer])

  useEffect(() => {
    onModeChange?.(mode)
  }, [mode, onModeChange])

  const setMode = useCallback(
    (next: CanvasMode) => {
      if (!layerContext) {
        setModeState(next === 'overlay' ? 'overlay' : next)
        return
      }

      if (next === 'overlay') {
        layerContext.setActiveLayer('popups')
        setModeState('overlay')
        return
      }

      layerContext.setActiveLayer('notes')
      setModeState(next)
    },
    [layerContext]
  )

  return { mode, setMode }
}
