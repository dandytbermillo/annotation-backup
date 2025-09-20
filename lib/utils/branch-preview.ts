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
