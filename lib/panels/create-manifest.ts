/**
 * Panel Manifest Factory Helpers
 *
 * Simplifies manifest creation with:
 * - Compile-time enforcement of required fields
 * - Sensible defaults (version, permission)
 * - Reduced boilerplate
 *
 * Usage:
 * ```ts
 * const manifest = createPanelManifest({
 *   panelId: 'my-panel',
 *   panelType: 'custom',
 *   title: 'My Panel',
 *   intents: [
 *     createIntent({
 *       name: 'list_items',
 *       description: 'List all items',
 *       examples: ['show items', 'list items'],
 *       handler: 'api:/api/panels/my-panel/list',
 *     }),
 *   ],
 * })
 * ```
 */

import type {
  PanelChatManifest,
  PanelIntent,
  PanelParamSchema,
  PanelPermission,
} from './panel-manifest'

// =============================================================================
// Intent Factory
// =============================================================================

/**
 * Input for creating an intent (with optional defaults)
 */
export interface CreateIntentInput {
  /** Unique intent name within the panel */
  name: string

  /** Human-readable description for LLM context */
  description: string

  /** Example phrases that trigger this intent (at least one required) */
  examples: [string, ...string[]] // TypeScript tuple: at least one string

  /** API handler path (e.g., "api:/api/panels/my-panel/list") */
  handler: string

  /** Permission level (defaults to 'read') */
  permission?: PanelPermission

  /** Optional parameter schema */
  paramsSchema?: Record<string, PanelParamSchema>
}

/**
 * Create a panel intent with sensible defaults.
 *
 * @example
 * ```ts
 * createIntent({
 *   name: 'list_items',
 *   description: 'List all items',
 *   examples: ['show items', 'list items'],
 *   handler: 'api:/api/panels/my-panel/list',
 *   // permission defaults to 'read'
 * })
 * ```
 */
export function createIntent(input: CreateIntentInput): PanelIntent {
  return {
    name: input.name,
    description: input.description,
    examples: input.examples,
    handler: input.handler,
    permission: input.permission ?? 'read',
    paramsSchema: input.paramsSchema,
  }
}

// =============================================================================
// Manifest Factory
// =============================================================================

/**
 * Input for creating a manifest (with optional defaults)
 */
export interface CreateManifestInput {
  /** Unique panel identifier (e.g., "my-panel", "taskboard") */
  panelId: string

  /** Panel type category (e.g., "custom", "recent", "quick-links") */
  panelType: string

  /** Human-readable title (e.g., "My Panel", "Task Board") */
  title: string

  /** List of chat intents this panel supports */
  intents: PanelIntent[]

  /** Manifest version (defaults to '1.0') */
  version?: string
}

/**
 * Create a panel chat manifest with sensible defaults.
 *
 * @example
 * ```ts
 * const manifest = createPanelManifest({
 *   panelId: 'taskboard',
 *   panelType: 'custom',
 *   title: 'Task Board',
 *   intents: [
 *     createIntent({
 *       name: 'list_tasks',
 *       description: 'Show all tasks',
 *       examples: ['show tasks', 'list my tasks'],
 *       handler: 'api:/api/panels/taskboard/list',
 *     }),
 *     createIntent({
 *       name: 'add_task',
 *       description: 'Add a new task',
 *       examples: ['add task', 'new task'],
 *       handler: 'api:/api/panels/taskboard/add',
 *       permission: 'write',
 *     }),
 *   ],
 * })
 * ```
 */
export function createPanelManifest(input: CreateManifestInput): PanelChatManifest {
  return {
    panelId: input.panelId,
    panelType: input.panelType,
    title: input.title,
    version: input.version ?? '1.0',
    intents: input.intents,
  }
}

// =============================================================================
// Common Intent Templates
// =============================================================================

/**
 * Create a standard "list" intent for a panel.
 *
 * @param panelId - The panel ID (used for handler path)
 * @param panelTitle - Human-readable panel title (for description)
 * @param additionalExamples - Extra example phrases
 */
export function createListIntent(
  panelId: string,
  panelTitle: string,
  additionalExamples: string[] = []
): PanelIntent {
  const titleLower = panelTitle.toLowerCase()
  return createIntent({
    name: 'list',
    description: `Show all items in ${panelTitle}`,
    examples: [
      `show ${titleLower}`,
      `list ${titleLower}`,
      `open ${titleLower}`,
      ...additionalExamples,
    ] as [string, ...string[]],
    handler: `api:/api/panels/${panelId}/list`,
    permission: 'read',
    paramsSchema: {
      mode: {
        type: 'string',
        required: false,
        description: 'Display mode: "drawer" or "preview"',
        default: 'drawer',
      },
    },
  })
}

/**
 * Create a standard "open item" intent for a panel.
 *
 * @param panelId - The panel ID (used for handler path)
 * @param panelTitle - Human-readable panel title (for description)
 */
export function createOpenItemIntent(
  panelId: string,
  panelTitle: string
): PanelIntent {
  const titleLower = panelTitle.toLowerCase()
  return createIntent({
    name: 'open_item',
    description: `Open a specific item from ${panelTitle}`,
    examples: [
      `open item from ${titleLower}`,
      `go to item in ${titleLower}`,
    ],
    handler: `api:/api/panels/${panelId}/open`,
    permission: 'read',
    paramsSchema: {
      name: {
        type: 'string',
        required: false,
        description: 'Name of the item to open',
      },
      position: {
        type: 'number',
        required: false,
        description: 'Position in the list (1 = first)',
      },
    },
  })
}

// =============================================================================
// Widget Author Checklist (Documentation)
// =============================================================================

/**
 * # Widget Chat Integration Checklist
 *
 * Follow these steps to make your widget chat-aware:
 *
 * ## 1. Create Manifest
 * ```ts
 * // lib/panels/manifests/my-widget-panel.ts
 * import { createPanelManifest, createIntent } from '../create-manifest'
 *
 * export const myWidgetManifest = createPanelManifest({
 *   panelId: 'my-widget',
 *   panelType: 'custom',
 *   title: 'My Widget',
 *   intents: [
 *     createIntent({
 *       name: 'show',
 *       description: 'Show my widget content',
 *       examples: ['show my widget', 'open my widget'],
 *       handler: 'api:/api/panels/my-widget/show',
 *     }),
 *   ],
 * })
 * ```
 *
 * ## 2. Register Manifest
 * ```ts
 * // lib/panels/panel-registry.ts
 * import { myWidgetManifest } from './manifests/my-widget-panel'
 *
 * // In registerBuiltIn():
 * this.register(myWidgetManifest)
 * ```
 *
 * ## 3. Wire Visibility (in widget component)
 * ```ts
 * import { usePanelChatVisibility } from '@/lib/hooks/use-panel-chat-visibility'
 *
 * export function MyWidget({ isActive }: { isActive: boolean }) {
 *   usePanelChatVisibility('my-widget', isActive)
 *   // ... rest of widget
 * }
 * ```
 *
 * ## 4. Create API Handler
 * ```ts
 * // app/api/panels/my-widget/show/route.ts
 * export async function POST(request: Request) {
 *   // Handle the intent and return PanelIntentResult
 * }
 * ```
 */
