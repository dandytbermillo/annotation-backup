import { createKnowledgeBaseWorkspaceApi } from '@/lib/hooks/annotation/use-knowledge-base-workspace'

const createApi = (initialId: string | null = null) => {
  let workspaceId = initialId
  const mockFetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ success: true })
  })

  const build = () =>
    createKnowledgeBaseWorkspaceApi({
      getWorkspaceId: () => workspaceId,
      setWorkspaceId: (nextId: string | null) => {
        workspaceId = nextId
      },
      fetcher: mockFetch as unknown as typeof fetch
    })

  return {
    build,
    mockFetch,
    getWorkspaceId: () => workspaceId
  }
}

describe('createKnowledgeBaseWorkspaceApi', () => {
  it('decorates requests and payloads with the current workspace id', async () => {
    const helper = createApi('ws-123')
    let api = helper.build()

    expect(api.appendWorkspaceParam('/api/items')).toBe('/api/items?workspaceId=ws-123')

    const payload = api.withWorkspacePayload({ foo: 'bar' })
    expect(payload.workspaceId).toBe('ws-123')

    await api.fetchWithWorkspace('/api/items', { method: 'GET' })
    expect(helper.mockFetch).toHaveBeenCalledWith(
      '/api/items',
      expect.objectContaining({
        method: 'GET',
        headers: expect.any(Headers)
      })
    )

    const headers = helper.mockFetch.mock.calls[0][1].headers as Headers
    expect(headers.get('X-Overlay-Workspace-ID')).toBe('ws-123')
  })

  it('updates workspace id when resolveWorkspaceId is called with a new value', () => {
    const helper = createApi('ws-initial')
    let api = helper.build()
    expect(api.workspaceId).toBe('ws-initial')

    api.resolveWorkspaceId('ws-next')
    api = helper.build()
    expect(api.workspaceId).toBe('ws-next')

    api.resolveWorkspaceId(null)
    api = helper.build()
    expect(api.workspaceId).toBe('ws-next')
  })

  it('leaves payloads untouched when no workspace id is set', () => {
    const helper = createApi(null)
    const api = helper.build()

    const payload = { foo: 'bar' }
    expect(api.withWorkspacePayload(payload)).toEqual(payload)

    const appended = api.appendWorkspaceParam('/api/items?parentId=root')
    expect(appended).toBe('/api/items?parentId=root')
  })
})

