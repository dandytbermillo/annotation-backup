/**
 * Typo Suggestion Fallback
 *
 * Provides friendly suggestions when intent parsing fails due to typos.
 * Uses fuzzy matching against a dynamic vocabulary built from:
 * - Core commands (workspaces, dashboard, home)
 * - Visible panels (Recent, Quick Links)
 * - Installed widget manifests (Demo Widget, etc.)
 *
 * Reference: docs/proposal/chat-navigation/plan/panels/chat/typo-suggestion-fallback-plan.md
 * Reference: docs/proposal/chat-navigation/plan/panels/chat/dynamic-typo-suggestions-plan.md
 */

import type { PanelChatManifest } from '@/lib/panels/panel-manifest'

// =============================================================================
// Types
// =============================================================================

export interface CommandCandidate {
  /** The canonical command name */
  command: string
  /** Display label for UI */
  label: string
  /** Fuzzy match score (0-1, higher = better match) */
  score: number
  /** Primary action for this command */
  primaryAction: 'open' | 'list' | 'navigate' | 'create' | 'info'
  /** Intent name to use if user confirms */
  intentName: string
  /** Panel ID if applicable */
  panelId?: string
}

export interface SuggestionResult {
  /** Type of suggestion response */
  type: 'confirm_single' | 'choose_multiple' | 'low_confidence'
  /** Message to display */
  message: string
  /** Suggestion candidates */
  candidates: CommandCandidate[]
  /** Whether to show action buttons */
  showButtons: boolean
}

/**
 * Context for dynamic suggestion generation
 * Includes panel manifests and visible panels for building dynamic vocabulary
 */
export interface DynamicSuggestionContext {
  /** Panel manifests from registry (built-in + DB-loaded widgets) */
  manifests?: PanelChatManifest[]
  /** Currently visible panel IDs */
  visiblePanels?: string[]
}

// =============================================================================
// Closed Command Vocabulary
// =============================================================================

interface CommandDef {
  /** Canonical phrases that trigger this command */
  phrases: string[]
  /** Display label */
  label: string
  /** Primary action type */
  primaryAction: 'open' | 'list' | 'navigate' | 'create' | 'info'
  /** Intent name */
  intentName: string
  /** Panel ID if applicable */
  panelId?: string
}

const COMMAND_VOCABULARY: CommandDef[] = [
  // Quick Links
  {
    phrases: ['quick links', 'quicklinks', 'quick link', 'quicklink'],
    label: 'Quick Links',
    primaryAction: 'open',
    intentName: 'show_quick_links',
  },
  // Recent
  {
    phrases: ['recent', 'recents', 'recent items', 'recently opened', 'open recent', 'show recent', 'list recent', 'view recent'],
    label: 'Recent',
    primaryAction: 'open',
    intentName: 'panel_intent',
    panelId: 'recent',
  },
  // Workspaces
  {
    phrases: ['workspaces', 'workspace', 'list workspaces', 'my workspaces', 'show workspaces'],
    label: 'Workspaces',
    primaryAction: 'list',
    intentName: 'list_workspaces',
  },
  // Dashboard
  {
    phrases: ['dashboard', 'go to dashboard', 'back to dashboard', 'home dashboard'],
    label: 'Dashboard',
    primaryAction: 'navigate',
    intentName: 'go_to_dashboard',
  },
  // Home
  {
    phrases: ['home', 'go home', 'back home', 'main'],
    label: 'Home',
    primaryAction: 'navigate',
    intentName: 'go_home',
  },
  // Create workspace
  {
    phrases: ['create workspace', 'new workspace', 'make workspace', 'add workspace'],
    label: 'Create Workspace',
    primaryAction: 'create',
    intentName: 'create_workspace',
  },
  // Where am I
  {
    phrases: ['where am i', 'where am I', 'current location', 'location'],
    label: 'Where am I?',
    primaryAction: 'info',
    intentName: 'location_info',
  },
  // What did I do
  {
    phrases: ['what did i do', 'last action', 'what did I just do', 'what happened'],
    label: 'Last Action',
    primaryAction: 'info',
    intentName: 'last_action',
  },
]

// =============================================================================
// Dynamic Vocabulary Builder
// =============================================================================

/**
 * Normalize text for matching (handle pluralization and common variations)
 */
function normalizeForMatching(text: string): string {
  return text
    .toLowerCase()
    .trim()
    // Normalize plurals
    .replace(/widgets$/i, 'widget')
    .replace(/links$/i, 'link')
    .replace(/items$/i, 'item')
    .replace(/panels$/i, 'panel')
}

/**
 * Build dynamic command vocabulary from panel manifests
 * Converts panel manifests into CommandDef entries for fuzzy matching
 */
function buildDynamicVocabulary(manifests: PanelChatManifest[]): CommandDef[] {
  const dynamicCommands: CommandDef[] = []
  const seenPanelIds = new Set<string>()

  for (const manifest of manifests) {
    // Skip duplicates (same panelId from different sources)
    if (seenPanelIds.has(manifest.panelId)) continue
    seenPanelIds.add(manifest.panelId)

    // Skip built-in panels that are already in COMMAND_VOCABULARY
    // to avoid duplicates (recent, quick-links-* are already covered)
    if (manifest.panelId === 'recent') continue
    if (manifest.panelId.startsWith('quick-links-')) continue

    // Build phrases from title and common variations
    const title = manifest.title
    const titleLower = title.toLowerCase()
    const titleNormalized = normalizeForMatching(title)

    const phrases: string[] = [
      titleLower,
      titleNormalized,
      // Add common verb + title patterns
      `show ${titleLower}`,
      `open ${titleLower}`,
      `view ${titleLower}`,
      // Handle "my X" pattern
      `my ${titleLower}`,
      `show my ${titleLower}`,
    ]

    // Add example phrases from intents (without verbs, for fuzzy matching)
    for (const intent of manifest.intents) {
      for (const example of intent.examples) {
        // Extract just the key part (remove common verbs)
        const cleaned = example
          .toLowerCase()
          .replace(/^(show|open|view|display|list|get)\s+/i, '')
          .trim()
        if (cleaned && !phrases.includes(cleaned)) {
          phrases.push(cleaned)
        }
      }
    }

    dynamicCommands.push({
      phrases,
      label: title,
      primaryAction: 'open',
      intentName: 'panel_intent',
      panelId: manifest.panelId,
    })
  }

  return dynamicCommands
}

/**
 * Build quick-links badge variants from visible panels
 * Extracts quick-links-a, quick-links-b, etc. from visiblePanels and creates
 * CommandDef entries like "Quick Links A", "Quick Links D"
 */
function buildVisibleQuickLinksVocabulary(visiblePanels?: string[]): CommandDef[] {
  if (!visiblePanels || visiblePanels.length === 0) return []

  const quickLinksCommands: CommandDef[] = []

  for (const panelId of visiblePanels) {
    // Match quick-links-X pattern (e.g., quick-links-a, quick-links-d)
    const match = panelId.match(/^quick-links-([a-z])$/i)
    if (!match) continue

    const badge = match[1].toUpperCase()
    const label = `Quick Links ${badge}`
    const badgeLower = badge.toLowerCase()

    quickLinksCommands.push({
      phrases: [
        `quick links ${badgeLower}`,
        `quick link ${badgeLower}`,
        `quicklinks ${badgeLower}`,
        `links ${badgeLower}`,
        `show quick links ${badgeLower}`,
        `open quick links ${badgeLower}`,
      ],
      label,
      primaryAction: 'open',
      intentName: 'panel_intent',
      panelId,
    })
  }

  return quickLinksCommands
}

/**
 * Get merged vocabulary: static core commands + dynamic panel/widget commands
 *
 * Per dynamic-typo-suggestions-fixes-plan.md:
 * - Generic "Quick Links" is kept in vocabulary (API handles disambiguation)
 * - Badge-specific variants (Quick Links D, etc.) are added from visible panels
 * - When user confirms "Quick Links" with multiple panels, API returns selection
 */
function getMergedVocabulary(context?: DynamicSuggestionContext): CommandDef[] {
  // Start with core commands
  const vocabulary = [...COMMAND_VOCABULARY]

  // Add visible quick-links badge variants (e.g., Quick Links D)
  if (context?.visiblePanels) {
    const quickLinksVocab = buildVisibleQuickLinksVocabulary(context.visiblePanels)
    vocabulary.push(...quickLinksVocab)
  }

  // Add dynamic commands from manifests if provided
  if (context?.manifests && context.manifests.length > 0) {
    const dynamicCommands = buildDynamicVocabulary(context.manifests)
    vocabulary.push(...dynamicCommands)
  }

  return vocabulary
}

/**
 * Get default suggestions list from available vocabulary
 * Used for fallback message when no matches found
 */
function getDefaultSuggestionLabels(vocabulary: CommandDef[]): string {
  // Pick top 3 most common/useful commands for the fallback message
  // Prioritize: panels first, then core commands
  const panels = vocabulary.filter(c => c.panelId)
  const coreCommands = vocabulary.filter(c => !c.panelId && ['Workspaces', 'Dashboard', 'Home'].includes(c.label))

  const suggestions: string[] = []

  // Add up to 2 panels
  for (const panel of panels.slice(0, 2)) {
    suggestions.push(`\`${panel.label.toLowerCase()}\``)
  }

  // Add 1 core command if we have room
  if (suggestions.length < 3 && coreCommands.length > 0) {
    suggestions.push(`\`${coreCommands[0].label.toLowerCase()}\``)
  }

  // If still need more, add from static vocabulary
  if (suggestions.length < 3) {
    const remaining = COMMAND_VOCABULARY
      .filter(c => !suggestions.some(s => s.includes(c.label.toLowerCase())))
      .slice(0, 3 - suggestions.length)
    for (const cmd of remaining) {
      suggestions.push(`\`${cmd.label.toLowerCase()}\``)
    }
  }

  return suggestions.join(', ')
}

// =============================================================================
// Fuzzy Matching
// =============================================================================

/**
 * Calculate Levenshtein distance between two strings
 */
function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = []

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i]
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1]
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1,     // insertion
          matrix[i - 1][j] + 1      // deletion
        )
      }
    }
  }

  return matrix[b.length][a.length]
}

/**
 * Calculate similarity score (0-1) based on Levenshtein distance
 */
function similarityScore(input: string, target: string): number {
  const inputLower = input.toLowerCase().trim()
  const targetLower = target.toLowerCase().trim()

  // Exact match
  if (inputLower === targetLower) {
    return 1.0
  }

  // Check if input is a prefix of target or vice versa
  if (targetLower.startsWith(inputLower) || inputLower.startsWith(targetLower)) {
    const ratio = Math.min(inputLower.length, targetLower.length) / Math.max(inputLower.length, targetLower.length)
    return 0.85 + (ratio * 0.1) // 0.85-0.95 for prefix matches
  }

  // Levenshtein-based score
  const distance = levenshteinDistance(inputLower, targetLower)
  const maxLen = Math.max(inputLower.length, targetLower.length)

  if (maxLen === 0) return 1.0

  const score = 1 - (distance / maxLen)

  // Boost score for small edit distances on short inputs
  if (distance <= 2 && inputLower.length >= 4) {
    return Math.min(score + 0.15, 0.95)
  }

  return score
}

/**
 * Find the best matching command for a given input
 * @param input - User input to match
 * @param vocabulary - Optional custom vocabulary (defaults to COMMAND_VOCABULARY)
 */
function findMatches(input: string, vocabulary?: CommandDef[]): CommandCandidate[] {
  const candidates: CommandCandidate[] = []
  const inputLower = input.toLowerCase().trim()
  // Also normalize input for better matching (handle "widgets" → "widget")
  const inputNormalized = normalizeForMatching(input)

  const commandList = vocabulary ?? COMMAND_VOCABULARY

  for (const cmd of commandList) {
    let bestScore = 0
    let bestPhrase = cmd.phrases[0]

    for (const phrase of cmd.phrases) {
      // Try both raw and normalized input
      const score1 = similarityScore(inputLower, phrase)
      const score2 = similarityScore(inputNormalized, phrase)
      const score = Math.max(score1, score2)

      if (score > bestScore) {
        bestScore = score
        bestPhrase = phrase
      }
    }

    // Only include if score is above minimum threshold (0.5)
    if (bestScore >= 0.5) {
      candidates.push({
        command: bestPhrase,
        label: cmd.label,
        score: bestScore,
        primaryAction: cmd.primaryAction,
        intentName: cmd.intentName,
        panelId: cmd.panelId,
      })
    }
  }

  // Sort by score descending
  candidates.sort((a, b) => b.score - a.score)

  return candidates
}

// =============================================================================
// Suggestion Generation
// =============================================================================

/**
 * Generate suggestions for a failed intent parse
 *
 * Decision logic (from plan):
 * - One strong candidate (score >= 0.90): Ask confirmation + 2 action buttons
 * - Two candidates close (score gap < 0.08): Ask which one + buttons
 * - Otherwise: Short suggestion list
 *
 * @param userInput - The user's input message
 * @param context - Optional dynamic context with manifests for building vocabulary
 */
export function getSuggestions(
  userInput: string,
  context?: DynamicSuggestionContext
): SuggestionResult | null {
  // Build vocabulary dynamically from manifests + core commands
  const vocabulary = getMergedVocabulary(context)
  const candidates = findMatches(userInput, vocabulary)

  if (candidates.length === 0) {
    // No matches at all - return dynamic suggestions based on available vocabulary
    const defaultLabels = getDefaultSuggestionLabels(vocabulary)
    return {
      type: 'low_confidence',
      message: `I'm not sure what you meant. Try: ${defaultLabels}.`,
      candidates: [],
      showButtons: false,
    }
  }

  const topCandidate = candidates[0]

  // Case A: High-confidence single match (score >= 0.90)
  if (topCandidate.score >= 0.90) {
    const actionText = topCandidate.primaryAction === 'open'
      ? 'I can open it or list it here.'
      : topCandidate.primaryAction === 'list'
      ? 'I can show the list.'
      : topCandidate.primaryAction === 'navigate'
      ? 'I can take you there.'
      : topCandidate.primaryAction === 'create'
      ? 'I can help you create one.'
      : 'I can help with that.'

    return {
      type: 'confirm_single',
      message: `Did you mean **${topCandidate.label}**? ${actionText}`,
      candidates: [topCandidate],
      showButtons: true,
    }
  }

  // Case B: Multiple close matches (top 2 within 0.08 of each other)
  if (candidates.length >= 2) {
    const secondCandidate = candidates[1]
    const scoreGap = topCandidate.score - secondCandidate.score

    if (scoreGap < 0.08 && secondCandidate.score >= 0.70) {
      return {
        type: 'choose_multiple',
        message: `Did you mean **${topCandidate.label}** or **${secondCandidate.label}**?`,
        candidates: [topCandidate, secondCandidate],
        showButtons: true,
      }
    }
  }

  // Case C: Low confidence - show top 3 suggestions
  if (topCandidate.score >= 0.60) {
    // Medium confidence - suggest the top match
    return {
      type: 'confirm_single',
      message: `Did you mean **${topCandidate.label}**?`,
      candidates: [topCandidate],
      showButtons: true,
    }
  }

  // Very low confidence - use dynamic suggestions from candidates or vocabulary
  const suggestionLabels = candidates.slice(0, 3).map(c => `\`${c.label.toLowerCase()}\``).join(', ')
  const fallbackLabels = suggestionLabels || getDefaultSuggestionLabels(vocabulary)

  return {
    type: 'low_confidence',
    message: `I'm not sure what you meant. Try: ${fallbackLabels}.`,
    candidates: candidates.slice(0, 3),
    showButtons: candidates.length > 0 && candidates[0].score >= 0.50,
  }
}

/**
 * Check if a suggestion result should replace the default "unsupported" response
 */
export function shouldUseSuggestion(suggestion: SuggestionResult | null): boolean {
  if (!suggestion) return false
  // Always use suggestions - they're friendlier than the default
  return true
}

/**
 * Format suggestion for display (without buttons, just text)
 */
export function formatSuggestionText(suggestion: SuggestionResult): string {
  return suggestion.message
}
