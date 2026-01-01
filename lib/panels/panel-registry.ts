/**
 * Panel Intent Registry
 *
 * Central registry for panel chat manifests.
 * Aggregates intents from all registered panels and builds LLM prompt sections.
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
import { quickLinksPanelManifests } from './manifests/quick-links-panel'

/**
 * Panel Intent Registry
 */
class PanelIntentRegistry {
  private manifests: Map<string, PanelChatManifest> = new Map()
  private visiblePanels: Set<string> = new Set()
  private focusedPanelId: string | null = null

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

    // Quick Links panels (A, B, C, D)
    for (const manifest of quickLinksPanelManifests) {
      this.register(manifest)
    }
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
   * Get intents for visible panels (for LLM prompt)
   */
  getVisibleIntents(): Array<{ manifest: PanelChatManifest; intent: PanelIntent }> {
    const result: Array<{ manifest: PanelChatManifest; intent: PanelIntent }> = []

    for (const manifest of this.manifests.values()) {
      // Include all registered panels for now (can filter by visibility later)
      for (const intent of manifest.intents) {
        result.push({ manifest, intent })
      }
    }

    return result
  }

  /**
   * Build LLM prompt section for panel intents
   */
  buildPromptSection(): string {
    const intents = this.getVisibleIntents()

    if (intents.length === 0) {
      return ''
    }

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
    const byPanel = new Map<string, { manifest: PanelChatManifest; intents: PanelIntent[] }>()
    for (const { manifest, intent } of intents) {
      if (!byPanel.has(manifest.panelId)) {
        byPanel.set(manifest.panelId, { manifest, intents: [] })
      }
      byPanel.get(manifest.panelId)!.intents.push(intent)
    }

    for (const [panelId, { manifest, intents: panelIntents }] of byPanel) {
      prompt += `\n### ${manifest.title} (panelId: "${panelId}")\n`

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
1. If user explicitly mentions a panel name (e.g., "Quick Links A", "Recent"), use that panel.
2. If ambiguous between panels, prefer the focused panel: ${this.focusedPanelId || 'none'}.
3. If still ambiguous, ask for clarification.
`

    return prompt
  }

  /**
   * Find matching intent for a panel_intent request
   */
  findIntent(args: PanelIntentArgs): { manifest: PanelChatManifest; intent: PanelIntent } | null {
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
