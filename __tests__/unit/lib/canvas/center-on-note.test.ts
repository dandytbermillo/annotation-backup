import { centerOnNotePanel } from "@/lib/canvas/center-on-note"

describe("centerOnNotePanel", () => {
  afterEach(() => {
    jest.useRealTimers()
    jest.clearAllTimers()
  })

  it("returns false when canvas is unavailable", () => {
    expect(centerOnNotePanel(null, "abc123")).toBe(false)
    expect(centerOnNotePanel({}, "abc123")).toBe(false)
  })

  it("returns false when noteId is empty", () => {
    const centerOnPanel = jest.fn()
    expect(centerOnNotePanel({ centerOnPanel }, "")).toBe(false)
    expect(centerOnPanel).not.toHaveBeenCalled()
  })

  it("centers on the composite main panel key immediately", () => {
    const centerOnPanel = jest.fn()
    const noteId = "note-001"

    const handled = centerOnNotePanel({ centerOnPanel }, noteId, { attempts: 0 })

    expect(handled).toBe(true)
    expect(centerOnPanel).toHaveBeenCalledTimes(1)
    expect(centerOnPanel).toHaveBeenCalledWith(`${noteId}::main`)
  })

  it("retries when shouldRetry remains true", () => {
    jest.useFakeTimers()
    const centerOnPanel = jest.fn()
    let retriesAllowed = 3

    centerOnNotePanel(
      { centerOnPanel },
      "note-xyz",
      {
        attempts: 2,
        delayMs: 10,
        shouldRetry: () => {
          retriesAllowed -= 1
          return retriesAllowed >= 0
        },
      },
    )

    expect(centerOnPanel).toHaveBeenCalledTimes(1)
    jest.advanceTimersByTime(10)
    expect(centerOnPanel).toHaveBeenCalledTimes(2)
    jest.advanceTimersByTime(10)
    expect(centerOnPanel).toHaveBeenCalledTimes(3)
  })

  it("stops scheduling when shouldRetry returns false", () => {
    jest.useFakeTimers()
    const centerOnPanel = jest.fn()

    centerOnNotePanel(
      { centerOnPanel },
      "note-stop",
      {
        attempts: 3,
        delayMs: 5,
        shouldRetry: () => false,
      },
    )

    expect(centerOnPanel).toHaveBeenCalledTimes(1)
    jest.advanceTimersByTime(100)
    expect(centerOnPanel).toHaveBeenCalledTimes(1)
  })
})
