/**
 * Panel Intent Manifest Types
 *
 * Defines the contract for panels to declare their chat capabilities.
 * Each panel ships its own manifest with intents, examples, and handlers.
 */

import type { WidgetPermission } from '@/lib/widgets/sandbox-permissions'

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
 * Sandbox configuration for custom widget code execution
 * Phase 3: Safe Custom Widgets
 */
export interface SandboxConfig {
  /** URL to widget entry point (JS bundle) - must be HTTPS */
  entrypoint: string

  /** Permissions this widget requires */
  permissions: WidgetPermission[]

  /**
   * Allowed network origins for connect-src CSP directive.
   * If empty/omitted, no external network access allowed (connect-src 'none').
   */
  networkAllowlist?: string[]

  /** Minimum container size */
  minSize?: { width: number; height: number }

  /** Preferred container size */
  preferredSize?: { width: number; height: number }
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

  /** Optional description */
  description?: string

  /** List of chat intents this panel supports */
  intents: PanelIntent[]

  /**
   * Optional sandbox configuration for custom widget code.
   * If present, widget runs in isolated iframe with declared permissions.
   * Phase 3: Safe Custom Widgets
   */
  sandbox?: SandboxConfig
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
    name?: string
    subtitle?: string
    meta?: string
    isSelectable?: boolean
    entryId?: string
    workspaceId?: string
    dashboardId?: string
    filePath?: string
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
    // Enforce API-only handlers (per widget-manager-plan.md)
    if (!intent.handler.startsWith('api:')) {
      console.warn(`[PanelManifest] Invalid handler format: ${intent.handler}. Must start with "api:"`)
      return false
    }
    if (!['read', 'write'].includes(intent.permission)) return false
  }

  // Validate sandbox configuration if present (Phase 3: Safe Custom Widgets)
  if (m.sandbox !== undefined) {
    if (!validateSandboxConfig(m.sandbox)) {
      return false
    }
  }

  return true
}

/**
 * Valid widget permissions for sandbox
 */
const VALID_WIDGET_PERMISSIONS = [
  'read:workspace',
  'read:notes',
  'write:workspace',
  'write:notes',
  'write:chat',
  'network:fetch',
]

/**
 * Validate sandbox configuration
 */
export function validateSandboxConfig(sandbox: unknown): sandbox is SandboxConfig {
  if (!sandbox || typeof sandbox !== 'object') {
    console.warn('[PanelManifest] sandbox must be an object')
    return false
  }

  const s = sandbox as Record<string, unknown>

  // entrypoint is required if sandbox is present
  if (!s.entrypoint || typeof s.entrypoint !== 'string') {
    console.warn('[PanelManifest] sandbox.entrypoint is required')
    return false
  }

  // Validate entrypoint is HTTPS URL
  try {
    const url = new URL(s.entrypoint)
    if (url.protocol !== 'https:') {
      console.warn('[PanelManifest] sandbox.entrypoint must be HTTPS')
      return false
    }
  } catch {
    console.warn('[PanelManifest] sandbox.entrypoint must be a valid URL')
    return false
  }

  // Validate permissions array
  if (!Array.isArray(s.permissions)) {
    console.warn('[PanelManifest] sandbox.permissions must be an array')
    return false
  }

  // Validate each permission is known
  for (const perm of s.permissions) {
    if (typeof perm !== 'string' || !VALID_WIDGET_PERMISSIONS.includes(perm)) {
      console.warn(`[PanelManifest] Unknown permission: ${perm}`)
      return false
    }
  }

  // Validate networkAllowlist if present
  if (s.networkAllowlist !== undefined) {
    if (!Array.isArray(s.networkAllowlist)) {
      console.warn('[PanelManifest] sandbox.networkAllowlist must be an array')
      return false
    }
    for (const origin of s.networkAllowlist) {
      if (typeof origin !== 'string') {
        console.warn('[PanelManifest] networkAllowlist entries must be strings')
        return false
      }
      try {
        const url = new URL(origin)
        if (url.protocol !== 'https:') {
          console.warn(`[PanelManifest] networkAllowlist origin must be HTTPS: ${origin}`)
          return false
        }
      } catch {
        console.warn(`[PanelManifest] Invalid networkAllowlist origin: ${origin}`)
        return false
      }
    }
  }

  // Validate minSize if present
  if (s.minSize !== undefined) {
    if (!isValidSize(s.minSize)) {
      console.warn('[PanelManifest] sandbox.minSize must be { width: number, height: number }')
      return false
    }
  }

  // Validate preferredSize if present
  if (s.preferredSize !== undefined) {
    if (!isValidSize(s.preferredSize)) {
      console.warn('[PanelManifest] sandbox.preferredSize must be { width: number, height: number }')
      return false
    }
  }

  return true
}

/**
 * Validate size object
 */
function isValidSize(size: unknown): size is { width: number; height: number } {
  if (!size || typeof size !== 'object') return false
  const s = size as Record<string, unknown>
  return typeof s.width === 'number' && typeof s.height === 'number' &&
         s.width > 0 && s.height > 0
}
