/**
 * Text-based anchoring system for Option A (offline, single-user mode)
 * 
 * Replaces Yjs RelativePosition with character offset-based anchoring.
 * Provides resilient text anchoring that can survive minor edits.
 * 
 * @module lib/utils/text-anchoring
 */

export interface PlainAnchor {
  type: 'text-range'
  start: number  // character offset from beginning
  end: number    // character offset from beginning
  context: {
    prefix: string  // 20 chars before selection
    suffix: string  // 20 chars after selection
    text: string    // the selected text itself
  }
}

export interface TextSelection {
  from: number
  to: number
  text: string
}

/**
 * Create a plain text anchor from a selection
 */
export function createPlainAnchor(
  doc: any, // ProseMirror doc
  from: number,
  to: number
): PlainAnchor {
  // Get the text content from the document
  const textContent = getTextFromDoc(doc)
  
  // Extract context for resilience
  const selectedText = textContent.slice(from, to)
  const prefix = textContent.slice(Math.max(0, from - 20), from)
  const suffix = textContent.slice(to, Math.min(textContent.length, to + 20))
  
  return {
    type: 'text-range',
    start: from,
    end: to,
    context: {
      prefix,
      suffix,
      text: selectedText
    }
  }
}

/**
 * Create an anchor from a DOM selection
 */
export function createAnchorFromSelection(selection: Selection): PlainAnchor | null {
  if (!selection.rangeCount) return null
  
  const range = selection.getRangeAt(0)
  const container = range.commonAncestorContainer.parentElement
  if (!container) return null
  
  // Calculate text offsets
  const textBefore = getTextBeforeNode(container, range.startContainer, range.startOffset)
  const selectedText = selection.toString()
  const start = textBefore.length
  const end = start + selectedText.length
  
  // Get full text for context
  const fullText = container.textContent || ''
  const prefix = fullText.slice(Math.max(0, start - 20), start)
  const suffix = fullText.slice(end, Math.min(fullText.length, end + 20))
  
  return {
    type: 'text-range',
    start,
    end,
    context: {
      prefix,
      suffix,
      text: selectedText
    }
  }
}

/**
 * Find anchor position in potentially modified text
 */
export function findAnchorPosition(
  anchor: PlainAnchor,
  currentText: string
): { start: number; end: number } | null {
  // First try exact position
  const candidateText = currentText.slice(anchor.start, anchor.end)
  if (candidateText === anchor.context.text) {
    return { start: anchor.start, end: anchor.end }
  }
  
  // Try to find by context
  const searchPattern = anchor.context.prefix + anchor.context.text + anchor.context.suffix
  const index = currentText.indexOf(searchPattern)
  
  if (index !== -1) {
    const start = index + anchor.context.prefix.length
    const end = start + anchor.context.text.length
    return { start, end }
  }
  
  // Fallback: search for just the text
  const textIndex = currentText.indexOf(anchor.context.text)
  if (textIndex !== -1) {
    // Verify it's likely the same occurrence using context
    const foundPrefix = currentText.slice(Math.max(0, textIndex - 20), textIndex)
    const foundSuffix = currentText.slice(
      textIndex + anchor.context.text.length,
      Math.min(currentText.length, textIndex + anchor.context.text.length + 20)
    )
    
    // Calculate similarity
    const prefixMatch = calculateSimilarity(anchor.context.prefix, foundPrefix)
    const suffixMatch = calculateSimilarity(anchor.context.suffix, foundSuffix)
    
    // If context is reasonably similar, accept it
    if (prefixMatch > 0.6 && suffixMatch > 0.6) {
      return {
        start: textIndex,
        end: textIndex + anchor.context.text.length
      }
    }
  }
  
  return null
}

/**
 * Apply anchors to a ProseMirror document
 */
export function applyAnchorsToDoc(
  doc: any,
  anchors: PlainAnchor[],
  markType: any,
  attrs: Record<string, any>
): any {
  // This would integrate with ProseMirror's transform system
  // For now, returning positions for the editor to handle
  const positions = []
  const textContent = getTextFromDoc(doc)
  
  for (const anchor of anchors) {
    const position = findAnchorPosition(anchor, textContent)
    if (position) {
      positions.push({
        from: position.start,
        to: position.end,
        mark: { type: markType, attrs }
      })
    }
  }
  
  return positions
}

/**
 * Extract plain text from ProseMirror document
 */
function getTextFromDoc(doc: any): string {
  let text = ''
  
  doc.descendants((node: any) => {
    if (node.isText) {
      text += node.text
    } else if (node.isBlock && text.length > 0) {
      text += '\n'
    }
  })
  
  return text
}

/**
 * Get text before a specific node/offset in DOM
 */
function getTextBeforeNode(
  container: HTMLElement,
  node: Node,
  offset: number
): string {
  let text = ''
  const walker = document.createTreeWalker(
    container,
    NodeFilter.SHOW_TEXT,
    null
  )
  
  let currentNode
  while (currentNode = walker.nextNode()) {
    if (currentNode === node) {
      text += (currentNode.textContent || '').slice(0, offset)
      break
    } else {
      text += currentNode.textContent || ''
    }
  }
  
  return text
}

/**
 * Calculate similarity between two strings (0-1)
 */
function calculateSimilarity(str1: string, str2: string): number {
  if (str1 === str2) return 1
  if (!str1.length || !str2.length) return 0
  
  const longer = str1.length > str2.length ? str1 : str2
  const shorter = str1.length > str2.length ? str2 : str1
  
  const editDistance = levenshteinDistance(longer, shorter)
  return (longer.length - editDistance) / longer.length
}

/**
 * Calculate Levenshtein distance between two strings
 */
function levenshteinDistance(str1: string, str2: string): number {
  const matrix = []
  
  for (let i = 0; i <= str2.length; i++) {
    matrix[i] = [i]
  }
  
  for (let j = 0; j <= str1.length; j++) {
    matrix[0][j] = j
  }
  
  for (let i = 1; i <= str2.length; i++) {
    for (let j = 1; j <= str1.length; j++) {
      if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
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
  
  return matrix[str2.length][str1.length]
}

/**
 * Convert anchor to/from JSON for storage
 */
export function serializeAnchor(anchor: PlainAnchor): string {
  return JSON.stringify(anchor)
}

export function deserializeAnchor(data: string): PlainAnchor {
  return JSON.parse(data)
}

/**
 * Batch process multiple anchors efficiently
 */
export function processAnchorBatch(
  anchors: PlainAnchor[],
  currentText: string
): Array<{ anchor: PlainAnchor; position: { start: number; end: number } | null }> {
  return anchors.map(anchor => ({
    anchor,
    position: findAnchorPosition(anchor, currentText)
  }))
}