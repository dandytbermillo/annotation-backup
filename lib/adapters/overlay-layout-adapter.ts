import { isPlainModeActive } from '@/lib/collab-mode'
import {
  OVERLAY_LAYOUT_SCHEMA_VERSION,
  OverlayLayoutEnvelope,
  OverlayLayoutPayload,
} from '@/lib/types/overlay-layout'

const DEFAULT_WORKSPACE_KEY = 'default'

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

  constructor({
    workspaceKey = DEFAULT_WORKSPACE_KEY,
    baseUrl = '/api/overlay/layout',
  }: {
    workspaceKey?: string
    baseUrl?: string
  } = {}) {
    this.workspaceKey = workspaceKey
    this.baseUrl = baseUrl
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
    // Ensure both canvasPosition and overlayPosition are saved (backfill if missing)
    const enrichedLayout: OverlayLayoutPayload = {
      ...layout,
      popups: layout.popups.map(popup => ({
        ...popup,
        overlayPosition: popup.overlayPosition || popup.canvasPosition
      }))
    }

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
