/**
 * Anchor Utilities for Plain Mode - Text-based anchoring without Yjs
 * 
 * Provides text-based anchor management for annotations in plain mode.
 * Uses character offsets and context strings for robust position tracking.
 * 
 * @module lib/utils/anchor-utils
 */

export interface TextAnchor {
  start: number
  end: number
  context: {
    before: string  // Text before the anchor (for validation)
    content: string // The anchored text itself
    after: string   // Text after the anchor (for validation)
  }
}

export interface AnchorUpdate {
  anchor: TextAnchor
  newStart: number
  newEnd: number
}

/**
 * Create a text anchor from a selection
 */
export function createTextAnchor(
  text: string,
  start: number,
  end: number,
  contextLength = 20
): TextAnchor {
  // Validate bounds
  if (start < 0 || end > text.length || start >= end) {
    throw new Error('Invalid anchor bounds')
  }
  
  // Extract context strings
  const beforeStart = Math.max(0, start - contextLength)
  const afterEnd = Math.min(text.length, end + contextLength)
  
  return {
    start,
    end,
    context: {
      before: text.slice(beforeStart, start),
      content: text.slice(start, end),
      after: text.slice(end, afterEnd)
    }
  }
}

/**
 * Find an anchor in updated text
 * Returns the new position or null if the anchor can't be found reliably
 */
export function findAnchor(
  anchor: TextAnchor,
  newText: string
): { start: number; end: number } | null {
  const { context } = anchor
  const searchString = context.content
  
  // If the content is too short, it's not unique enough
  if (searchString.length < 3) {
    return tryContextMatch(anchor, newText)
  }
  
  // Find all occurrences of the content
  const occurrences: number[] = []
  let index = newText.indexOf(searchString)
  
  while (index !== -1) {
    occurrences.push(index)
    index = newText.indexOf(searchString, index + 1)
  }
  
  // No matches found
  if (occurrences.length === 0) {
    return null
  }
  
  // Single match - easy case
  if (occurrences.length === 1) {
    return {
      start: occurrences[0],
      end: occurrences[0] + searchString.length
    }
  }
  
  // Multiple matches - use context to disambiguate
  return findBestMatch(anchor, newText, occurrences)
}

/**
 * Try to match using context when content alone isn't unique
 */
function tryContextMatch(
  anchor: TextAnchor,
  newText: string
): { start: number; end: number } | null {
  const { context } = anchor
  
  // Build a larger search pattern with context
  const pattern = context.before.slice(-10) + context.content + context.after.slice(0, 10)
  const patternIndex = newText.indexOf(pattern)
  
  if (patternIndex !== -1) {
    const start = patternIndex + context.before.slice(-10).length
    return {
      start,
      end: start + context.content.length
    }
  }
  
  return null
}

/**
 * Find the best match among multiple occurrences using context
 */
function findBestMatch(
  anchor: TextAnchor,
  newText: string,
  occurrences: number[]
): { start: number; end: number } | null {
  const { context } = anchor
  let bestMatch = -1
  let bestScore = -1
  
  for (const start of occurrences) {
    const end = start + context.content.length
    
    // Calculate context match score
    let score = 0
    
    // Check before context
    const beforeStart = Math.max(0, start - context.before.length)
    const beforeText = newText.slice(beforeStart, start)
    score += calculateSimilarity(context.before, beforeText) * 0.4
    
    // Check after context
    const afterEnd = Math.min(newText.length, end + context.after.length)
    const afterText = newText.slice(end, afterEnd)
    score += calculateSimilarity(context.after, afterText) * 0.4
    
    // Prefer positions close to original
    const positionDiff = Math.abs(start - anchor.start)
    const positionScore = 1 / (1 + positionDiff / 100)
    score += positionScore * 0.2
    
    if (score > bestScore) {
      bestScore = score
      bestMatch = start
    }
  }
  
  // Only return if we have a good enough match
  if (bestScore > 0.7 && bestMatch !== -1) {
    return {
      start: bestMatch,
      end: bestMatch + context.content.length
    }
  }
  
  return null
}

/**
 * Calculate string similarity using Levenshtein distance
 */
function calculateSimilarity(str1: string, str2: string): number {
  if (str1 === str2) return 1
  if (!str1.length || !str2.length) return 0
  
  const maxLen = Math.max(str1.length, str2.length)
  const distance = levenshteinDistance(str1, str2)
  
  return 1 - (distance / maxLen)
}

/**
 * Calculate Levenshtein distance between two strings
 */
function levenshteinDistance(str1: string, str2: string): number {
  const m = str1.length
  const n = str2.length
  const dp: number[][] = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0))
  
  for (let i = 0; i <= m; i++) dp[i][0] = i
  for (let j = 0; j <= n; j++) dp[0][j] = j
  
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (str1[i - 1] === str2[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1]
      } else {
        dp[i][j] = 1 + Math.min(
          dp[i - 1][j],     // deletion
          dp[i][j - 1],     // insertion
          dp[i - 1][j - 1]  // substitution
        )
      }
    }
  }
  
  return dp[m][n]
}

/**
 * Update multiple anchors after a text change
 */
export function updateAnchors(
  anchors: TextAnchor[],
  oldText: string,
  newText: string
): AnchorUpdate[] {
  const updates: AnchorUpdate[] = []
  
  // Sort anchors by position to handle them in order
  const sortedAnchors = [...anchors].sort((a, b) => a.start - b.start)
  
  for (const anchor of sortedAnchors) {
    const newPosition = findAnchor(anchor, newText)
    
    if (newPosition) {
      updates.push({
        anchor,
        newStart: newPosition.start,
        newEnd: newPosition.end
      })
    } else {
      // Anchor couldn't be found - mark as invalid
      updates.push({
        anchor,
        newStart: -1,
        newEnd: -1
      })
    }
  }
  
  return updates
}

/**
 * Convert ProseMirror positions to text offsets
 */
export function proseMirrorToTextOffset(
  doc: any,
  from: number,
  to: number
): { start: number; end: number; text: string } {
  // Get plain text from ProseMirror document
  const text = doc.textBetween(0, doc.content.size, '\n')
  
  // Convert ProseMirror positions to text offsets
  let textOffset = 0
  let pmOffset = 0
  let start = -1
  let end = -1
  
  doc.descendants((node: any, pos: number) => {
    if (start === -1 && pos === from) {
      start = textOffset
    }
    if (end === -1 && pos === to) {
      end = textOffset
    }
    
    if (node.isText) {
      textOffset += node.text.length
    } else if (node.isBlock && pos > 0) {
      textOffset += 1 // newline
    }
    
    return true
  })
  
  return { start, end, text }
}

/**
 * Validate if an anchor is still valid in the current text
 */
export function validateAnchor(
  anchor: TextAnchor,
  text: string
): boolean {
  // Check if the content at the original position still matches
  if (anchor.start >= 0 && anchor.end <= text.length) {
    const currentContent = text.slice(anchor.start, anchor.end)
    if (currentContent === anchor.context.content) {
      return true
    }
  }
  
  // Try to find the anchor in the new text
  const newPosition = findAnchor(anchor, text)
  return newPosition !== null
}

/**
 * Merge overlapping anchors
 */
export function mergeOverlappingAnchors(anchors: TextAnchor[]): TextAnchor[] {
  if (anchors.length <= 1) return anchors
  
  // Sort by start position
  const sorted = [...anchors].sort((a, b) => a.start - b.start)
  const merged: TextAnchor[] = []
  
  let current = sorted[0]
  
  for (let i = 1; i < sorted.length; i++) {
    const next = sorted[i]
    
    // Check for overlap
    if (next.start <= current.end) {
      // Merge anchors
      current = {
        start: current.start,
        end: Math.max(current.end, next.end),
        context: {
          before: current.context.before,
          content: current.context.content + next.context.content.slice(current.end - next.start),
          after: next.context.after
        }
      }
    } else {
      // No overlap, add current and move to next
      merged.push(current)
      current = next
    }
  }
  
  merged.push(current)
  return merged
}