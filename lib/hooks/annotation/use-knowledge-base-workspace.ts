import { useCallback, useMemo, useState } from "react"
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
  withWorkspacePayload: <T>(
    payload: T,
    overrideId?: string | null,
  ) => T
  fetchWithWorkspace: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
  resolveWorkspaceId: (resolvedId?: string | null) => void
}

/**
 * Centralizes access to the Knowledge Base workspace identifier and helper utilities.
 * Returns hoisted helpers so components avoid duplicating request decoration logic.
 */
export function useKnowledgeBaseWorkspace(
  options: KnowledgeBaseWorkspaceHookOptions = {},
): KnowledgeBaseWorkspaceApi {
  const { initialWorkspaceId = null, fetcher = fetch } = options
  const [workspaceId, setWorkspaceId] = useState<string | null>(initialWorkspaceId)

  const appendWorkspaceParam = useCallback(
    (url: string, overrideId?: string | null) =>
      baseAppendWorkspaceParam(url, overrideId ?? workspaceId),
    [workspaceId],
  )

  const withWorkspaceHeaders = useCallback(
    <T extends RequestInit | undefined>(init?: T, overrideId?: string | null): T =>
      baseWithWorkspaceHeaders(init, overrideId ?? workspaceId) as T,
    [workspaceId],
  )

  const withWorkspacePayload = useCallback(
    <T>(payload: T, overrideId?: string | null): T =>
      baseWithWorkspacePayload(payload, overrideId ?? workspaceId),
    [workspaceId],
  )

  const fetchWithWorkspace = useCallback(
    (input: RequestInfo | URL, init?: RequestInit) => fetcher(input, withWorkspaceHeaders(init)),
    [fetcher, withWorkspaceHeaders],
  )

  const resolveWorkspaceId = useCallback(
    (resolvedId?: string | null) => {
      if (resolvedId && resolvedId !== workspaceId) {
        setWorkspaceId(resolvedId)
      }
    },
    [workspaceId],
  )

  return useMemo(
    () => ({
      workspaceId,
      setWorkspaceId,
      appendWorkspaceParam,
      withWorkspaceHeaders,
      withWorkspacePayload,
      fetchWithWorkspace,
      resolveWorkspaceId,
    }),
    [
      appendWorkspaceParam,
      fetchWithWorkspace,
      resolveWorkspaceId,
      withWorkspaceHeaders,
      withWorkspacePayload,
      workspaceId,
    ],
  )
}

