import { FOLDER_COLORS } from './constants'
import type { PopupChildNode } from './types'

type NullableString = string | null | undefined

export const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

export const getFolderColorTheme = (colorName: NullableString) => {
  if (!colorName) return null
  return FOLDER_COLORS.find((color) => color.name === colorName) || null
}

export const parseBreadcrumb = (path: NullableString, currentName: string): string[] => {
  if (!path) return [currentName]

  const parts = path.split('/').filter((part) => part.trim())
  if (parts.length === 0) return [currentName]

  const breadcrumbs = parts
    .filter((part) => part !== 'knowledge-base')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))

  if (currentName?.trim() && breadcrumbs.length > 0) {
    breadcrumbs[breadcrumbs.length - 1] = currentName.trim()
  }

  return breadcrumbs
}

export const formatRelativeTime = (timestamp?: string) => {
  if (!timestamp) return ''

  const now = new Date()
  const date = new Date(timestamp)
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / (1000 * 60))
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60))
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))
  const diffMonths = Math.floor(diffDays / 30)
  const diffYears = Math.floor(diffDays / 365)

  if (diffMins < 1) return 'now'
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays < 30) return `${diffDays}d ago`
  if (diffMonths < 12) return `${diffMonths}mo ago`
  return `${diffYears}y ago`
}

export const isFolderNode = (node: PopupChildNode | null | undefined): boolean => {
  if (!node || !node.type) return false
  return node.type.toLowerCase() === 'folder'
}

export const isNoteLikeNode = (node: PopupChildNode | null | undefined): boolean => {
  if (!node) return false
  return !isFolderNode(node)
}
