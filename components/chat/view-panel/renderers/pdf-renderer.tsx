/**
 * PDF Renderer
 *
 * v1: Opens PDFs externally (no inline rendering).
 * Shows a placeholder with download/open actions.
 */

'use client'

import { FileText, ExternalLink, Download } from 'lucide-react'
import { useViewPanel } from '@/lib/chat/view-panel-context'

export function PDFRenderer() {
  const { state } = useViewPanel()
  const { content } = state

  if (!content) {
    return (
      <div className="flex items-center justify-center h-32 text-white/40 text-sm">
        No content to display
      </div>
    )
  }

  const handleOpenExternal = () => {
    if (content.filename) {
      window.open(content.filename, '_blank')
    }
  }

  const handleDownload = () => {
    if (content.filename) {
      const a = document.createElement('a')
      a.href = content.filename
      a.download = content.filename.split('/').pop() || 'document.pdf'
      a.click()
    }
  }

  return (
    <div className="flex flex-col items-center justify-center gap-4 p-8 rounded-xl bg-black/20 border border-white/6">
      <div className="flex items-center justify-center w-16 h-16 rounded-2xl bg-red-500/20">
        <FileText className="w-8 h-8 text-red-400" />
      </div>

      <div className="text-center">
        <h3 className="text-sm font-medium text-white mb-1">
          {content.title}
        </h3>
        {content.pageCount && (
          <p className="text-xs text-white/50">
            {content.pageCount} page{content.pageCount !== 1 ? 's' : ''}
          </p>
        )}
      </div>

      <p className="text-xs text-white/40 text-center max-w-[200px]">
        PDF preview is not available inline. Use the buttons below to view the document.
      </p>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={handleDownload}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-xs text-white/70 hover:bg-white/10 hover:text-white transition-colors"
        >
          <Download className="w-3.5 h-3.5" />
          Download
        </button>
        <button
          type="button"
          onClick={handleOpenExternal}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-indigo-500/80 text-xs text-white hover:bg-indigo-500 transition-colors"
        >
          <ExternalLink className="w-3.5 h-3.5" />
          Open in New Tab
        </button>
      </div>
    </div>
  )
}
