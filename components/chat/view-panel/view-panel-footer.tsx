/**
 * View Panel Footer
 *
 * Context-aware action buttons based on content type.
 */

'use client'

import { useViewPanel } from '@/lib/chat/view-panel-context'
import { ViewContentType } from '@/lib/chat/view-panel-types'
import { Copy, ExternalLink, FolderOpen } from 'lucide-react'

interface FooterButtonProps {
  children: React.ReactNode
  onClick: () => void
  primary?: boolean
  disabled?: boolean
}

function FooterButton({ children, onClick, primary, disabled }: FooterButtonProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`
        flex-1 flex items-center justify-center gap-1.5 py-2.5 px-3.5 rounded-lg
        text-[13px] font-medium
        transition-colors
        disabled:opacity-50 disabled:cursor-not-allowed
        ${primary
          ? 'bg-indigo-500/80 border-transparent text-white hover:bg-indigo-500'
          : 'bg-indigo-500/10 border border-indigo-500/30 text-indigo-300 hover:bg-indigo-500/20 hover:border-indigo-500/50'
        }
      `}
    >
      {children}
    </button>
  )
}

export function ViewPanelFooter() {
  const { state, closePanel, selectedItemsList } = useViewPanel()
  const { content } = state

  if (!content) return null

  const { type } = content

  // Action handlers
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

  const handleOpenFull = () => {
    // For PDFs, open in new tab
    if (content.filename) {
      window.open(content.filename, '_blank')
    }
  }

  const handleCopyAll = () => {
    if (content.content) {
      navigator.clipboard.writeText(content.content)
      // TODO: Show toast notification
    }
  }

  const handleEdit = () => {
    // Navigate to edit mode (no inline editing in view panel)
    // This would typically navigate to the full editor
    closePanel()
  }

  const handleOpenNote = () => {
    // Navigate to note in full view
    closePanel()
  }

  const handleOpenLinks = () => {
    const links = selectedItemsList.filter(i => i.type === 'link')
    if (links.length === 1) {
      const link = links[0]
      // Use existing navigation helpers
      if (link.entryId && link.workspaceId) {
        // Emit navigation event or use navigation context
        console.log('[ViewPanel] Navigate to:', link.entryId, link.workspaceId)
      }
    } else if (links.length > 1) {
      // Handle multiple selection - open first for now
      const link = links[0]
      if (link.entryId && link.workspaceId) {
        console.log('[ViewPanel] Navigate to:', link.entryId, link.workspaceId)
      }
    }
    closePanel()
  }

  const handleOpenSelected = () => {
    if (selectedItemsList.length === 1) {
      const item = selectedItemsList[0]
      if (item.entryId && item.workspaceId) {
        console.log('[ViewPanel] Navigate to:', item.entryId, item.workspaceId)
      } else if (item.filePath) {
        console.log('[ViewPanel] Open file:', item.filePath)
      }
    }
    closePanel()
  }

  return (
    <div className="flex gap-2 p-3 border-t border-white/6 flex-shrink-0">
      {type === ViewContentType.PDF && (
        <>
          <FooterButton onClick={handleDownload}>
            <Copy className="w-4 h-4" />
            Download
          </FooterButton>
          <FooterButton primary onClick={handleOpenFull}>
            <ExternalLink className="w-4 h-4" />
            Open Full
          </FooterButton>
        </>
      )}

      {(type === ViewContentType.TEXT || type === ViewContentType.CODE) && (
        <>
          <FooterButton onClick={handleCopyAll}>
            <Copy className="w-4 h-4" />
            Copy All
          </FooterButton>
          <FooterButton primary onClick={handleEdit}>
            <ExternalLink className="w-4 h-4" />
            Edit
          </FooterButton>
        </>
      )}

      {type === ViewContentType.NOTE && (
        <>
          <FooterButton onClick={closePanel}>
            Close
          </FooterButton>
          <FooterButton primary onClick={handleOpenNote}>
            <FolderOpen className="w-4 h-4" />
            Open Note
          </FooterButton>
        </>
      )}

      {type === ViewContentType.MIXED_LIST && (
        <>
          <FooterButton onClick={closePanel}>
            Cancel
          </FooterButton>
          <FooterButton
            primary
            onClick={handleOpenLinks}
            disabled={selectedItemsList.filter(i => i.type === 'link').length === 0}
          >
            <FolderOpen className="w-4 h-4" />
            Open Links ({selectedItemsList.filter(i => i.type === 'link').length})
          </FooterButton>
        </>
      )}

      {type === ViewContentType.LIST && (
        <>
          <FooterButton onClick={closePanel}>
            Cancel
          </FooterButton>
          <FooterButton
            primary
            onClick={handleOpenSelected}
            disabled={selectedItemsList.length === 0}
          >
            <FolderOpen className="w-4 h-4" />
            Open Selected ({selectedItemsList.length})
          </FooterButton>
        </>
      )}
    </div>
  )
}
