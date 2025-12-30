/**
 * View Panel Toolbar
 *
 * Displays zoom controls and document actions for text/code/PDF content types.
 */

'use client'

import { ZoomIn, ZoomOut, Download, Printer } from 'lucide-react'
import { useViewPanel } from '@/lib/chat/view-panel-context'
import { ViewContentType } from '@/lib/chat/view-panel-types'

export function ViewPanelToolbar() {
  const { state, setZoom } = useViewPanel()
  const { content, zoom } = state

  if (!content) return null

  const isPDF = content.type === ViewContentType.PDF
  const canZoom =
    content.type === ViewContentType.TEXT ||
    content.type === ViewContentType.CODE

  const handleZoomIn = () => setZoom(zoom + 10)
  const handleZoomOut = () => setZoom(zoom - 10)

  const handleDownload = () => {
    if (content.filename && content.content) {
      const blob = new Blob([content.content], { type: 'text/plain' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = content.filename.split('/').pop() || 'file.txt'
      a.click()
      URL.revokeObjectURL(url)
    }
  }

  const handlePrint = () => {
    // For text/code content, open print dialog
    if (content.content) {
      const printWindow = window.open('', '_blank')
      if (printWindow) {
        printWindow.document.write(`
          <html>
            <head>
              <title>${content.title}</title>
              <style>
                body { font-family: monospace; white-space: pre-wrap; padding: 20px; }
              </style>
            </head>
            <body>${content.content.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</body>
          </html>
        `)
        printWindow.document.close()
        printWindow.print()
      }
    }
  }

  return (
    <div className="flex items-center justify-between px-4 py-2 border-b border-white/6 flex-shrink-0">
      {/* Zoom controls */}
      {canZoom && (
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={handleZoomOut}
            disabled={zoom <= 50}
            className="flex items-center justify-center w-7 h-7 rounded-md text-white/60 hover:text-white hover:bg-white/8 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            aria-label="Zoom out"
          >
            <ZoomOut className="w-4 h-4" />
          </button>
          <span className="text-xs text-white/60 min-w-[3ch] text-center">
            {zoom}%
          </span>
          <button
            type="button"
            onClick={handleZoomIn}
            disabled={zoom >= 200}
            className="flex items-center justify-center w-7 h-7 rounded-md text-white/60 hover:text-white hover:bg-white/8 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            aria-label="Zoom in"
          >
            <ZoomIn className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Spacer if no zoom controls */}
      {!canZoom && <div />}

      {/* Document actions */}
      <div className="flex items-center gap-1">
        {!isPDF && content.content && (
          <>
            <button
              type="button"
              onClick={handleDownload}
              className="flex items-center justify-center w-7 h-7 rounded-md text-white/60 hover:text-white hover:bg-white/8 transition-colors"
              aria-label="Download file"
            >
              <Download className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={handlePrint}
              className="flex items-center justify-center w-7 h-7 rounded-md text-white/60 hover:text-white hover:bg-white/8 transition-colors"
              aria-label="Print"
            >
              <Printer className="w-4 h-4" />
            </button>
          </>
        )}
      </div>
    </div>
  )
}
