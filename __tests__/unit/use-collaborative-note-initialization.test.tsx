import React from "react"
import TestRenderer, { act } from "react-test-renderer"

import { useCollaborativeNoteInitialization } from "@/lib/hooks/annotation/use-collaborative-note-initialization"

jest.mock("@/lib/utils/debug-logger", () => ({
  debugLog: jest.fn(),
}))

const mockIsPlainModeActive = jest.fn()
jest.mock("@/lib/collab-mode", () => ({
  isPlainModeActive: () => mockIsPlainModeActive(),
}))

type ProviderStub = {
  setCurrentNote: jest.Mock
  initializeDefaultData: jest.Mock
}

type HarnessProps = {
  noteId: string
  workspaceMainPosition?: { x: number; y: number } | null
  provider: ProviderStub
}

function HookHarness({ noteId, workspaceMainPosition = null, provider }: HarnessProps) {
  useCollaborativeNoteInitialization({
    noteId,
    workspaceMainPosition,
    provider: provider as any,
  })
  return null
}

describe("useCollaborativeNoteInitialization", () => {
  const consoleLogSpy = jest.spyOn(console, "log").mockImplementation(() => {})

  afterAll(() => {
    consoleLogSpy.mockRestore()
  })

  beforeEach(() => {
    mockIsPlainModeActive.mockReset()
  })

  it("initializes provider defaults when collaboration mode is active", async () => {
    mockIsPlainModeActive.mockReturnValue(false)
    const provider: ProviderStub = {
      setCurrentNote: jest.fn(),
      initializeDefaultData: jest.fn(),
    }

    await act(async () => {
      TestRenderer.create(
        <HookHarness
          noteId="note-1"
          workspaceMainPosition={{ x: 120, y: 340 }}
          provider={provider}
        />,
      )
    })

    expect(provider.setCurrentNote).toHaveBeenCalledWith("note-1")
    expect(provider.initializeDefaultData).toHaveBeenCalledWith(
      "note-1",
      expect.objectContaining({
        main: expect.objectContaining({
          position: { x: 120, y: 340 },
          isNew: true,
        }),
      }),
    )
  })

  it("skips initialization entirely in plain mode", async () => {
    mockIsPlainModeActive.mockReturnValue(true)
    const provider: ProviderStub = {
      setCurrentNote: jest.fn(),
      initializeDefaultData: jest.fn(),
    }

    await act(async () => {
      TestRenderer.create(
        <HookHarness noteId="note-1" workspaceMainPosition={null} provider={provider} />,
      )
    })

    expect(provider.setCurrentNote).not.toHaveBeenCalled()
    expect(provider.initializeDefaultData).not.toHaveBeenCalled()
  })
})
