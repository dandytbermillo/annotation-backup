/**
 * Panel Type Registry
 * Part of Dashboard Implementation - Phase 2.1
 *
 * Defines the registry system for panel types used in the dashboard and workspaces.
 * Each panel type has: render component reference, default size, config schema, and persistence behavior.
 *
 * Panel sizes are aligned to a grid system for consistent snap-to-grid positioning.
 */

import type { ComponentType } from 'react'
import { PANEL_SIZES, type PanelSizeKey } from './grid-snap'

// Panel type identifiers matching the database schema
export type PanelTypeId = 'note' | 'navigator' | 'recent' | 'continue' | 'quick_capture' | 'links_note' | 'links_note_tiptap' | 'category' | 'category_navigator' | 'demo' | 'widget_manager' | 'sandbox_widget'

// Deleted link stored in Quick Links panel trash
export interface DeletedLink {
  text: string
  workspaceId: string
  workspaceName: string
  entryId: string
  entryName: string
  dashboardId?: string
  deletedAt: string // ISO timestamp
}

// Panel configuration stored in the database (JSONB column)
export interface PanelConfig {
  content?: string // For note panels
  expandedEntries?: string[] // For navigator panels
  limit?: number // For recent panels
  destinationEntryId?: string // For quick capture panels
  // Category panel config
  categoryIcon?: string // Emoji icon for category
  entryIds?: string[] // Ordered list of entry IDs in this category
  categoryVisible?: boolean // Whether category panel is visible on canvas
  // Category navigator config
  expandedCategories?: string[] // Expanded category panel IDs in navigator
  // Quick Links panel config
  deletedLinks?: DeletedLink[] // Soft-deleted links (trash)
  [key: string]: unknown // Allow additional config
}

// Category panel data structure (for category navigator to read all categories)
export interface CategoryPanelData {
  panelId: string
  title: string
  icon: string
  entryIds: string[]
  visible: boolean
  position: { x: number; y: number }
}

// Entry reference for category navigation
export interface CategoryEntryReference {
  entryId: string
  entryName: string
  workspaces: CategoryWorkspaceReference[]
  categoryPanelId: string | null
}

export interface CategoryWorkspaceReference {
  workspaceId: string
  workspaceName: string
  isDefault: boolean
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
  badge: string | null // Single-letter badge (A-Z) for links_note panels
  isVisible: boolean // Whether the panel is visible on dashboard (false = hidden by user)
  deletedAt: Date | null // Timestamp when moved to trash (null = not deleted)
  createdAt: Date
  updatedAt: Date
}

// Props that all panel components receive
export interface BasePanelProps {
  panel: WorkspacePanel
  onClose?: () => void
  onConfigChange?: (config: Partial<PanelConfig>) => void
  onTitleChange?: (newTitle: string) => void
  onNavigate?: (entryId: string, workspaceId: string) => void
  onOpenWorkspace?: (workspaceId: string) => void // Open workspace within dashboard (for internal links)
  onDelete?: () => void // Soft delete - moves to trash
  isActive?: boolean
}

// Panel type definition
export interface PanelTypeDefinition {
  id: PanelTypeId
  name: string
  description: string
  icon: string
  /** Default grid size key for this panel type */
  defaultGridSize: PanelSizeKey
  defaultSize: { width: number; height: number }
  minSize: { width: number; height: number }
  maxSize: { width: number; height: number }
  defaultConfig: PanelConfig
  // Component is registered separately to avoid circular imports
}

// Registry of all panel types with grid-aligned sizes
// Sizes: small=154×154, medium=324×154, tall=154×324, large=324×324, wide=494×154, xlarge=494×324
export const panelTypeRegistry: Record<PanelTypeId, PanelTypeDefinition> = {
  note: {
    id: 'note',
    name: 'Note',
    description: 'Text note with workspace links',
    icon: '📝',
    defaultGridSize: 'large',
    defaultSize: { width: PANEL_SIZES.large.width, height: PANEL_SIZES.large.height },
    minSize: { width: PANEL_SIZES.small.width, height: PANEL_SIZES.small.height },
    maxSize: { width: PANEL_SIZES.xlarge.width, height: PANEL_SIZES.xlarge.height },
    defaultConfig: { content: '' },
  },
  continue: {
    id: 'continue',
    name: 'Continue',
    description: 'Resume last workspace',
    icon: '▶',
    defaultGridSize: 'medium',
    defaultSize: { width: PANEL_SIZES.medium.width, height: PANEL_SIZES.medium.height },
    minSize: { width: PANEL_SIZES.medium.width, height: PANEL_SIZES.small.height },
    maxSize: { width: PANEL_SIZES.wide.width, height: PANEL_SIZES.medium.height },
    defaultConfig: {},
  },
  navigator: {
    id: 'navigator',
    name: 'Entry Navigator',
    description: 'Browse entries and workspaces',
    icon: '📁',
    defaultGridSize: 'tall',
    defaultSize: { width: PANEL_SIZES.tall.width, height: PANEL_SIZES.tall.height },
    minSize: { width: PANEL_SIZES.small.width, height: PANEL_SIZES.medium.height },
    maxSize: { width: PANEL_SIZES.large.width, height: PANEL_SIZES.xlarge.height },
    defaultConfig: { expandedEntries: [] },
  },
  recent: {
    id: 'recent',
    name: 'Recent',
    description: 'Recently visited workspaces',
    icon: '🕐',
    defaultGridSize: 'medium',
    defaultSize: { width: PANEL_SIZES.medium.width, height: PANEL_SIZES.medium.height },
    minSize: { width: PANEL_SIZES.small.width, height: PANEL_SIZES.small.height },
    maxSize: { width: PANEL_SIZES.large.width, height: PANEL_SIZES.large.height },
    defaultConfig: { limit: 10 },
  },
  quick_capture: {
    id: 'quick_capture',
    name: 'Quick Capture',
    description: 'Capture quick notes',
    icon: '✏️',
    defaultGridSize: 'medium',
    defaultSize: { width: PANEL_SIZES.medium.width, height: PANEL_SIZES.medium.height },
    minSize: { width: PANEL_SIZES.medium.width, height: PANEL_SIZES.small.height },
    maxSize: { width: PANEL_SIZES.wide.width, height: PANEL_SIZES.large.height },
    defaultConfig: {},
  },
  links_note: {
    id: 'links_note',
    name: 'Links Panel',
    description: 'Panel with workspace links',
    icon: '🔗',
    defaultGridSize: 'large',
    defaultSize: { width: PANEL_SIZES.large.width, height: PANEL_SIZES.large.height },
    minSize: { width: PANEL_SIZES.medium.width, height: PANEL_SIZES.medium.height },
    maxSize: { width: PANEL_SIZES.xlarge.width, height: PANEL_SIZES.xlarge.height },
    defaultConfig: { content: '' },
  },
  links_note_tiptap: {
    id: 'links_note_tiptap',
    name: 'Links Panel',
    description: 'Panel with workspace links using TipTap editor',
    icon: '🔗',
    defaultGridSize: 'large',
    defaultSize: { width: PANEL_SIZES.large.width, height: PANEL_SIZES.large.height },
    minSize: { width: PANEL_SIZES.medium.width, height: PANEL_SIZES.medium.height },
    maxSize: { width: PANEL_SIZES.xlarge.width, height: PANEL_SIZES.xlarge.height },
    defaultConfig: { content: '' },
  },
  category: {
    id: 'category',
    name: 'Category',
    description: 'Organize entries by category',
    icon: '📂',
    defaultGridSize: 'large',
    defaultSize: { width: PANEL_SIZES.large.width, height: PANEL_SIZES.large.height },
    minSize: { width: PANEL_SIZES.small.width, height: PANEL_SIZES.small.height },
    maxSize: { width: PANEL_SIZES.xlarge.width, height: PANEL_SIZES.xlarge.height },
    defaultConfig: { categoryIcon: '📂', entryIds: [], categoryVisible: true },
  },
  category_navigator: {
    id: 'category_navigator',
    name: 'Links Overview',
    description: 'View all links from Quick Links panels',
    icon: '🔗',
    defaultGridSize: 'tall',
    defaultSize: { width: PANEL_SIZES.tall.width, height: PANEL_SIZES.tall.height },
    minSize: { width: PANEL_SIZES.small.width, height: PANEL_SIZES.tall.height },
    maxSize: { width: PANEL_SIZES.large.width, height: PANEL_SIZES.xlarge.height },
    defaultConfig: { expandedPanels: [] },
  },
  demo: {
    id: 'demo',
    name: 'Demo Widget',
    description: 'Example third-party widget for testing chat integration',
    icon: '✨',
    defaultGridSize: 'medium',
    defaultSize: { width: PANEL_SIZES.medium.width, height: PANEL_SIZES.medium.height },
    minSize: { width: PANEL_SIZES.small.width, height: PANEL_SIZES.small.height },
    maxSize: { width: PANEL_SIZES.large.width, height: PANEL_SIZES.large.height },
    defaultConfig: {},
  },
  widget_manager: {
    id: 'widget_manager',
    name: 'Widget Manager',
    description: 'Manage installed widgets and their chat integration',
    icon: '⚙️',
    defaultGridSize: 'tall',
    defaultSize: { width: PANEL_SIZES.tall.width, height: PANEL_SIZES.tall.height },
    minSize: { width: PANEL_SIZES.small.width, height: PANEL_SIZES.medium.height },
    maxSize: { width: PANEL_SIZES.large.width, height: PANEL_SIZES.xlarge.height },
    defaultConfig: {},
  },
  sandbox_widget: {
    id: 'sandbox_widget',
    name: 'Sandboxed Widget',
    description: 'Third-party widget running in sandboxed iframe',
    icon: '📦',
    defaultGridSize: 'medium',
    defaultSize: { width: PANEL_SIZES.medium.width, height: PANEL_SIZES.medium.height },
    minSize: { width: PANEL_SIZES.small.width, height: PANEL_SIZES.small.height },
    maxSize: { width: PANEL_SIZES.xlarge.width, height: PANEL_SIZES.xlarge.height },
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
// Also respects the NEXT_PUBLIC_CATEGORY_PANELS feature flag
export function getDashboardPanelTypes(): PanelTypeDefinition[] {
  const categoryPanelsEnabled = typeof window !== 'undefined'
    ? process.env.NEXT_PUBLIC_CATEGORY_PANELS === '1'
    : true // Enable by default on server

  return Object.values(panelTypeRegistry).filter(type => {
    // Exclude 'note' type (uses existing note panel system)
    if (type.id === 'note') return false

    // Filter category panels based on feature flag
    if ((type.id === 'category' || type.id === 'category_navigator') && !categoryPanelsEnabled) {
      return false
    }

    return true
  })
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
    badge: null, // Badge is auto-assigned by the API for links_note panels
    isVisible: true, // New panels are always visible
    deletedAt: null, // New panels are not in trash
  }
}
