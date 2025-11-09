export function appendWorkspaceParam(path: string, workspaceId?: string | null): string {
  if (!workspaceId) return path

  const [resource, hash = ''] = path.split('#')
  const separator = resource.includes('?') ? '&' : '?'
  const suffix = hash ? `#${hash}` : ''

  return `${resource}${separator}workspaceId=${encodeURIComponent(workspaceId)}${suffix}`
}

export function withWorkspacePayload<T extends Record<string, unknown>>(
  payload: T,
  workspaceId?: string | null
): T {
  if (!workspaceId) return payload
  return {
    ...payload,
    workspaceId,
  }
}

export function withWorkspaceHeaders(
  init: RequestInit | undefined,
  workspaceId?: string | null
): RequestInit {
  if (!workspaceId) {
    return init ?? {}
  }

  const headers = new Headers(init?.headers ?? {})
  headers.set('X-Overlay-Workspace-ID', workspaceId)
  return {
    ...init,
    headers,
  }
}
