/**
 * Panel Intent Manifest Types
 *
 * Defines the contract for panels to declare their chat capabilities.
 * Each panel ships its own manifest with intents, examples, and handlers.
 */

/**
 * Permission level for panel intents
 * - read: View-only, safe operations
 * - write: Destructive operations, may require confirmation
 */
export type PanelPermission = 'read' | 'write'

/**
 * Parameter schema for intent arguments
 */
export interface PanelParamSchema {
  type: 'string' | 'number' | 'boolean' | 'object' | 'array'
  required?: boolean
  description?: string
  default?: unknown
}

/**
 * Single intent declared by a panel
 */
export interface PanelIntent {
  /** Unique intent name within this panel (e.g., "list_tasks", "show_recents") */
  name: string

  /** Human-readable description for LLM context */
  description: string

  /** Example phrases that should trigger this intent */
  examples: string[]

  /** Schema for parameters this intent accepts */
  paramsSchema?: Record<string, PanelParamSchema>

  /** API handler path (e.g., "api:/api/panels/recent/list") */
  handler: string

  /** Permission level required */
  permission: PanelPermission
}

/**
 * Full manifest for a panel's chat capabilities
 */
export interface PanelChatManifest {
  /** Unique panel identifier (e.g., "recent", "quick-links-a", "taskboard") */
  panelId: string

  /** Panel type category (e.g., "recent", "quick-links", "custom") */
  panelType: string

  /** Human-readable title (e.g., "Recent Items", "Quick Links A") */
  title: string

  /** Manifest version for compatibility checking */
  version: string

  /** List of chat intents this panel supports */
  intents: PanelIntent[]
}

/**
 * Args structure for panel_intent (what LLM returns)
 */
export interface PanelIntentArgs {
  /** Target panel ID */
  panelId: string

  /** Intent name within the panel */
  intentName: string

  /** Parameters for the intent */
  params: Record<string, unknown>
}

/**
 * Result from executing a panel intent handler
 */
export interface PanelIntentResult {
  success: boolean
  message?: string
  error?: string

  // For list-type results
  items?: Array<{
    id: string
    type: string
    title?: string
    subtitle?: string
    url?: string
    data?: Record<string, unknown>
  }>
  title?: string
  subtitle?: string
  showInViewPanel?: boolean
  totalCount?: number

  // For navigation results
  navigateTo?: {
    type: 'workspace' | 'entry'
    id: string
    name: string
    entryId?: string
    entryName?: string
    parentId?: string
    parentName?: string
  }

  // For URL opening
  openUrl?: string

  // Legacy view panel content (for compatibility)
  viewPanelContent?: {
    type: 'list' | 'text' | 'pdf' | 'html'
    title: string
    items?: Array<{
      id: string
      label: string
      sublabel?: string
      type?: string
      href?: string
    }>
    content?: string
  }
  previewItems?: Array<{
    id: string
    label: string
    sublabel?: string
  }>
}

/**
 * Supported manifest versions
 */
export const SUPPORTED_MANIFEST_VERSIONS = ['1.0']

/**
 * Validate a panel manifest
 */
export function validateManifest(manifest: unknown): manifest is PanelChatManifest {
  if (!manifest || typeof manifest !== 'object') return false

  const m = manifest as Record<string, unknown>

  // Check required fields
  if (typeof m.panelId !== 'string' || !m.panelId) return false
  if (typeof m.panelType !== 'string' || !m.panelType) return false
  if (typeof m.title !== 'string' || !m.title) return false
  if (typeof m.version !== 'string' || !m.version) return false
  if (!Array.isArray(m.intents)) return false

  // Check version compatibility
  if (!SUPPORTED_MANIFEST_VERSIONS.includes(m.version)) {
    console.warn(`[PanelManifest] Unsupported version: ${m.version}`)
    return false
  }

  // Validate each intent
  for (const intent of m.intents) {
    if (typeof intent.name !== 'string' || !intent.name) return false
    if (typeof intent.description !== 'string') return false
    if (!Array.isArray(intent.examples)) return false
    if (typeof intent.handler !== 'string' || !intent.handler) return false
    if (!['read', 'write'].includes(intent.permission)) return false
  }

  return true
}
