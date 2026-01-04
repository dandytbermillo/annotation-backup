/**
 * Widget Sandbox Permissions
 * Phase 3: Safe Custom Widgets
 *
 * Defines permission types and checking logic for sandboxed widgets.
 */

// =============================================================================
// Permission Types
// =============================================================================

export type WidgetPermission =
  | 'read:workspace'   // Read workspace/panel state
  | 'read:notes'       // Read note content
  | 'write:workspace'  // Modify panels (requires approval)
  | 'write:notes'      // Modify notes (requires approval)
  | 'write:chat'       // Send chat messages (requires approval)
  | 'network:fetch'    // Make external HTTP requests

export const ALL_PERMISSIONS: readonly WidgetPermission[] = [
  'read:workspace',
  'read:notes',
  'write:workspace',
  'write:notes',
  'write:chat',
  'network:fetch',
] as const

export const READ_PERMISSIONS: readonly WidgetPermission[] = [
  'read:workspace',
  'read:notes',
] as const

export const WRITE_PERMISSIONS: readonly WidgetPermission[] = [
  'write:workspace',
  'write:notes',
  'write:chat',
] as const

// =============================================================================
// Permission Metadata
// =============================================================================

export interface PermissionInfo {
  id: WidgetPermission
  label: string
  description: string
  requiresApproval: boolean
  riskLevel: 'low' | 'medium' | 'high'
}

export const PERMISSION_INFO: Record<WidgetPermission, PermissionInfo> = {
  'read:workspace': {
    id: 'read:workspace',
    label: 'Read Workspace',
    description: 'View panel layout and workspace state',
    requiresApproval: false,
    riskLevel: 'low',
  },
  'read:notes': {
    id: 'read:notes',
    label: 'Read Notes',
    description: 'Read note content and metadata',
    requiresApproval: false,
    riskLevel: 'low',
  },
  'write:workspace': {
    id: 'write:workspace',
    label: 'Modify Workspace',
    description: 'Open, close, or rearrange panels',
    requiresApproval: true,
    riskLevel: 'medium',
  },
  'write:notes': {
    id: 'write:notes',
    label: 'Modify Notes',
    description: 'Edit or delete note content',
    requiresApproval: true,
    riskLevel: 'high',
  },
  'write:chat': {
    id: 'write:chat',
    label: 'Send Chat Messages',
    description: 'Send messages to the chat assistant',
    requiresApproval: true,
    riskLevel: 'medium',
  },
  'network:fetch': {
    id: 'network:fetch',
    label: 'Network Access',
    description: 'Make HTTP requests to allowed external servers',
    requiresApproval: true,
    riskLevel: 'high',
  },
}

// =============================================================================
// Permission Checking
// =============================================================================

/**
 * Check if a permission string is valid
 */
export function isValidPermission(permission: string): permission is WidgetPermission {
  return ALL_PERMISSIONS.includes(permission as WidgetPermission)
}

/**
 * Check if a permission requires user approval
 */
export function requiresApproval(permission: WidgetPermission): boolean {
  return PERMISSION_INFO[permission]?.requiresApproval ?? true
}

/**
 * Check if a widget has a specific permission in its granted set
 */
export function hasPermission(
  grantedPermissions: WidgetPermission[],
  requiredPermission: WidgetPermission
): boolean {
  return grantedPermissions.includes(requiredPermission)
}

/**
 * Validate an array of permissions
 * Returns invalid permissions, or empty array if all valid
 */
export function validatePermissions(permissions: string[]): string[] {
  return permissions.filter(p => !isValidPermission(p))
}

/**
 * Get the required permission for a bridge API method
 */
export function getMethodPermission(method: string): WidgetPermission | null {
  const permissionMap: Record<string, WidgetPermission> = {
    // Read APIs
    'workspace.getPanels': 'read:workspace',
    'workspace.getActivePanel': 'read:workspace',
    'workspace.getLayout': 'read:workspace',
    'notes.getNote': 'read:notes',
    'notes.getCurrentNote': 'read:notes',
    'notes.listNotes': 'read:notes',

    // Write APIs
    'workspace.openPanel': 'write:workspace',
    'workspace.closePanel': 'write:workspace',
    'workspace.focusPanel': 'write:workspace',
    'notes.updateNote': 'write:notes',
    'notes.createNote': 'write:notes',
    'notes.deleteNote': 'write:notes',
    'chat.sendMessage': 'write:chat',

    // Network APIs
    'network.fetch': 'network:fetch',
  }

  return permissionMap[method] ?? null
}

// =============================================================================
// Allow Level Types
// =============================================================================

export type AllowLevel = 'once' | 'always' | 'never'

export interface PermissionGrant {
  widgetInstanceId: string
  userId: string | null
  permission: WidgetPermission
  allowLevel: AllowLevel
  grantedAt: Date
  expiresAt: Date | null
}

// =============================================================================
// Permission State (in-memory cache for session grants)
// =============================================================================

interface SessionGrant {
  permission: WidgetPermission
  allowLevel: 'once' | 'never'
  grantedAt: number
}

// In-memory session grants (cleared on page refresh)
const sessionGrants = new Map<string, SessionGrant[]>()

function getSessionKey(widgetInstanceId: string, userId: string | null): string {
  return `${widgetInstanceId}:${userId ?? 'global'}`
}

/**
 * Record a session-only grant (not persisted to DB)
 */
export function recordSessionGrant(
  widgetInstanceId: string,
  userId: string | null,
  permission: WidgetPermission,
  allowLevel: 'once' | 'never'
): void {
  const key = getSessionKey(widgetInstanceId, userId)
  const grants = sessionGrants.get(key) ?? []

  // Remove existing grant for this permission
  const filtered = grants.filter(g => g.permission !== permission)

  filtered.push({
    permission,
    allowLevel,
    grantedAt: Date.now(),
  })

  sessionGrants.set(key, filtered)
}

/**
 * Get session grant for a permission
 */
export function getSessionGrant(
  widgetInstanceId: string,
  userId: string | null,
  permission: WidgetPermission
): SessionGrant | null {
  const key = getSessionKey(widgetInstanceId, userId)
  const grants = sessionGrants.get(key) ?? []
  return grants.find(g => g.permission === permission) ?? null
}

/**
 * Clear all session grants for a widget instance
 */
export function clearSessionGrants(
  widgetInstanceId: string,
  userId: string | null
): void {
  const key = getSessionKey(widgetInstanceId, userId)
  sessionGrants.delete(key)
}

/**
 * Check approval status combining session and persistent grants
 * Returns: 'allow' | 'deny' | 'prompt'
 */
export function checkApprovalStatus(
  permission: WidgetPermission,
  declaredPermissions: WidgetPermission[],
  persistentGrant: PermissionGrant | null,
  widgetInstanceId: string,
  userId: string | null
): 'allow' | 'deny' | 'prompt' {
  // First check if permission is even declared in manifest
  if (!declaredPermissions.includes(permission)) {
    return 'deny'
  }

  // Check if permission requires approval at all
  if (!requiresApproval(permission)) {
    return 'allow'
  }

  // Check persistent grant first (DB)
  if (persistentGrant) {
    if (persistentGrant.allowLevel === 'always') return 'allow'
    if (persistentGrant.allowLevel === 'never') return 'deny'
    // 'once' grants are checked for expiry
    if (persistentGrant.expiresAt && new Date() > persistentGrant.expiresAt) {
      // Expired, need to re-prompt
    } else if (persistentGrant.allowLevel === 'once') {
      return 'allow'
    }
  }

  // Check session grant (in-memory)
  const sessionGrant = getSessionGrant(widgetInstanceId, userId, permission)
  if (sessionGrant) {
    if (sessionGrant.allowLevel === 'once') return 'allow'
    if (sessionGrant.allowLevel === 'never') return 'deny'
  }

  // Need to prompt user
  return 'prompt'
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Get human-readable description of permissions
 */
export function describePermissions(permissions: WidgetPermission[]): string[] {
  return permissions.map(p => PERMISSION_INFO[p]?.description ?? p)
}

/**
 * Group permissions by risk level
 */
export function groupByRiskLevel(
  permissions: WidgetPermission[]
): Record<'low' | 'medium' | 'high', WidgetPermission[]> {
  return {
    low: permissions.filter(p => PERMISSION_INFO[p]?.riskLevel === 'low'),
    medium: permissions.filter(p => PERMISSION_INFO[p]?.riskLevel === 'medium'),
    high: permissions.filter(p => PERMISSION_INFO[p]?.riskLevel === 'high'),
  }
}

/**
 * Check if any permissions require approval
 */
export function hasApprovalRequired(permissions: WidgetPermission[]): boolean {
  return permissions.some(p => requiresApproval(p))
}
