import { useMemo, useState } from "react"
import {
  appendWorkspaceParam as baseAppendWorkspaceParam,
  withWorkspaceHeaders as baseWithWorkspaceHeaders,
  withWorkspacePayload as baseWithWorkspacePayload,
} from "@/lib/workspaces/client-utils"

type KnowledgeBaseWorkspaceHookOptions = {
  initialWorkspaceId?: string | null
  fetcher?: typeof fetch
}

export type KnowledgeBaseWorkspaceApi = {
  workspaceId: string | null
  setWorkspaceId: (nextId: string | null) => void
  appendWorkspaceParam: (url: string, overrideId?: string | null) => string
  withWorkspaceHeaders: <T extends RequestInit | undefined>(
    init?: T,
    overrideId?: string | null,
  ) => T
  withWorkspacePayload: <T extends Record<string, unknown>>(
    payload: T,
    overrideId?: string | null,
  ) => T
  fetchWithWorkspace: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
  resolveWorkspaceId: (resolvedId?: string | null) => void
}

type KnowledgeBaseWorkspaceFactoryOptions = {
  getWorkspaceId: () => string | null
  setWorkspaceId: (nextId: string | null) => void
  fetcher?: typeof fetch
}

/**
 * Centralizes access to the Knowledge Base workspace identifier and helper utilities.
 * Returns hoisted helpers so components avoid duplicating request decoration logic.
 */
export function createKnowledgeBaseWorkspaceApi(
  options: KnowledgeBaseWorkspaceFactoryOptions,
): KnowledgeBaseWorkspaceApi {
  const { getWorkspaceId, setWorkspaceId, fetcher = fetch } = options

  const appendWorkspaceParam = (url: string, overrideId?: string | null) =>
    baseAppendWorkspaceParam(url, overrideId ?? getWorkspaceId())

  const withWorkspaceHeaders = <T extends RequestInit | undefined>(init?: T, overrideId?: string | null): T =>
    baseWithWorkspaceHeaders(init, overrideId ?? getWorkspaceId()) as T

  const withWorkspacePayload = <T extends Record<string, unknown>>(payload: T, overrideId?: string | null): T =>
    baseWithWorkspacePayload(payload, overrideId ?? getWorkspaceId()) as T

  const fetchWithWorkspace = (input: RequestInfo | URL, init?: RequestInit) =>
    fetcher(input, withWorkspaceHeaders(init))

  const resolveWorkspaceId = (resolvedId?: string | null) => {
    const currentId = getWorkspaceId()
    if (resolvedId && resolvedId !== currentId) {
      setWorkspaceId(resolvedId)
    }
  }

  return {
    workspaceId: getWorkspaceId(),
    setWorkspaceId,
    appendWorkspaceParam,
    withWorkspaceHeaders,
    withWorkspacePayload,
    fetchWithWorkspace,
    resolveWorkspaceId,
  }
}

export function useKnowledgeBaseWorkspace(
  options: KnowledgeBaseWorkspaceHookOptions = {},
): KnowledgeBaseWorkspaceApi {
  const { initialWorkspaceId = null, fetcher = fetch } = options
  const [workspaceId, setWorkspaceId] = useState<string | null>(initialWorkspaceId)

  return useMemo(
    () =>
      createKnowledgeBaseWorkspaceApi({
        getWorkspaceId: () => workspaceId,
        setWorkspaceId,
        fetcher,
      }),
    [fetcher, workspaceId],
  )
}
