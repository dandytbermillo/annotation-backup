import React from 'react'
import TestRenderer, { act } from 'react-test-renderer'

type RenderHookResult<TResult> = {
  result: {
    current: TResult
  }
  rerender: () => void
  unmount: () => void
}

export function renderHook<TResult>(callback: () => TResult): RenderHookResult<TResult> {
  const result: { current: TResult } = {
    current: undefined as unknown as TResult
  }

  function HookWrapper() {
    result.current = callback()
    return null
  }

  let renderer!: TestRenderer.ReactTestRenderer
  act(() => {
    const originalError = console.error
    console.error = (...args: unknown[]) => {
      if (
        typeof args[0] === 'string' &&
        args[0].toLowerCase().includes('react-test-renderer is deprecated')
      ) {
        return
      }
      originalError(...args)
    }
    try {
      renderer = TestRenderer.create(React.createElement(HookWrapper))
    } finally {
      console.error = originalError
    }
  })

  return {
    result,
    rerender: () => {
      renderer.update(React.createElement(HookWrapper))
    },
    unmount: () => {
      renderer.unmount()
    }
  }
}

export { act }
