/**
 * Text Renderer
 *
 * Plain text and markdown file preview.
 * Supports zoom through the ViewPanel state.
 */

'use client'

import { useViewPanel } from '@/lib/chat/view-panel-context'

export function TextRenderer() {
  const { state } = useViewPanel()
  const { content, zoom } = state

  if (!content?.content) {
    return (
      <div className="flex items-center justify-center h-32 text-white/40 text-sm">
        No content to display
      </div>
    )
  }

  const fontSize = Math.round(13 * (zoom / 100))
  const lineHeight = Math.round(20 * (zoom / 100))

  return (
    <div className="rounded-lg bg-black/20 border border-white/6 overflow-hidden">
      <pre
        className="p-4 text-white/80 overflow-x-auto whitespace-pre-wrap break-words font-mono"
        style={{
          fontSize: `${fontSize}px`,
          lineHeight: `${lineHeight}px`,
        }}
      >
        {content.content}
      </pre>
    </div>
  )
}
