import { createFolderCacheApi, type FolderCacheEntry } from '@/lib/hooks/annotation/use-folder-cache'

const createJsonResponse = <T,>(body: T) =>
  ({
    ok: true,
    json: async () => body
  }) as Response

const createCacheHarness = (overrides?: {
  workspaceId?: string | null
  cacheMaxAgeMs?: number
  logger?: jest.Mock
}) => {
  const cache = new Map<string, FolderCacheEntry>()
  let now = 0
  const mockFetch = jest.fn()
  const logger = overrides?.logger ?? jest.fn()

  const api = createFolderCacheApi({
    workspaceId: overrides?.workspaceId ?? 'ws-abc',
    cache,
    cacheMaxAgeMs: overrides?.cacheMaxAgeMs ?? 1_000,
    fetcher: mockFetch as unknown as typeof fetch,
    logger: logger as any,
    now: () => now
  })

  return {
    api,
    cache,
    mockFetch,
    logger,
    advance: (ms: number) => {
      now += ms
    }
  }
}

describe('createFolderCacheApi', () => {
  it('caches folder snapshots and reuses them without refetching', async () => {
    const harness = createCacheHarness()
    harness.mockFetch.mockResolvedValueOnce(
      createJsonResponse({
        id: 'folder-1',
        name: 'Inbox'
      })
    )

    const folder = await harness.api.fetchFolder('folder-1')
    expect(folder).toEqual({ id: 'folder-1', name: 'Inbox' })
    expect(harness.mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/items/folder-1?workspaceId=ws-abc')
    )

    harness.mockFetch.mockClear()
    const cached = await harness.api.fetchFolder('folder-1')
    expect(cached).toEqual({ id: 'folder-1', name: 'Inbox' })
    expect(harness.mockFetch).not.toHaveBeenCalled()
  })

  it('refreshes children after the TTL expires and supports invalidation', async () => {
    const harness = createCacheHarness({ cacheMaxAgeMs: 100 })
    harness.mockFetch
      .mockResolvedValueOnce(
        createJsonResponse({
          items: [{ id: 'child-1', name: 'Doc' }]
        })
      )
      .mockResolvedValueOnce(
        createJsonResponse({
          items: [{ id: 'child-2', name: 'New Doc' }]
        })
      )

    const firstChildren = await harness.api.fetchChildren('folder-2')
    expect(firstChildren).toEqual([{ id: 'child-1', name: 'Doc' }])

    harness.mockFetch.mockClear()
    const cached = await harness.api.fetchChildren('folder-2')
    expect(cached).toEqual([{ id: 'child-1', name: 'Doc' }])
    expect(harness.mockFetch).not.toHaveBeenCalled()

    harness.advance(150)

    const refreshed = await harness.api.fetchChildren('folder-2')
    expect(refreshed).toEqual([{ id: 'child-2', name: 'New Doc' }])

    harness.api.invalidate('folder-2')
    expect(harness.api.getEntry('folder-2')).toBeNull()
  })

  it('returns cached children when a forced refresh fails', async () => {
    const harness = createCacheHarness()
    harness.mockFetch
      .mockResolvedValueOnce(
        createJsonResponse({
          items: [{ id: 'child-1', name: 'Doc' }]
        })
      )
      .mockRejectedValueOnce(new Error('network down'))

    const baseline = await harness.api.fetchChildren('folder-3')
    expect(baseline).toEqual([{ id: 'child-1', name: 'Doc' }])

    const fallback = await harness.api.fetchChildren('folder-3', { forceRefresh: true })
    expect(fallback).toEqual(baseline)
  })

  it('logs folder fetch failures and returns null', async () => {
    const mockLogger = jest.fn()
    const harness = createCacheHarness({ logger: mockLogger })
    harness.mockFetch.mockRejectedValue(new Error('offline'))

    const result = await harness.api.fetchFolder('missing-folder')
    expect(result).toBeNull()
    expect(mockLogger).toHaveBeenCalledWith(
      expect.objectContaining({
        component: 'useFolderCache',
        action: 'fetch_folder_failed',
        metadata: expect.objectContaining({
          folderId: 'missing-folder'
        })
      })
    )
  })
})
