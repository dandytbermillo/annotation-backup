/**
 * Note Renderer
 *
 * Rich text note preview using TipTap HTML output.
 */

'use client'

import { useViewPanel } from '@/lib/chat/view-panel-context'

export function NoteRenderer() {
  const { state } = useViewPanel()
  const { content } = state

  if (!content?.content) {
    return (
      <div className="flex items-center justify-center h-32 text-white/40 text-sm">
        No content to display
      </div>
    )
  }

  return (
    <div className="rounded-lg bg-black/20 border border-white/6 overflow-hidden">
      <div
        className="p-4 prose prose-invert prose-sm max-w-none
          prose-headings:text-white prose-headings:font-semibold
          prose-p:text-white/80
          prose-a:text-indigo-400 prose-a:no-underline hover:prose-a:underline
          prose-strong:text-white
          prose-code:text-indigo-300 prose-code:bg-white/10 prose-code:px-1 prose-code:rounded
          prose-pre:bg-black/30 prose-pre:border prose-pre:border-white/6
          prose-blockquote:border-indigo-500/50 prose-blockquote:text-white/60
          prose-ul:text-white/80 prose-ol:text-white/80
          prose-li:marker:text-white/50"
        dangerouslySetInnerHTML={{ __html: content.content }}
      />
    </div>
  )
}
