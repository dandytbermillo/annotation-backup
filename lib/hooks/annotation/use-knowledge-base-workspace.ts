import { useEffect, useMemo, useRef, useState } from "react"
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
  const STORAGE_KEY = "kb-workspace-id"
  const [workspaceId, setWorkspaceId] = useState<string | null>(() => {
    if (initialWorkspaceId) return initialWorkspaceId
    if (typeof window === "undefined") return null
    try {
      const cached = window.localStorage.getItem(STORAGE_KEY)
      if (cached && cached.trim().length > 0) {
        return cached
      }
    } catch {
      // ignore
    }
    return null
  })
  const discoveryRef = useRef<Promise<string | null> | null>(null)

  useEffect(() => {
    if (workspaceId) return
    if (discoveryRef.current) return

    let cancelled = false

    const discoverWorkspace = async () => {
      try {
        const response = await fetcher("/api/items?parentId=null", { cache: "no-store" })
        if (!response.ok) return null
        const data = await response.json().catch(() => null)
        const nextWorkspaceId =
          data && typeof data.workspaceId === "string" && data.workspaceId.length > 0
            ? data.workspaceId
            : null
        if (!cancelled && nextWorkspaceId) {
          setWorkspaceId(nextWorkspaceId)
        }
        return nextWorkspaceId
      } catch (error) {
        console.warn("[useKnowledgeBaseWorkspace] Failed to auto-resolve workspace", error)
        return null
      } finally {
        discoveryRef.current = null
      }
    }

    discoveryRef.current = discoverWorkspace()

    return () => {
      cancelled = true
    }
  }, [fetcher, workspaceId])

  useEffect(() => {
    if (typeof window === "undefined") return
    if (!workspaceId) return
    try {
      window.localStorage.setItem(STORAGE_KEY, workspaceId)
    } catch {
      // ignore storage errors
    }
  }, [workspaceId])

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
