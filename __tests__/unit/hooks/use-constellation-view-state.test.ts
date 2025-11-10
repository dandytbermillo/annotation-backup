import { renderHook, act } from './test-utils/render-hook'

import { useConstellationViewState } from '@/lib/hooks/annotation/use-constellation-view-state'

describe('useConstellationViewState', () => {
  it('toggles constellation panel visibility', () => {
    const { result } = renderHook(() =>
      useConstellationViewState({
        layerContext: null
      })
    )

    expect(result.current.showConstellationPanel).toBe(false)

    act(() => {
      result.current.toggleConstellationView()
    })

    expect(result.current.showConstellationPanel).toBe(true)

    act(() => {
      result.current.toggleConstellationView()
    })

    expect(result.current.showConstellationPanel).toBe(false)
  })

  it('handles sidebar tab changes', () => {
    const { result } = renderHook(() =>
      useConstellationViewState({
        layerContext: null
      })
    )

    act(() => {
      result.current.handleSidebarTabChange('constellation')
    })

    expect(result.current.showConstellationPanel).toBe(true)

    act(() => {
      result.current.handleSidebarTabChange('organization')
    })

    expect(result.current.showConstellationPanel).toBe(false)
  })
})
