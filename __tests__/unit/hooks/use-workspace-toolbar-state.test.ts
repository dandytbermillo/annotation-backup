import { renderHook, act } from './test-utils/render-hook'

import { useWorkspaceToolbarState } from '@/lib/hooks/annotation/use-workspace-toolbar-state'

describe('useWorkspaceToolbarState', () => {
  it('opens and closes the notes widget', () => {
    const { result } = renderHook(() => useWorkspaceToolbarState())

    expect(result.current.showNotesWidget).toBe(false)

    act(() => {
      result.current.openNotesWidgetAt({ x: 10, y: 20 })
    })

    expect(result.current.showNotesWidget).toBe(true)
    expect(result.current.notesWidgetPosition).toEqual({ x: 10, y: 20 })

    act(() => {
      result.current.closeNotesWidget()
    })

    expect(result.current.showNotesWidget).toBe(false)
  })

  it('increments the recent notes refresh trigger', () => {
    const { result } = renderHook(() => useWorkspaceToolbarState())

    expect(result.current.recentNotesRefreshTrigger).toBe(0)

    act(() => {
      result.current.bumpRecentNotesRefresh()
    })

    expect(result.current.recentNotesRefreshTrigger).toBe(1)
  })
})
