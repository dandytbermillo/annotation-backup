/**
 * Chat Universal View Panel Types
 *
 * Type definitions for the view panel that displays various content types
 * (lists, documents, PDFs, rich notes, mixed Quick Links) in a slide-in overlay.
 */

// =============================================================================
// Content Types
// =============================================================================

export enum ViewContentType {
  LIST = 'list',                    // Search results, workspaces
  MIXED_LIST = 'mixed_list',        // Quick Links (links + plain text notes)
  TEXT = 'text',                    // Plain text files, markdown
  CODE = 'code',                    // Syntax-highlighted code files
  PDF = 'pdf',                      // PDF viewer (v1: open externally)
  NOTE = 'note',                    // Rich text note preview (TipTap rendered)
  IMAGE = 'image',                  // Image viewer (future)
}

// =============================================================================
// List Item Types
// =============================================================================

export interface ViewListItem {
  id: string
  name: string
  type: 'link' | 'note' | 'entry' | 'workspace' | 'file'
  meta?: string
  isSelectable?: boolean  // false for plain text notes in Quick Links

  // Navigation data
  entryId?: string
  workspaceId?: string
  dashboardId?: string
  filePath?: string
}

// =============================================================================
// PDF Types
// =============================================================================

export interface PDFPage {
  pageNumber: number
  title?: string
  content: string
}

// =============================================================================
// Main Content Interface
// =============================================================================

export interface ViewPanelContent {
  type: ViewContentType
  title: string
  subtitle?: string

  // For list types
  items?: ViewListItem[]

  // For document types
  filename?: string
  content?: string
  language?: string      // For code files
  pageCount?: number     // For PDFs
  pages?: PDFPage[]      // For PDFs

  // Metadata
  sourceIntent?: string  // Original chat intent that triggered this
  sourceMessageId?: string
}

// =============================================================================
// Quick Links Parsing Types
// =============================================================================

export interface QuickLinkAttributes {
  workspaceId: string
  workspaceName: string
  entryId: string
  entryName: string
  dashboardId?: string
}

export type QuickLinkItem =
  | { type: 'link'; attrs: QuickLinkAttributes }
  | { type: 'note'; text: string }

// =============================================================================
// File Content Types
// =============================================================================

export interface FileContent {
  content: string
  lineCount: number
  size: number
  truncated: boolean
}

// =============================================================================
// View Panel State
// =============================================================================

export interface ViewPanelState {
  isOpen: boolean
  content: ViewPanelContent | null
  selectedItems: Set<string>
  zoom: number  // 50-200, for document types
  searchQuery: string  // For list filtering
}

// =============================================================================
// View Panel Context Value
// =============================================================================

export interface ViewPanelContextValue {
  state: ViewPanelState

  // Actions
  openPanel: (content: ViewPanelContent) => void
  closePanel: () => void
  updateContent: (content: ViewPanelContent) => void  // For async content updates
  toggleItemSelection: (itemId: string) => void
  clearSelection: () => void
  setZoom: (zoom: number) => void
  setSearchQuery: (query: string) => void

  // Derived
  filteredItems: ViewListItem[]
  selectedItemsList: ViewListItem[]
}
