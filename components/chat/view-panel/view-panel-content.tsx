/**
 * View Panel Content Router
 *
 * Routes to the appropriate renderer based on content type.
 * Also handles fetching file content for preview_file intent.
 */

'use client'

import { useEffect, useState } from 'react'
import { useViewPanel } from '@/lib/chat/view-panel-context'
import { ViewContentType } from '@/lib/chat/view-panel-types'
import { ListRenderer } from './renderers/list-renderer'
import { MixedListRenderer } from './renderers/mixed-list-renderer'
import { TextRenderer } from './renderers/text-renderer'
import { CodeRenderer } from './renderers/code-renderer'
import { NoteRenderer } from './renderers/note-renderer'
import { PDFRenderer } from './renderers/pdf-renderer'
import { Loader2 } from 'lucide-react'

export function ViewPanelContent() {
  const { state, updateContent } = useViewPanel()
  const { content } = state
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Fetch file content when filename is set but content is missing
  useEffect(() => {
    if (!content) return
    if (content.sourceIntent !== 'preview_file') return
    if (content.content) return // Already have content
    if (!content.filename) return

    const fetchFileContent = async () => {
      setIsLoading(true)
      setError(null)
      try {
        // API expects GET with path query parameter
        const url = new URL('/api/chat/preview/file', window.location.origin)
        url.searchParams.set('path', content.filename!)
        const response = await fetch(url.toString())

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({ error: 'Failed to load file' }))
          throw new Error(errorData.error || 'Failed to load file')
        }

        const data = await response.json()

        // Update content with fetched file content
        updateContent({
          ...content,
          content: data.content,
        })
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load file')
      } finally {
        setIsLoading(false)
      }
    }

    fetchFileContent()
  }, [content, updateContent])

  if (!content) {
    return (
      <div className="flex-1 flex items-center justify-center text-white/40 text-sm">
        No content to display
      </div>
    )
  }

  // Show loading state for file previews
  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-white/50" />
        <span className="ml-2 text-sm text-white/50">Loading file...</span>
      </div>
    )
  }

  // Show error state
  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center text-red-400/80 text-sm">
        {error}
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto p-4">
      {content.type === ViewContentType.LIST && <ListRenderer />}
      {content.type === ViewContentType.MIXED_LIST && <MixedListRenderer />}
      {content.type === ViewContentType.TEXT && <TextRenderer />}
      {content.type === ViewContentType.CODE && <CodeRenderer />}
      {content.type === ViewContentType.NOTE && <NoteRenderer />}
      {content.type === ViewContentType.PDF && <PDFRenderer />}
    </div>
  )
}
