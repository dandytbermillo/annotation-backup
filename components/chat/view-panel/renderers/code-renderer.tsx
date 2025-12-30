/**
 * Code Renderer
 *
 * Syntax-highlighted code file preview with line numbers.
 * Uses basic highlighting; can be upgraded to Shiki/Prism later.
 */

'use client'

import { useViewPanel } from '@/lib/chat/view-panel-context'

export function CodeRenderer() {
  const { state } = useViewPanel()
  const { content, zoom } = state

  if (!content?.content) {
    return (
      <div className="flex items-center justify-center h-32 text-white/40 text-sm">
        No content to display
      </div>
    )
  }

  const lines = content.content.split('\n')
  const fontSize = Math.round(12 * (zoom / 100))
  const lineHeight = Math.round(18 * (zoom / 100))
  const gutterWidth = String(lines.length).length

  return (
    <div className="rounded-lg bg-black/30 border border-white/6 overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-1.5 bg-white/5 border-b border-white/6">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-white/50">
          {content.language || 'text'}
        </span>
        <span className="text-[10px] text-white/30">
          {lines.length} line{lines.length !== 1 ? 's' : ''}
        </span>
      </div>
      <div className="overflow-x-auto">
        <table
          className="w-full font-mono"
          style={{
            fontSize: `${fontSize}px`,
            lineHeight: `${lineHeight}px`,
          }}
        >
          <tbody>
            {lines.map((line, index) => (
              <tr key={index} className="hover:bg-white/3">
                <td
                  className="text-right pr-3 pl-3 text-white/30 select-none border-r border-white/6"
                  style={{ width: `${gutterWidth + 2}ch` }}
                >
                  {index + 1}
                </td>
                <td className="pl-3 pr-4 text-white/80 whitespace-pre">
                  {line || ' '}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
