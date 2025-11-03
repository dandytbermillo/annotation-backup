import { isPlainModeActive } from '@/lib/collab-mode'
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
  updatedAt: string | null
  popupCount: number
}

interface ListWorkspaceResponse {
  workspaces: OverlayWorkspaceSummary[]
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

  setWorkspace(workspaceKey: string) {
    ;(this as { workspaceKey: string }).workspaceKey = workspaceKey
  }
}

export function isOverlayPersistenceEnabled(): boolean {
  return isPlainModeActive()
}

export { OVERLAY_LAYOUT_SCHEMA_VERSION } from '@/lib/types/overlay-layout'
export type {
  OverlayCanvasPosition,
  OverlayInspectorState,
  OverlayLayoutPayload,
  OverlayLayoutEnvelope,
  OverlayPopupDescriptor,
} from '@/lib/types/overlay-layout'
