import { renderHook, act } from './test-utils/render-hook'

import { useOverlayLayerInteractions } from '@/lib/hooks/annotation/use-overlay-layer-interactions'

describe('useOverlayLayerInteractions', () => {
  const createLayerContext = () => ({
    activeLayer: 'popups',
    setActiveLayer: jest.fn(),
    transforms: { popups: { x: 0, y: 0, scale: 1 } }
  })

  const createHandlers = () => {
    const clearAllTimeouts = jest.fn()
    const setNotesWidgetPosition = jest.fn()
    const setShowNotesWidget = jest.fn()
    const setActivePanelId = jest.fn()
    const debugLog = jest.fn()
    const setAutoOpenFormat = jest.fn()

    return {
      clearAllTimeouts,
      setNotesWidgetPosition,
      setShowNotesWidget,
      setActivePanelId,
      debugLog,
      setAutoOpenFormat
    }
  }

  beforeEach(() => {
    jest.useFakeTimers()
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('closes hover timeouts when switching to notes layer', () => {
    const layerContext = createLayerContext()
    const {
      clearAllTimeouts,
      setNotesWidgetPosition,
      setShowNotesWidget,
      setActivePanelId,
      debugLog,
      setAutoOpenFormat
    } = createHandlers()

    const hook = renderHook(() =>
      useOverlayLayerInteractions({
        layerContext,
        multiLayerEnabled: true,
        clearAllTimeouts,
        canvasState: { translateX: 0, translateY: 0 },
        debugLog,
        setNotesWidgetPosition,
        setShowNotesWidget,
        showNotesWidget: false,
        setActivePanelId,
        setAutoOpenFormat
      })
    )

    act(() => {
      if (layerContext) {
        layerContext.activeLayer = 'notes'
      }
    })
    act(() => {
      hook.rerender()
    })

    expect(clearAllTimeouts).toHaveBeenCalled()
    expect(hook.result.current).toBeTruthy()
  })
})
