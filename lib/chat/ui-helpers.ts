/**
 * UI Helper Functions for Chat Navigation
 *
 * Pure utility functions extracted from chat-navigation-panel.tsx
 * to reduce file size and improve testability.
 */

/**
 * Normalize user message by stripping filler phrases and cleaning up spacing.
 * Preserves semantic content like "create" and "new".
 */
export function normalizeUserMessage(input: string): string {
  let normalized = input.trim()

  // Strip common filler phrases (but preserve "create" and "new")
  const fillerPatterns = [
    /^(hey|hi|hello|please|can you|could you|would you|i want to|i'd like to|let's|let me|how about|what about)\s+/i,
    /\s+(please|thanks|thank you)$/i,
  ]
  for (const pattern of fillerPatterns) {
    normalized = normalized.replace(pattern, '')
  }

  // Collapse duplicate consecutive words ("workspace workspace 5" → "workspace 5")
  normalized = normalized.replace(/\b(\w+)\s+\1\b/gi, '$1')

  // Collapse multiple spaces
  normalized = normalized.replace(/\s+/g, ' ').trim()

  return normalized
}

/**
 * Parse ordinal phrases to 1-based index.
 * Returns the index if recognized, -1 for "last", or null if not an ordinal.
 *
 * Examples:
 * - "first" → 1
 * - "second" → 2
 * - "option 3" → 3
 * - "last" → -1
 * - "hello" → null
 */
export function parseOrdinal(input: string): number | null {
  const normalized = input.toLowerCase().trim()

  // Simple ordinals
  const ordinalMap: Record<string, number> = {
    'first': 1, '1': 1, 'one': 1, 'the first': 1, 'first one': 1, 'the first one': 1,
    'second': 2, '2': 2, 'two': 2, 'the second': 2, 'second one': 2, 'the second one': 2,
    'third': 3, '3': 3, 'three': 3, 'the third': 3, 'third one': 3, 'the third one': 3,
    'fourth': 4, '4': 4, 'four': 4, 'the fourth': 4, 'fourth one': 4, 'the fourth one': 4,
    'fifth': 5, '5': 5, 'five': 5, 'the fifth': 5, 'fifth one': 5, 'the fifth one': 5,
    'last': -1, 'the last': -1, 'last one': -1, 'the last one': -1,
  }

  // Check for exact match
  if (ordinalMap[normalized] !== undefined) {
    return ordinalMap[normalized]
  }

  // Check for patterns like "option 1", "option 2", etc.
  const optionMatch = normalized.match(/^(?:option|number|#)\s*(\d+)$/i)
  if (optionMatch) {
    return parseInt(optionMatch[1], 10)
  }

  return null
}

/**
 * Extract Link Notes badge letter from user input or title string.
 * Returns the badge letter (uppercase) or null if not found.
 *
 * Example: "link notes d" → "D", "open link notes f" → "F"
 */
export function extractLinkNotesBadge(input?: string): string | null {
  if (!input) return null
  // Match "link notes X" or "link note X" where X is a single letter
  const match = input.match(/\blink\s*notes?\s+([a-z])\b/i)
  return match ? match[1].toUpperCase() : null
}

// Backward-compatible alias (deprecated)
export const extractQuickLinksBadge = extractLinkNotesBadge
