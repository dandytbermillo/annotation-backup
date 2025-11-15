import React, { useEffect } from "react"
import TestRenderer, { act } from "react-test-renderer"

import { useDedupeWarningBanner } from "@/lib/hooks/annotation/use-dedupe-warning-banner"

const warnings = [
  { code: "missing_metadata", message: "Panel missing metadata", panelId: "panel-1" },
  { code: "duplicate", message: "Duplicate panel", panelId: "panel-2" },
  { code: "stale", message: "Stale panel", panelId: "panel-3" },
]

function BannerHarness({
  dedupeWarnings,
  updateDedupeWarnings,
  onState,
}: {
  dedupeWarnings: typeof warnings
  updateDedupeWarnings: jest.Mock
  onState: (state: ReturnType<typeof useDedupeWarningBanner>) => void
}) {
  const state = useDedupeWarningBanner({ dedupeWarnings, updateDedupeWarnings })

  useEffect(() => {
    onState(state)
  }, [state, onState])

  return null
}

describe("useDedupeWarningBanner", () => {
  it("exposes visible warnings and extra count", async () => {
    const updateMock = jest.fn()
    let latest: ReturnType<typeof useDedupeWarningBanner> | null = null

    await act(async () => {
      TestRenderer.create(
        <BannerHarness
          dedupeWarnings={warnings}
          updateDedupeWarnings={updateMock}
          onState={state => {
            latest = state
          }}
        />,
      )
    })

    expect(latest?.hasWarnings).toBe(true)
    expect(latest?.visibleWarnings).toHaveLength(3)
    expect(latest?.extraCount).toBe(0)
  })

  it("dismisses warnings by clearing via update callback", async () => {
    const updateMock = jest.fn()
    let latest: ReturnType<typeof useDedupeWarningBanner> | null = null

    await act(async () => {
      TestRenderer.create(
        <BannerHarness
          dedupeWarnings={warnings}
          updateDedupeWarnings={updateMock}
          onState={state => {
            latest = state
          }}
        />,
      )
    })

    await act(async () => {
      latest?.dismissWarnings()
    })

    expect(updateMock).toHaveBeenCalledWith([], { append: false })
  })
})
