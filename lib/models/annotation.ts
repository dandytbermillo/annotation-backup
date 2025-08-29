/**
 * Annotation model for Option A (offline, single-user mode)
 * 
 * Defines the structure for annotations that work without Yjs.
 * Compatible with future Yjs integration.
 * 
 * @module lib/models/annotation
 */

import type { PlainAnchor } from '../utils/text-anchoring'

export interface PlainAnnotation {
  id: string
  type: 'note' | 'explore' | 'promote'
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
  type: 'note' | 'explore' | 'promote'
  title: string
  content: string  // HTML or ProseMirror JSON as string
  originalText: string
  metadata: Record<string, any>
  branches: string[]  // Child branch IDs
  position: { x: number; y: number }
  isEditable: boolean
  created_at: Date
  updated_at: Date
}

export interface AnnotationConnection {
  id: string
  fromPanelId: string
  toPanelId: string
  type: 'note' | 'explore' | 'promote'
  metadata?: {
    color?: string
    curved?: boolean
    [key: string]: any
  }
}

/**
 * Get color for annotation type
 */
export function getAnnotationColor(type: 'note' | 'explore' | 'promote'): string {
  switch (type) {
    case 'note':
      return '#3498db' // Blue
    case 'explore':
      return '#f39c12' // Orange
    case 'promote':
      return '#27ae60' // Green
    default:
      return '#95a5a6' // Gray
  }
}

/**
 * Get gradient for annotation type
 */
export function getAnnotationGradient(type: 'note' | 'explore' | 'promote'): string {
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
 */
export function getAnnotationIcon(type: 'note' | 'explore' | 'promote'): string {
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
 * Create default branch data
 */
export function createAnnotationBranch(
  type: 'note' | 'explore' | 'promote',
  parentId: string,
  noteId: string,
  selectedText: string,
  position: { x: number; y: number }
): Omit<AnnotationBranch, 'id' | 'created_at' | 'updated_at'> {
  const truncatedText = selectedText.length > 30 
    ? selectedText.substring(0, 30) + '...' 
    : selectedText
    
  return {
    noteId,
    parentId,
    type,
    title: `${type.charAt(0).toUpperCase() + type.slice(1)} on "${truncatedText}"`,
    content: `<blockquote><p>${selectedText}</p></blockquote><p>Start writing your ${type} here...</p>`,
    originalText: selectedText,
    metadata: {
      annotationType: type,
      color: getAnnotationColor(type)
    },
    branches: [],
    position,
    isEditable: true
  }
}