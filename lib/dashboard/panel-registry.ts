/**
 * Panel Type Registry
 * Part of Dashboard Implementation - Phase 2.1
 *
 * Defines the registry system for panel types used in the dashboard and workspaces.
 * Each panel type has: render component reference, default size, config schema, and persistence behavior.
 */

import type { ComponentType } from 'react'

// Panel type identifiers matching the database schema
export type PanelTypeId = 'note' | 'navigator' | 'recent' | 'continue' | 'quick_capture'

// Panel configuration stored in the database (JSONB column)
export interface PanelConfig {
  content?: string // For note panels
  expandedEntries?: string[] // For navigator panels
  limit?: number // For recent panels
  destinationEntryId?: string // For quick capture panels
  [key: string]: unknown // Allow additional config
}

// Panel data structure from the database
export interface WorkspacePanel {
  id: string
  workspaceId: string
  panelType: PanelTypeId
  title: string | null
  positionX: number
  positionY: number
  width: number
  height: number
  zIndex: number
  config: PanelConfig
  createdAt: Date
  updatedAt: Date
}

// Props that all panel components receive
export interface BasePanelProps {
  panel: WorkspacePanel
  onClose?: () => void
  onConfigChange?: (config: Partial<PanelConfig>) => void
  onNavigate?: (entryId: string, workspaceId: string) => void
  isActive?: boolean
}

// Panel type definition
export interface PanelTypeDefinition {
  id: PanelTypeId
  name: string
  description: string
  icon: string
  defaultSize: { width: number; height: number }
  minSize: { width: number; height: number }
  maxSize: { width: number; height: number }
  defaultConfig: PanelConfig
  // Component is registered separately to avoid circular imports
}

// Registry of all panel types
export const panelTypeRegistry: Record<PanelTypeId, PanelTypeDefinition> = {
  note: {
    id: 'note',
    name: 'Note',
    description: 'Text note with workspace links',
    icon: '📝',
    defaultSize: { width: 320, height: 320 },
    minSize: { width: 200, height: 100 },
    maxSize: { width: 600, height: 800 },
    defaultConfig: { content: '' },
  },
  continue: {
    id: 'continue',
    name: 'Continue',
    description: 'Resume last workspace',
    icon: '▶',
    defaultSize: { width: 320, height: 140 },
    minSize: { width: 280, height: 100 },
    maxSize: { width: 400, height: 200 },
    defaultConfig: {},
  },
  navigator: {
    id: 'navigator',
    name: 'Entry Navigator',
    description: 'Browse entries and workspaces',
    icon: '📁',
    defaultSize: { width: 280, height: 320 },
    minSize: { width: 220, height: 200 },
    maxSize: { width: 400, height: 600 },
    defaultConfig: { expandedEntries: [] },
  },
  recent: {
    id: 'recent',
    name: 'Recent',
    description: 'Recently visited workspaces',
    icon: '🕐',
    defaultSize: { width: 280, height: 220 },
    minSize: { width: 220, height: 150 },
    maxSize: { width: 350, height: 400 },
    defaultConfig: { limit: 10 },
  },
  quick_capture: {
    id: 'quick_capture',
    name: 'Quick Capture',
    description: 'Capture quick notes',
    icon: '✏️',
    defaultSize: { width: 280, height: 180 },
    minSize: { width: 250, height: 150 },
    maxSize: { width: 400, height: 300 },
    defaultConfig: {},
  },
}

// Get panel type definition
export function getPanelType(typeId: PanelTypeId): PanelTypeDefinition | undefined {
  return panelTypeRegistry[typeId]
}

// Get all panel types as array (useful for UI rendering)
export function getAllPanelTypes(): PanelTypeDefinition[] {
  return Object.values(panelTypeRegistry)
}

// Get dashboard-specific panel types (excludes 'note' which is available everywhere)
export function getDashboardPanelTypes(): PanelTypeDefinition[] {
  return Object.values(panelTypeRegistry).filter(
    type => type.id !== 'note'
  )
}

// Check if a panel type is valid
export function isValidPanelType(typeId: string): typeId is PanelTypeId {
  return typeId in panelTypeRegistry
}

// Create default panel data for a given type
export function createDefaultPanel(
  typeId: PanelTypeId,
  workspaceId: string,
  position: { x: number; y: number },
  title?: string
): Omit<WorkspacePanel, 'id' | 'createdAt' | 'updatedAt'> {
  const typeDef = panelTypeRegistry[typeId]
  if (!typeDef) {
    throw new Error(`Unknown panel type: ${typeId}`)
  }

  return {
    workspaceId,
    panelType: typeId,
    title: title ?? typeDef.name,
    positionX: position.x,
    positionY: position.y,
    width: typeDef.defaultSize.width,
    height: typeDef.defaultSize.height,
    zIndex: 0,
    config: { ...typeDef.defaultConfig },
  }
}
