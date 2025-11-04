import { CoordinateBridge } from '@/lib/utils/coordinate-bridge'
import {
  OVERLAY_LAYOUT_SCHEMA_VERSION,
  type OverlayLayoutPayload,
} from '@/lib/types/overlay-layout'

const DEFAULT_POPUP_WIDTH = 300
const DEFAULT_POPUP_HEIGHT = 400

export interface OverlayViewportTransform {
  x: number
  y: number
  scale: number
}

export interface HydratedOrgItem {
  id: string
  name: string
  type: 'folder' | 'note'
  level: number
  color?: string
  path?: string
  parentId?: string
  children?: HydratedOrgItem[]
}

export interface HydratedOverlayPopup {
  id: string
  folderId: string
  folderName: string
  folder: HydratedOrgItem | null
  position: { x: number; y: number }
  canvasPosition: { x: number; y: number }
  width: number
  height: number
  children: HydratedOrgItem[]
  isLoading: boolean
  isPersistent: boolean
  level: number
  parentPopupId?: string
}

export interface HydratedOverlayLayout {
  popups: HydratedOverlayPopup[]
  hash: string
}

export function buildHydratedOverlayLayout(
  layout: OverlayLayoutPayload,
  transform: OverlayViewportTransform
): HydratedOverlayLayout {
  const sanitizedPopups = Array.isArray(layout.popups) ? layout.popups : []
  const hash = JSON.stringify({
    schemaVersion: layout.schemaVersion || OVERLAY_LAYOUT_SCHEMA_VERSION,
    popups: sanitizedPopups,
    inspectors: [],
  })

  if (sanitizedPopups.length === 0) {
    console.log('[Layout Restoration] No saved popups, clearing overlay popups')
    return { popups: [], hash }
  }

  const restoredPopups: HydratedOverlayPopup[] = sanitizedPopups.map(descriptor => {
    const screenPosition = CoordinateBridge.canvasToScreen(descriptor.canvasPosition, transform)
    const displayName = descriptor.folderName?.trim() || 'Untitled Folder'
    const width = Number.isFinite(descriptor.width) ? (descriptor.width as number) : DEFAULT_POPUP_WIDTH
    const height = Number.isFinite(descriptor.height) ? (descriptor.height as number) : DEFAULT_POPUP_HEIGHT

    console.log('[Restore] Descriptor for', displayName, ':', {
      folderId: descriptor.folderId,
      folderColor: descriptor.folderColor,
      parentId: descriptor.parentId,
    })

    const restoredPopup: HydratedOverlayPopup = {
      id: descriptor.id,
      folderId: descriptor.folderId || '',
      folderName: displayName,
      folder: descriptor.folderId
        ? {
            id: descriptor.folderId,
            name: displayName,
            type: 'folder',
            level: descriptor.level || 0,
            color: descriptor.folderColor || undefined,
            children: [],
          }
        : null,
      position: screenPosition,
      canvasPosition: descriptor.canvasPosition,
      width,
      height,
      children: [],
      isLoading: Boolean(descriptor.folderId),
      isPersistent: true,
      level: descriptor.level || 0,
      parentPopupId: descriptor.parentId || undefined,
    }

    console.log('[Restore] Initial popup.folder.color for', displayName, ':', restoredPopup.folder?.color)

    return restoredPopup
  })

  return { popups: restoredPopups, hash }
}
