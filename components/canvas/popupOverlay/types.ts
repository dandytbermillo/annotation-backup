import type { PopupState } from '@/lib/rendering/connection-line-adapter'

export type PreviewStatus = 'idle' | 'loading' | 'ready' | 'error'

export interface PreviewEntry {
  activeChildId: string | null
  entries: Record<string, {
    status: PreviewStatus
    content?: unknown
    previewText?: string
    error?: string
    requestedAt?: number
  }>
}

export type PreviewChildEntry = PreviewEntry['entries'][string]

export type PopupChildNode = {
  id: string
  type?: string
  name?: string
  title?: string
  parentId?: string
  icon?: string | null
  color?: string | null
  hasChildren?: boolean
  createdAt?: string
  updatedAt?: string
  path?: string
  level?: number
  children?: PopupChildNode[]
}

export interface PopupData extends PopupState {
  id: string
  folder: any
  folderName?: string
  position: { x: number; y: number }
  canvasPosition: { x: number; y: number }
  parentId?: string
  level: number
  isDragging?: boolean
  isLoading?: boolean
  isHighlighted?: boolean
  closeMode?: 'normal' | 'closing'
  isPinned?: boolean
  width?: number
  height?: number
  sizeMode?: 'default' | 'auto' | 'user'
  moveMode?: 'parent' | 'child'
}
