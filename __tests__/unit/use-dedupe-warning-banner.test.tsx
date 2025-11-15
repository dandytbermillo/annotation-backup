import { renderHook, act } from "@testing-library/react-hooks"

import { useDedupeWarningBanner } from "@/lib/hooks/annotation/use-dedupe-warning-banner"

const warnings = [
  { code: "missing_metadata", message: "Panel missing metadata", panelId: "panel-1" },
  { code: "duplicate", message: "Duplicate panel", panelId: "panel-2" },
  { code: "stale", message: "Stale panel", panelId: "panel-3" },
]

describe("useDedupeWarningBanner", () => {
  it("exposes visible warnings and extra count", () => {
    const updateMock = jest.fn()
    const { result } = renderHook(() =>
      useDedupeWarningBanner({
        dedupeWarnings: warnings,
        updateDedupeWarnings: updateMock,
      }),
    )

    expect(result.current.hasWarnings).toBe(true)
    expect(result.current.visibleWarnings).toHaveLength(3)
    expect(result.current.extraCount).toBe(0)
  })

  it("dismisses warnings by clearing via update callback", () => {
    const updateMock = jest.fn()
    const { result } = renderHook(() =>
      useDedupeWarningBanner({
        dedupeWarnings: warnings,
        updateDedupeWarnings: updateMock,
      }),
    )

    act(() => {
      result.current.dismissWarnings()
    })

    expect(updateMock).toHaveBeenCalledWith([], { append: false })
  })
})
