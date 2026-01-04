/**
 * Typo Suggestion Fallback
 *
 * Provides friendly suggestions when intent parsing fails due to typos.
 * Uses fuzzy matching against a closed vocabulary of commands.
 *
 * Reference: docs/proposal/chat-navigation/plan/panels/chat/typo-suggestion-fallback-plan.md
 */

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
    phrases: ['recent', 'recents', 'recent items', 'recently opened'],
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
 */
function findMatches(input: string): CommandCandidate[] {
  const candidates: CommandCandidate[] = []
  const inputLower = input.toLowerCase().trim()

  for (const cmd of COMMAND_VOCABULARY) {
    let bestScore = 0
    let bestPhrase = cmd.phrases[0]

    for (const phrase of cmd.phrases) {
      const score = similarityScore(inputLower, phrase)
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
 */
export function getSuggestions(userInput: string): SuggestionResult | null {
  const candidates = findMatches(userInput)

  if (candidates.length === 0) {
    // No matches at all - return generic suggestions
    return {
      type: 'low_confidence',
      message: "I'm not sure what you meant. Try: `quick links`, `recent`, or `workspaces`.",
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

  // Very low confidence - generic suggestions
  const suggestionLabels = candidates.slice(0, 3).map(c => `\`${c.label.toLowerCase()}\``).join(', ')

  return {
    type: 'low_confidence',
    message: suggestionLabels
      ? `I'm not sure what you meant. Try: ${suggestionLabels}.`
      : "I'm not sure what you meant. Try: `quick links`, `recent`, or `workspaces`.",
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
