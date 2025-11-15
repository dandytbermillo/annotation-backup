import React, { forwardRef, useImperativeHandle } from "react"
import TestRenderer, { act } from "react-test-renderer"

import { useAddComponentMenu } from "@/lib/hooks/annotation/use-add-component-menu"

type Handler = ReturnType<typeof useAddComponentMenu>

type HarnessProps = Parameters<typeof useAddComponentMenu>[0]

const Harness = forwardRef<Handler, HarnessProps>((props, ref) => {
  const state = useAddComponentMenu(props ?? {})
  useImperativeHandle(ref, () => state, [state])
  return null
})
Harness.displayName = "AddComponentMenuHarness"

describe("useAddComponentMenu", () => {
  it("manages internal state when no external controls provided", async () => {
    const ref = React.createRef<Handler>()
    await act(async () => {
      TestRenderer.create(<Harness ref={ref} />)
    })

    expect(ref.current?.showAddComponentMenu).toBe(false)

    await act(async () => {
      ref.current?.toggleAddComponentMenu()
    })

    expect(ref.current?.showAddComponentMenu).toBe(true)

    await act(async () => {
      ref.current?.closeAddComponentMenu()
    })

    expect(ref.current?.showAddComponentMenu).toBe(false)
  })

  it("respects external controls when provided", async () => {
    const toggle = jest.fn()
    const ref = React.createRef<Handler>()
    await act(async () => {
      TestRenderer.create(
        <Harness ref={ref} externalShowAddComponentMenu={true} onToggleAddComponentMenu={toggle} />,
      )
    })

    expect(ref.current?.showAddComponentMenu).toBe(true)

    await act(async () => {
      ref.current?.toggleAddComponentMenu()
    })

    expect(toggle).toHaveBeenCalled()
    expect(ref.current?.showAddComponentMenu).toBe(true)
  })
})
