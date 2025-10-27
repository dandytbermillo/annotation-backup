/**
 * Annotation model for Option A (offline, single-user mode)
 * 
 * Defines the structure for annotations that work without Yjs.
 * Compatible with future Yjs integration.
 * 
 * @module lib/models/annotation
 */

import type { PlainAnchor } from '../utils/text-anchoring'
import { DEFAULT_PANEL_DIMENSIONS } from '../canvas/panel-metrics'

/**
 * Annotation Type
 *
 * Changed from literal union to string for extensibility.
 * System now supports custom annotation types from database.
 *
 * @deprecated Direct usage of hardcoded types is deprecated.
 * Use AnnotationTypeConfig from registry instead.
 */
export type AnnotationType = string

export interface PlainAnnotation {
  id: string
  type: AnnotationType
  anchors: PlainAnchor[]
  anchors_fallback: PlainAnchor[]  // For resilience
  noteId: string
  parentPanelId: string
  childPanelId?: string
  metadata: {
    color?: string
    originalText?: string
    createdBy?: string
    [key: string]: any
  }
  created_at: Date
  updated_at: Date
  version: number
}

export interface AnnotationBranch {
  id: string
  noteId: string
  parentId: string
  type: AnnotationType
  title: string
  content: string  // HTML or ProseMirror JSON as string
  originalText: string
  metadata: Record<string, any>
  branches: string[]  // Child branch IDs
  position: { x: number; y: number }
  dimensions?: { width: number; height: number }  // Panel dimensions for resize feature
  isEditable: boolean
  created_at: Date
  updated_at: Date
}

export interface AnnotationConnection {
  id: string
  fromPanelId: string
  toPanelId: string
  type: AnnotationType
  metadata?: {
    color?: string
    curved?: boolean
    [key: string]: any
  }
}

/**
 * Get color for annotation type
 *
 * @deprecated Use registry.getById(type)?.color instead
 * This function provides fallback for backward compatibility only
 */
export function getAnnotationColor(type: AnnotationType): string {
  switch (type) {
    case 'note':
      return '#3498db' // Blue
    case 'explore':
      return '#f39c12' // Orange
    case 'promote':
      return '#27ae60' // Green
    default:
      return '#95a5a6' // Gray fallback
  }
}

/**
 * Get gradient for annotation type
 *
 * @deprecated Use registry.getById(type)?.gradient instead
 * This function provides fallback for backward compatibility only
 */
export function getAnnotationGradient(type: AnnotationType): string {
  switch (type) {
    case 'note':
      return 'linear-gradient(135deg, #3498db 0%, #2980b9 100%)'
    case 'explore':
      return 'linear-gradient(135deg, #f39c12 0%, #e67e22 100%)'
    case 'promote':
      return 'linear-gradient(135deg, #27ae60 0%, #229954 100%)'
    default:
      return 'linear-gradient(135deg, #95a5a6 0%, #7f8c8d 100%)'
  }
}

/**
 * Get icon for annotation type
 *
 * @deprecated Use registry.getById(type)?.icon instead
 * This function provides fallback for backward compatibility only
 */
export function getAnnotationIcon(type: AnnotationType): string {
  switch (type) {
    case 'note':
      return '📝'
    case 'explore':
      return '🔍'
    case 'promote':
      return '⭐'
    default:
      return '📌'
  }
}

/**
 * Get default panel width based on annotation type
 */
export function getDefaultPanelWidth(type: 'note' | 'explore' | 'promote' | 'main'): number {
  switch(type) {
    case 'note': return 380      // Compact - quick references
    case 'explore': return 500   // Standard - investigation
    case 'promote': return 550   // Prominent - important findings
    case 'main': return 600      // Primary document
    default: return 500
  }
}

/**
 * Get annotation type color for visual differentiation
 */
export function getAnnotationTypeColor(type: string): string {
  switch(type) {
    case 'note': return '#3498db'      // Blue
    case 'explore': return '#f39c12'   // Orange
    case 'promote': return '#27ae60'   // Green
    default: return '#999999'          // Gray fallback
  }
}

/**
 * Create default branch data
 */
export function createAnnotationBranch(
  type: AnnotationType,
  parentId: string,
  noteId: string,
  selectedText: string,
  position: { x: number; y: number }
): Omit<AnnotationBranch, 'id' | 'created_at' | 'updated_at'> {
  const truncatedText = selectedText.length > 50
    ? selectedText.substring(0, 50) + '...'
    : selectedText

  return {
    noteId,
    parentId,
    type,
    title: truncatedText,
    content: selectedText.trim()
      ? `<blockquote><p>${selectedText}</p></blockquote>`
      : `<blockquote><p></p></blockquote>`,
    originalText: selectedText,
    metadata: {
      annotationType: type,
      color: getAnnotationColor(type),
      typeHistory: [{
        type,
        changedAt: new Date().toISOString(),
        reason: 'initial'
      }]
    },
    branches: [],
    position,
    dimensions: {
      width: DEFAULT_PANEL_DIMENSIONS.width,
      height: DEFAULT_PANEL_DIMENSIONS.height
    },
    isEditable: true
  }
}
