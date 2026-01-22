/**
 * Panel Intent Registry
 *
 * Central registry for panel chat manifests.
 * Aggregates intents from all registered panels and builds LLM prompt sections.
 *
 * Architecture (from widget-manager-plan.md):
 * - Built-in widgets remain code-registered (Option B)
 * - Custom widgets are loaded from DB on server-side chat requests
 * - Server is the source of truth for manifests (not client-side registration)
 */

import {
  PanelChatManifest,
  PanelIntent,
  PanelIntentArgs,
  PanelIntentResult,
  validateManifest,
} from './panel-manifest'

// Import built-in manifests
import { recentPanelManifest } from './manifests/recent-panel'
import { linkNotesPanelManifests, createLinkNotesManifest } from './manifests/link-notes-panel'
import { navigatorPanelManifest } from './manifests/navigator-panel'
import { quickCapturePanelManifest } from './manifests/quick-capture-panel'
import { linksOverviewPanelManifest } from './manifests/links-overview-panel'
import { continuePanelManifest } from './manifests/continue-panel'
import { widgetManagerPanelManifest } from './manifests/widget-manager-panel'

// Note: DB manifest loading moved to server routes (lib/chat/intent-prompt.ts)
// to avoid bundling pg into client code

/**
 * Panel Intent Registry
 */
class PanelIntentRegistry {
  private manifests: Map<string, PanelChatManifest> = new Map()
  private visiblePanels: Set<string> = new Set()
  private focusedPanelId: string | null = null
  // Track which manifests came from DB (for pruning on reload)
  private dbManifestIds: Set<string> = new Set()

  private ensureQuickLinksManifest(panelId: string) {
    if (this.manifests.has(panelId)) return
    const match = panelId.match(/^quick-links-([a-z])$/i)
    if (!match) return
    const badge = match[1]
    this.register(createLinkNotesManifest(badge))
  }

  constructor() {
    // Register built-in panels
    this.registerBuiltIn()
  }

  /**
   * Register built-in panel manifests
   */
  private registerBuiltIn() {
    // Recent panel
    this.register(recentPanelManifest)

    // Link Notes panels (A, B, C, D, E)
    for (const manifest of linkNotesPanelManifests) {
      this.register(manifest)
    }

    // Widget panels (Navigator, Quick Capture, Links Overview, Continue, Widget Manager)
    this.register(navigatorPanelManifest)
    this.register(quickCapturePanelManifest)
    this.register(linksOverviewPanelManifest)
    this.register(continuePanelManifest)
    this.register(widgetManagerPanelManifest)

    // Note: Demo widget was moved to custom_widgets/demo_widget
    // Install via: http://localhost:3000/api/widgets/demo-manifest
  }

  /**
   * Register a panel manifest
   */
  register(manifest: PanelChatManifest): boolean {
    // Extract panelId before validation for error logging
    const panelId = manifest?.panelId

    if (!validateManifest(manifest)) {
      console.warn(`[PanelRegistry] Invalid manifest for panel: ${panelId}`)
      return false
    }

    this.manifests.set(manifest.panelId, manifest)
    return true
  }

  /**
   * Unregister a panel
   */
  unregister(panelId: string): boolean {
    return this.manifests.delete(panelId)
  }

  /**
   * Get a manifest by panel ID
   */
  get(panelId: string): PanelChatManifest | undefined {
    return this.manifests.get(panelId)
  }

  /**
   * Get all registered manifests
   */
  getAll(): PanelChatManifest[] {
    return Array.from(this.manifests.values())
  }

  /**
   * Set which panels are currently visible
   */
  setVisiblePanels(panelIds: string[]) {
    this.visiblePanels = new Set(panelIds)
  }

  /**
   * Set the currently focused panel
   */
  setFocusedPanel(panelId: string | null) {
    this.focusedPanelId = panelId
  }

  /**
   * Get intents for panels (for LLM prompt)
   * @param visiblePanelIds - If provided, only include these panels. If undefined, include all.
   */
  getVisibleIntents(visiblePanelIds?: string[]): Array<{ manifest: PanelChatManifest; intent: PanelIntent }> {
    const result: Array<{ manifest: PanelChatManifest; intent: PanelIntent }> = []

    // Use provided visibility or fallback to all panels
    const panelFilter = visiblePanelIds ? new Set(visiblePanelIds) : null

    if (panelFilter) {
      for (const panelId of panelFilter) {
        this.ensureQuickLinksManifest(panelId)
      }
    }

    for (const manifest of this.manifests.values()) {
      // IMPORTANT: Always include DB-loaded manifests (custom widgets)
      // They don't have physical panels on dashboard but should be available in chat
      const isDBManifest = this.dbManifestIds.has(manifest.panelId)

      // Filter by visibility if provided, but never filter out DB manifests
      if (panelFilter && !panelFilter.has(manifest.panelId) && !isDBManifest) {
        continue
      }

      for (const intent of manifest.intents) {
        result.push({ manifest, intent })
      }
    }

    return result
  }

  /**
   * Register widget manifests from DB
   * Called server-side with pre-loaded manifests
   * @param manifests - Manifests loaded from DB by server route
   */
  registerDBManifests(manifests: PanelChatManifest[]): void {
    // Step 1: Remove all previously loaded DB manifests (handles disabled widgets)
    for (const panelId of this.dbManifestIds) {
      this.manifests.delete(panelId)
    }
    this.dbManifestIds.clear()

    // Step 2: Register fresh manifests
    for (const manifest of manifests) {
      if (validateManifest(manifest)) {
        this.manifests.set(manifest.panelId, manifest)
        // Track this as a DB-loaded manifest for future pruning
        this.dbManifestIds.add(manifest.panelId)
      }
    }
  }

  /**
   * Build LLM prompt section with DB manifests
   * This is the main entry point for chat requests
   * @param dbManifests - Manifests loaded from DB by server route
   * @param visiblePanelIds - If provided, only include intents for these panels
   * @param focusedPanelId - If provided, prioritize this panel in ambiguous cases
   */
  buildPromptSectionWithDBManifests(
    dbManifests: PanelChatManifest[],
    visiblePanelIds?: string[],
    focusedPanelId?: string | null
  ): string {
    // Register DB manifests first
    this.registerDBManifests(dbManifests)
    // Then build the prompt
    return this.buildPromptSection(visiblePanelIds, focusedPanelId)
  }

  /**
   * Build LLM prompt section for panel intents
   * @param visiblePanelIds - If provided, only include intents for these panels
   * @param focusedPanelId - If provided, prioritize this panel in ambiguous cases
   */
  buildPromptSection(visiblePanelIds?: string[], focusedPanelId?: string | null): string {
    const intents = this.getVisibleIntents(visiblePanelIds)

    if (intents.length === 0) {
      return ''
    }

    // Use parameter or fall back to instance state
    const effectiveFocusedPanel = focusedPanelId ?? this.focusedPanelId

    let prompt = `
## Panel Intents
When the user wants to interact with a specific panel, return:
\`\`\`json
{
  "intent": "panel_intent",
  "args": {
    "panelId": "<panel_id>",
    "intentName": "<intent_name>",
    "params": { <optional parameters> }
  }
}
\`\`\`

Available panel intents:
`

    // Group by panel
    const byPanel = new Map<string, { manifest: PanelChatManifest; intents: PanelIntent[]; isFocused: boolean }>()
    for (const { manifest, intent } of intents) {
      if (!byPanel.has(manifest.panelId)) {
        byPanel.set(manifest.panelId, {
          manifest,
          intents: [],
          isFocused: manifest.panelId === effectiveFocusedPanel,
        })
      }
      byPanel.get(manifest.panelId)!.intents.push(intent)
    }

    // Sort: focused panel first
    const sortedPanels = Array.from(byPanel.entries()).sort((a, b) => {
      if (a[1].isFocused && !b[1].isFocused) return -1
      if (!a[1].isFocused && b[1].isFocused) return 1
      return 0
    })

    for (const [panelId, { manifest, intents: panelIntents, isFocused }] of sortedPanels) {
      const focusMarker = isFocused ? ' [FOCUSED]' : ''
      prompt += `\n### ${manifest.title} (panelId: "${panelId}")${focusMarker}\n`

      for (const intent of panelIntents) {
        prompt += `- **${intent.name}**: ${intent.description}\n`
        prompt += `  Examples: ${intent.examples.map(e => `"${e}"`).join(', ')}\n`
        if (intent.paramsSchema && Object.keys(intent.paramsSchema).length > 0) {
          prompt += `  Params: ${Object.keys(intent.paramsSchema).join(', ')}\n`
        }
      }
    }

    // Add priority rules
    prompt += `
### Priority Rules
1. If user explicitly mentions a panel name (e.g., "Link Notes A", "Recent"), use that panel.
2. If ambiguous between panels, prefer the panel marked [FOCUSED]: ${effectiveFocusedPanel || 'none'}.
3. If still ambiguous, ask for clarification.
`

    return prompt
  }

  /**
   * Find matching intent for a panel_intent request
   */
  findIntent(args: PanelIntentArgs): { manifest: PanelChatManifest; intent: PanelIntent } | null {
    if (!this.manifests.has(args.panelId)) {
      this.ensureQuickLinksManifest(args.panelId)
    }
    const manifest = this.manifests.get(args.panelId)
    if (!manifest) return null

    const intent = manifest.intents.find(i => i.name === args.intentName)
    if (!intent) return null

    return { manifest, intent }
  }

  /**
   * Get supported actions for a panel (for error messages)
   */
  getSupportedActions(panelId: string): string[] {
    if (!this.manifests.has(panelId)) {
      this.ensureQuickLinksManifest(panelId)
    }
    const manifest = this.manifests.get(panelId)
    if (!manifest) return []
    return manifest.intents.map(i => i.name)
  }

  /**
   * Find panel by title (for fuzzy matching)
   */
  findByTitle(title: string): PanelChatManifest | undefined {
    const normalized = title.toLowerCase().trim()
    for (const manifest of this.manifests.values()) {
      if (manifest.title.toLowerCase().includes(normalized)) {
        return manifest
      }
    }
    return undefined
  }
}

// Singleton instance
export const panelRegistry = new PanelIntentRegistry()

/**
 * Get the base URL for API calls
 * Works in both server and client contexts
 */
function getBaseUrl(): string {
  // Client-side: use relative URLs
  if (typeof window !== 'undefined') {
    return ''
  }

  // Server-side: construct from environment or use localhost
  const host = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : process.env.NEXT_PUBLIC_APP_URL
    || `http://localhost:${process.env.PORT || 3000}`

  return host
}

/**
 * Execute a panel intent by calling its API handler
 */
export async function executePanelIntent(
  args: PanelIntentArgs,
  options?: { requirePermission?: 'read' | 'write' }
): Promise<PanelIntentResult> {
  const match = panelRegistry.findIntent(args)

  if (!match) {
    const supported = panelRegistry.getSupportedActions(args.panelId)
    return {
      success: false,
      error: `Unknown panel or intent. Panel: ${args.panelId}, Intent: ${args.intentName}`,
      message: supported.length > 0
        ? `Supported actions for this panel: ${supported.join(', ')}`
        : `Panel "${args.panelId}" not found.`,
    }
  }

  const { intent } = match

  // Permission check
  if (options?.requirePermission === 'read' && intent.permission === 'write') {
    return {
      success: false,
      error: 'Permission denied',
      message: 'This action requires write permission.',
    }
  }

  // Parse handler
  if (!intent.handler.startsWith('api:')) {
    return {
      success: false,
      error: `Invalid handler format: ${intent.handler}`,
    }
  }

  const apiPath = intent.handler.replace('api:', '')
  const baseUrl = getBaseUrl()
  const fullUrl = `${baseUrl}${apiPath}`

  try {
    const response = await fetch(fullUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        panelId: args.panelId,
        intentName: args.intentName,
        params: args.params,
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      return {
        success: false,
        error: `API error: ${response.status}`,
        message: errorText || 'Failed to execute panel action.',
      }
    }

    const result = await response.json()
    return {
      success: true,
      ...result,
    }
  } catch (error) {
    return {
      success: false,
      error: String(error),
      message: 'Failed to execute panel action.',
    }
  }
}
