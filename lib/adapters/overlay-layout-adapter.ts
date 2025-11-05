import { isPlainModeActive } from '@/lib/collab-mode'
import { debugLog } from '@/lib/utils/debug-logger'
import {
  OVERLAY_LAYOUT_SCHEMA_VERSION,
  OverlayLayoutEnvelope,
  OverlayLayoutPayload,
} from '@/lib/types/overlay-layout'

const DEFAULT_WORKSPACE_KEY = 'default'
const DEFAULT_LAYOUT_BASE_URL = '/api/overlay/layout'
const DEFAULT_WORKSPACES_BASE_URL = '/api/overlay/workspaces'

const ensureOverlayPositions = (layout: OverlayLayoutPayload): OverlayLayoutPayload => ({
  ...layout,
  popups: layout.popups.map(popup => ({
    ...popup,
    overlayPosition: popup.overlayPosition || popup.canvasPosition,
  })),
})

export interface OverlayWorkspaceSummary {
  id: string
  name: string
  isDefault: boolean
  updatedAt: string | null
  popupCount: number
}

interface ListWorkspaceResponse {
  workspaces: OverlayWorkspaceSummary[]
  nextWorkspaceName?: string
}

interface CreateWorkspaceResponse {
  workspace: OverlayWorkspaceSummary
  envelope: OverlayLayoutEnvelope
}

export class OverlayLayoutConflictError extends Error {
  constructor(
    public readonly payload: OverlayLayoutEnvelope
  ) {
    super('Overlay layout revision conflict')
    this.name = 'OverlayLayoutConflictError'
  }
}

export interface LoadLayoutParams {
  userId?: string
}

export interface SaveLayoutParams {
  layout: OverlayLayoutPayload
  version: string
  revision?: string | null
  userId?: string
}

export class OverlayLayoutAdapter {
  private readonly workspaceKey: string
  private readonly baseUrl: string
  private readonly workspacesBaseUrl: string
  private readonly debugConflictsEnabled: boolean

  constructor({
    workspaceKey = DEFAULT_WORKSPACE_KEY,
    baseUrl = DEFAULT_LAYOUT_BASE_URL,
    workspacesBaseUrl = DEFAULT_WORKSPACES_BASE_URL,
  }: {
    workspaceKey?: string
    baseUrl?: string
    workspacesBaseUrl?: string
  } = {}) {
    this.workspaceKey = workspaceKey
    this.baseUrl = baseUrl
    this.workspacesBaseUrl = workspacesBaseUrl
    this.debugConflictsEnabled = process.env.NEXT_PUBLIC_DEBUG_POPUP_CONFLICTS === 'true'
  }

  private buildUrl(userId?: string): string {
    const base = `${this.baseUrl}/${encodeURIComponent(this.workspaceKey)}`
    if (!userId) return base
    const params = new URLSearchParams({ userId })
    return `${base}?${params.toString()}`
  }

  async loadLayout({ userId }: LoadLayoutParams = {}): Promise<OverlayLayoutEnvelope | null> {
    const response = await fetch(this.buildUrl(userId), {
      method: 'GET',
      cache: 'no-store',
    })

    if (response.status === 404) {
      return null
    }

    if (!response.ok) {
      throw new Error(`Failed to load overlay layout: ${response.statusText}`)
    }

    const data = await response.json()
    return data as OverlayLayoutEnvelope
  }

  async saveLayout({
    layout,
    version,
    revision,
    userId,
  }: SaveLayoutParams): Promise<OverlayLayoutEnvelope> {
    const enrichedLayout = ensureOverlayPositions(layout)

    const response = await fetch(this.buildUrl(userId), {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      cache: 'no-store',
      body: JSON.stringify({
        layout: enrichedLayout,
        version,
        revision,
      }),
    })

    if (response.status === 409) {
      const payload = (await response.json()) as OverlayLayoutEnvelope
      if (this.debugConflictsEnabled) {
        await debugLog({
          component: 'PopupOverlay',
          action: 'overlay_layout_conflict',
          metadata: {
            workspaceKey: this.workspaceKey,
            requestVersion: version,
            requestRevision: revision ?? null,
            popupCount: enrichedLayout.popups.length,
            serverVersion: payload.version,
            serverRevision: payload.revision ?? null,
            serverPopups: payload.layout?.popups?.length ?? null,
            mode: isPlainModeActive() ? 'plain' : 'collab'
          }
        })
      }
      throw new OverlayLayoutConflictError(payload)
    }

    if (!response.ok) {
      throw new Error(`Failed to save overlay layout: ${response.statusText}`)
    }

    const data = await response.json()
    return data as OverlayLayoutEnvelope
  }

  static async listWorkspaces({
    baseUrl = DEFAULT_WORKSPACES_BASE_URL,
    userId,
  }: { baseUrl?: string; userId?: string } = {}): Promise<OverlayWorkspaceSummary[]> {
    const url = userId ? `${baseUrl}?userId=${encodeURIComponent(userId)}` : baseUrl
    const response = await fetch(url, { method: 'GET', cache: 'no-store' })
    if (!response.ok) {
      throw new Error(`Failed to list overlay workspaces: ${response.statusText}`)
    }

    const data = (await response.json()) as ListWorkspaceResponse
    return data.workspaces
  }

  static async createWorkspace({
    layout,
    version,
    nameHint,
    userId,
    baseUrl = DEFAULT_WORKSPACES_BASE_URL,
  }: {
    layout: OverlayLayoutPayload
    version: string
    nameHint?: string
    userId?: string | null
    baseUrl?: string
  }): Promise<CreateWorkspaceResponse> {
    const enrichedLayout = ensureOverlayPositions(layout)
    const payload = {
      layout: enrichedLayout,
      version,
      nameHint,
    }

    const url = userId ? `${baseUrl}?userId=${encodeURIComponent(userId)}` : baseUrl
    const response = await fetch(url, {
      method: 'POST',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })

    if (!response.ok) {
      throw new Error(`Failed to create overlay workspace: ${response.statusText}`)
    }

    const data = (await response.json()) as CreateWorkspaceResponse
    return data
  }

  static async deleteWorkspace({
    workspaceId,
    userId,
    baseUrl = DEFAULT_WORKSPACES_BASE_URL,
  }: {
    workspaceId: string
    userId?: string | null
    baseUrl?: string
  }): Promise<void> {
    const target = `${baseUrl}/${encodeURIComponent(workspaceId)}`
    const url = userId ? `${target}?userId=${encodeURIComponent(userId)}` : target
    const response = await fetch(url, {
      method: 'DELETE',
      cache: 'no-store',
    })

    if (!response.ok) {
      let detail: string | undefined
      try {
        const payload = (await response.json()) as { error?: string }
        if (payload && typeof payload.error === 'string') {
          detail = payload.error
        }
      } catch {
        // Ignore JSON parsing errors; fall back to status text
      }
      throw new Error(
        `Failed to delete overlay workspace: ${detail ?? response.statusText}`
      )
    }
  }

}

export function isOverlayPersistenceEnabled(): boolean {
  if (isPlainModeActive()) return true

  if (typeof window !== 'undefined') {
    // Surface a warning once so teams know persistence is still running in collaborative mode.
    const key = '__OVERLAY_PERSIST_WARNED__'
    const globalAny = window as unknown as Record<string, unknown>
    if (!globalAny[key]) {
      console.warn(
        '[overlay-layout-adapter] Overlay persistence is active outside plain mode; ensure this is intentional.'
      )
      globalAny[key] = true
    }
  } else {
    console.warn(
      '[overlay-layout-adapter] Overlay persistence is active outside plain mode (server render).'
    )
  }

  return true
}

export { OVERLAY_LAYOUT_SCHEMA_VERSION } from '@/lib/types/overlay-layout'
export type {
  OverlayCanvasPosition,
  OverlayInspectorState,
  OverlayLayoutPayload,
  OverlayLayoutEnvelope,
  OverlayPopupDescriptor,
} from '@/lib/types/overlay-layout'
