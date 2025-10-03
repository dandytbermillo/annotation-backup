const JSON_START_RE = /^\s*[\[{]/
const WHITESPACE_RE = /\s+/g

export function stripHtml(html: string): string {
  try {
    return html.replace(/<[^>]*>/g, '')
  } catch {
    return html || ''
  }
}

function extractTextFromPMJSON(node: any): string {
  if (!node) return ''
  if (typeof node === 'string') return node

  if (typeof node === 'object' && node.type === 'text' && typeof node.text === 'string') {
    return node.text
  }

  if (node && Array.isArray(node.content)) {
    return node.content.map(extractTextFromPMJSON).join(' ')
  }

  if (node && typeof node.text === 'string') {
    return node.text
  }

  return ''
}

export function extractPreviewFromContent(content: unknown): string {
  if (!content) return ''

  if (typeof content === 'string') {
    const trimmed = content.trim()
    if (trimmed.length === 0) return ''

    if (JSON_START_RE.test(trimmed)) {
      try {
        const parsed = JSON.parse(trimmed)
        return extractTextFromPMJSON(parsed)
      } catch {
        return stripHtml(trimmed)
      }
    }

    return stripHtml(trimmed)
  }

  if (typeof content === 'object') {
    try {
      return extractTextFromPMJSON(content)
    } catch {
      return ''
    }
  }

  return ''
}

export function buildBranchPreview(content: unknown, fallback: string = '', maxLength = 160): string {
  const raw = extractPreviewFromContent(content) || fallback || ''
  const normalized = raw.replace(WHITESPACE_RE, ' ').trim()
  if (normalized.length <= maxLength) return normalized
  return `${normalized.slice(0, maxLength).trim()}...`
}

/**
 * Extract text from ProseMirror JSON preserving newlines between paragraphs.
 * Used for database storage to maintain document structure.
 */
function extractTextWithNewlines(node: any): string {
  if (!node) return ''
  if (typeof node === 'string') return node

  // Text nodes - return the text content
  if (typeof node === 'object' && node.type === 'text' && typeof node.text === 'string') {
    return node.text
  }

  // Block-level nodes (paragraph, heading, etc.) - add newlines between them
  if (node && node.type === 'doc' && Array.isArray(node.content)) {
    return node.content
      .map((child: any) => extractTextWithNewlines(child))
      .filter((text: string) => text.trim().length > 0)
      .join('\n')
  }

  // Paragraph or heading - extract inline content
  if (node && (node.type === 'paragraph' || node.type === 'heading') && Array.isArray(node.content)) {
    return node.content.map((child: any) => extractTextWithNewlines(child)).join('')
  }

  // Generic content array - recurse without adding newlines
  if (node && Array.isArray(node.content)) {
    return node.content.map((child: any) => extractTextWithNewlines(child)).join('')
  }

  // Fallback for text property
  if (node && typeof node.text === 'string') {
    return node.text
  }

  return ''
}

/**
 * Extract full text from content for database storage.
 * Preserves newlines between paragraphs/blocks.
 * Use this when saving to document_text or content_text columns.
 */
export function extractFullText(content: unknown): string {
  if (!content) return ''

  if (typeof content === 'string') {
    const trimmed = content.trim()
    if (trimmed.length === 0) return ''

    if (JSON_START_RE.test(trimmed)) {
      try {
        const parsed = JSON.parse(trimmed)
        return extractTextWithNewlines(parsed)
      } catch {
        return stripHtml(trimmed)
      }
    }

    return stripHtml(trimmed)
  }

  if (typeof content === 'object') {
    try {
      return extractTextWithNewlines(content)
    } catch {
      return ''
    }
  }

  return ''
}

/**
 * Build preview text preserving newlines for multi-line display.
 * Use this with CSS whitespace-pre-line for formatted previews.
 * Collapses multiple spaces but preserves line breaks.
 */
export function buildMultilinePreview(content: unknown, fallback: string = '', maxLength = 200): string {
  // Prefer fallback (contentText) which already has proper newlines
  if (fallback && fallback.trim()) {
    const normalized = fallback
      .replace(/[ \t]+/g, ' ')  // Collapse spaces/tabs but NOT newlines
      .replace(/\n{3,}/g, '\n\n')  // Limit consecutive newlines to max 2 (one blank line)
      .trim()

    if (normalized.length <= maxLength) return normalized
    return `${normalized.slice(0, maxLength).trim()}...`
  }

  // Fallback to extracting from content with newlines
  const raw = extractFullText(content)
  if (!raw) return ''

  const normalized = raw
    .replace(/[ \t]+/g, ' ')  // Collapse spaces/tabs but NOT newlines
    .replace(/\n{3,}/g, '\n\n')  // Limit consecutive newlines to max 2
    .trim()

  if (normalized.length <= maxLength) return normalized
  return `${normalized.slice(0, maxLength).trim()}...`
}
