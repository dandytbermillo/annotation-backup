# Chat Universal View Panel Implementation Plan

> **Reference Demo**: `docs/proposal/components/workspace/ui/chat-slide-overlay-demo.html`
> **Related**: `chat-history-persistence-plan.md`

## Overview

Extend the chat navigation system with a **Universal View Panel** - a slide-in overlay that displays various content types (lists, documents, PDFs, rich notes, mixed Quick Links) without disturbing the chat conversation.

## Goals

1. Chat panel remains fixed and undisturbed when viewing content
2. View panel slides in from right edge (30% width, 320-560px bounds)
3. Support multiple content types with appropriate rendering and actions
4. Integrate with existing chat intent resolution system
5. Keep view panel state in memory during the session (optional persistence later)
6. Use TipTap/ProseMirror marks (annotation-style) to extract Quick Links without HTML parsing

## Non-Goals

- No inline editing of documents in view panel (v1)
- No real-time collaboration on viewed content
- No file upload via chat (future enhancement)
- PDF rendering is deferred; v1 opens PDFs externally

---

## Architecture

### Content Type System

```typescript
// lib/chat/view-panel-types.ts

export enum ViewContentType {
  LIST = 'list',                    // Search results, workspaces
  MIXED_LIST = 'mixed_list',        // Quick Links (links + plain text notes)
  TEXT = 'text',                    // Plain text files, markdown
  CODE = 'code',                    // Syntax-highlighted code files
  PDF = 'pdf',                      // PDF viewer (v1: open externally)
  NOTE = 'note',                    // Rich text note preview (TipTap rendered)
  IMAGE = 'image',                  // Image viewer (future)
}

export interface ViewPanelContent {
  type: ViewContentType;
  title: string;
  subtitle?: string;

  // For list types
  items?: ViewListItem[];

  // For document types
  filename?: string;
  content?: string;
  language?: string;      // For code files
  pageCount?: number;     // For PDFs
  pages?: PDFPage[];      // For PDFs

  // Metadata
  sourceIntent?: string;  // Original chat intent that triggered this
  sourceMessageId?: string;
}

export interface ViewListItem {
  id: string;
  name: string;
  type: 'link' | 'note' | 'entry' | 'workspace' | 'file';
  meta?: string;
  isSelectable?: boolean;  // false for plain text notes

  // Navigation data
  entryId?: string;
  workspaceId?: string;
  filePath?: string;
}

export interface PDFPage {
  pageNumber: number;
  title?: string;
  content: string;
}
```

### View Panel State Management

```typescript
// lib/chat/view-panel-context.tsx

import { createContext, useContext, useState, useCallback } from 'react';

interface ViewPanelState {
  isOpen: boolean;
  content: ViewPanelContent | null;
  selectedItems: Set<string>;
  zoom: number;  // 50-200, for document types
  searchQuery: string;  // For list filtering
}

interface ViewPanelContextValue {
  state: ViewPanelState;

  // Actions
  openPanel: (content: ViewPanelContent) => void;
  closePanel: () => void;
  toggleItemSelection: (itemId: string) => void;
  clearSelection: () => void;
  setZoom: (zoom: number) => void;
  setSearchQuery: (query: string) => void;

  // Derived
  filteredItems: ViewListItem[];
  selectedItemsList: ViewListItem[];
}

const defaultState: ViewPanelState = {
  isOpen: false,
  content: null,
  selectedItems: new Set(),
  zoom: 100,
  searchQuery: '',
};

// Note: View panel state is session-only. Optional persistence (localStorage) is future work.

export const ViewPanelContext = createContext<ViewPanelContextValue | null>(null);

export function ViewPanelProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<ViewPanelState>(defaultState);

  const openPanel = useCallback((content: ViewPanelContent) => {
    setState({
      isOpen: true,
      content,
      selectedItems: new Set(),
      zoom: 100,
      searchQuery: '',
    });
  }, []);

  const closePanel = useCallback(() => {
    setState(prev => ({ ...prev, isOpen: false }));
  }, []);

  const toggleItemSelection = useCallback((itemId: string) => {
    setState(prev => {
      const newSelected = new Set(prev.selectedItems);
      if (newSelected.has(itemId)) {
        newSelected.delete(itemId);
      } else {
        newSelected.add(itemId);
      }
      return { ...prev, selectedItems: newSelected };
    });
  }, []);

  const clearSelection = useCallback(() => {
    setState(prev => ({ ...prev, selectedItems: new Set() }));
  }, []);

  const setZoom = useCallback((zoom: number) => {
    setState(prev => ({ ...prev, zoom: Math.max(50, Math.min(200, zoom)) }));
  }, []);

  const setSearchQuery = useCallback((query: string) => {
    setState(prev => ({ ...prev, searchQuery: query }));
  }, []);

  // Derived state
  const filteredItems = state.content?.items?.filter(item =>
    item.name.toLowerCase().includes(state.searchQuery.toLowerCase())
  ) ?? [];

  const selectedItemsList = state.content?.items?.filter(item =>
    state.selectedItems.has(item.id)
  ) ?? [];

  return (
    <ViewPanelContext.Provider value={{
      state,
      openPanel,
      closePanel,
      toggleItemSelection,
      clearSelection,
      setZoom,
      setSearchQuery,
      filteredItems,
      selectedItemsList,
    }}>
      {children}
    </ViewPanelContext.Provider>
  );
}

export function useViewPanel() {
  const context = useContext(ViewPanelContext);
  if (!context) {
    throw new Error('useViewPanel must be used within ViewPanelProvider');
  }
  return context;
}
```

---

## Component Structure

### View Panel Component

```
components/chat/
├── view-panel/
│   ├── index.tsx                    # Main ViewPanel component
│   ├── view-panel-header.tsx        # Title, subtitle, close button
│   ├── view-panel-toolbar.tsx       # Zoom, download, print (documents)
│   ├── view-panel-search.tsx        # Filter bar (lists)
│   ├── view-panel-content.tsx       # Content router
│   ├── view-panel-footer.tsx        # Context-aware action buttons
│   ├── renderers/
│   │   ├── list-renderer.tsx        # Standard selectable list
│   │   ├── mixed-list-renderer.tsx  # Links + plain text notes
│   │   ├── text-renderer.tsx        # Plain text/markdown
│   │   ├── code-renderer.tsx        # Syntax-highlighted code
│   │   ├── pdf-renderer.tsx         # optional (if PDF renderer added)
│   │   └── note-renderer.tsx        # Rich text (TipTap output)
│   └── styles.ts                    # Shared styles/classes
```

### Main ViewPanel Component

```typescript
// components/chat/view-panel/index.tsx

'use client';

import { useViewPanel } from '@/lib/chat/view-panel-context';
import { ViewPanelHeader } from './view-panel-header';
import { ViewPanelToolbar } from './view-panel-toolbar';
import { ViewPanelSearch } from './view-panel-search';
import { ViewPanelContent } from './view-panel-content';
import { ViewPanelFooter } from './view-panel-footer';
import { ViewContentType } from '@/lib/chat/view-panel-types';
import { useEffect } from 'react';

export function ViewPanel() {
  const { state, closePanel } = useViewPanel();
  const { isOpen, content } = state;

  // Escape key handler
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        closePanel();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, closePanel]);

  const isListType = content?.type === ViewContentType.LIST ||
                     content?.type === ViewContentType.MIXED_LIST;
  const isDocType = content?.type === ViewContentType.TEXT ||
                    content?.type === ViewContentType.CODE ||
                    content?.type === ViewContentType.PDF ||
                    content?.type === ViewContentType.NOTE;

  return (
    <>
      {/* Backdrop */}
      <div
        className={`
          fixed inset-0 bg-black/20 z-[300]
          transition-opacity duration-200 ease-out
          ${isOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}
        `}
        onClick={closePanel}
      />

      {/* Panel */}
      <div
        className={`
          fixed top-0 right-0 bottom-0
          w-[30%] min-w-[320px] max-w-[560px]
          bg-slate-950/98 backdrop-blur-xl
          border-l border-white/8
          shadow-[-8px_0_32px_rgba(0,0,0,0.4)]
          z-[400]
          flex flex-col
          transition-transform duration-250 ease-[cubic-bezier(0.4,0,0.2,1)]
          ${isOpen ? 'translate-x-0' : 'translate-x-full'}
        `}
      >
        <ViewPanelHeader />

        {isDocType && <ViewPanelToolbar />}
        {isListType && <ViewPanelSearch />}
        {isListType && <ViewPanelStats />}

        <ViewPanelContent />

        <ViewPanelFooter />
      </div>
    </>
  );
}

function ViewPanelStats() {
  const { state, filteredItems } = useViewPanel();
  const count = filteredItems.length;
  const query = state.searchQuery;

  return (
    <div className="flex items-center justify-between px-4 py-2 text-xs text-white/50 border-b border-white/4">
      <span>
        {count} item{count !== 1 ? 's' : ''}
        {query && ` matching "${query}"`}
      </span>
      <span>
        Press <kbd className="px-1.5 py-0.5 bg-white/10 rounded text-[10px] font-mono">Esc</kbd> to close
      </span>
    </div>
  );
}
```

### Mixed List Renderer (Quick Links with links + notes)

```typescript
// components/chat/view-panel/renderers/mixed-list-renderer.tsx

'use client';

import { useViewPanel } from '@/lib/chat/view-panel-context';
import { ViewListItem } from '@/lib/chat/view-panel-types';
import { FileText, Edit3, ChevronRight, Check } from 'lucide-react';

export function MixedListRenderer() {
  const { filteredItems, state, toggleItemSelection } = useViewPanel();

  return (
    <div className="flex flex-col gap-2">
      {filteredItems.map((item) => (
        <MixedListItem
          key={item.id}
          item={item}
          isSelected={state.selectedItems.has(item.id)}
          onToggle={() => toggleItemSelection(item.id)}
        />
      ))}
    </div>
  );
}

interface MixedListItemProps {
  item: ViewListItem;
  isSelected: boolean;
  onToggle: () => void;
}

function MixedListItem({ item, isSelected, onToggle }: MixedListItemProps) {
  const isNote = item.type === 'note';

  return (
    <div
      className={`
        flex items-center justify-between
        px-3.5 py-3 rounded-xl
        border transition-all duration-150
        ${isNote
          ? 'border-l-[3px] border-l-amber-500/50 border-t-white/6 border-r-white/6 border-b-white/6 bg-white/3 cursor-default'
          : isSelected
            ? 'border-indigo-500/40 bg-indigo-500/15 cursor-pointer'
            : 'border-white/6 bg-white/3 hover:border-indigo-500/30 hover:bg-indigo-500/10 cursor-pointer'
        }
      `}
      onClick={isNote ? undefined : onToggle}
    >
      <div className="flex items-center gap-3 flex-1 min-w-0">
        {/* Checkbox (only for links) */}
        {!isNote && (
          <div className={`
            w-[18px] h-[18px] rounded-[5px] border-2 flex-shrink-0
            flex items-center justify-center transition-all
            ${isSelected
              ? 'bg-indigo-500 border-indigo-500'
              : 'border-white/20 bg-transparent'
            }
          `}>
            {isSelected && <Check className="w-3 h-3 text-white" strokeWidth={3} />}
          </div>
        )}

        {/* Icon */}
        {isNote ? (
          <Edit3 className="w-[18px] h-[18px] text-amber-400 flex-shrink-0" />
        ) : (
          <FileText className="w-[18px] h-[18px] text-white/50 flex-shrink-0" />
        )}

        {/* Content */}
        <div className="flex flex-col gap-0.5 min-w-0">
          <span className="text-[13px] font-medium text-white/90 truncate">
            {item.name}
          </span>
          <div className="flex items-center gap-2">
            <span className={`
              text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded
              ${isNote
                ? 'bg-amber-500/20 text-amber-400'
                : 'bg-indigo-500/20 text-indigo-300'
              }
            `}>
              {isNote ? 'Note' : 'Link'}
            </span>
            {item.meta && (
              <span className="text-[11px] text-white/50">{item.meta}</span>
            )}
          </div>
        </div>
      </div>

      {/* Arrow (only for links) */}
      {!isNote && (
        <ChevronRight className={`
          w-4 h-4 text-white/30 flex-shrink-0 transition-all
          group-hover:translate-x-0.5 group-hover:text-indigo-400
        `} />
      )}
    </div>
  );
}
```

---

## Intent Resolution Integration

Extend the existing intent resolver to handle view panel content:

```typescript
// lib/chat/intent-resolver.ts (additions)

import { ViewContentType, ViewPanelContent, ViewListItem } from './view-panel-types';

export interface IntentResolution {
  // ... existing fields

  // New: View panel content
  viewPanelContent?: ViewPanelContent;
  showInViewPanel?: boolean;  // true if content should open in view panel
}

// Content type detection based on intent
function getViewContentForIntent(
  intent: ResolvedIntent,
  data: unknown
): ViewPanelContent | null {
  switch (intent.type) {
    case 'show_quick_links':
      return buildQuickLinksContent(intent.panelId, data as QuickLinkItem[]);

    case 'search_results':
      return buildSearchResultsContent(intent.query, data as SearchResult[]);

    case 'show_workspaces':
      return buildWorkspacesContent(data as Workspace[]);

    case 'preview_file':
      return buildFilePreviewContent(intent.filePath, data as FileContent);

    case 'preview_note':
      return buildNotePreviewContent(intent.noteId, data as NoteContent);

    default:
      return null;
  }
}

function buildQuickLinksContent(
  panelId: string,
  items: QuickLinkItem[]
): ViewPanelContent {
  const viewItems: ViewListItem[] = items.map((item, index) => {
    if (item.type === 'link') {
      return {
        id: item.attrs.workspaceId || `link-${index}`,
        name: item.attrs.workspaceName || 'Workspace',
        type: 'link',
        meta: item.attrs.entryName || undefined,
        isSelectable: true,
        entryId: item.attrs.entryId,
        workspaceId: item.attrs.workspaceId,
      };
    }
    return {
      id: `note-${index}`,
      name: item.text,
      type: 'note',
      isSelectable: false,
    };
  });

  const linkCount = viewItems.filter(i => i.type === 'link').length;
  const noteCount = viewItems.filter(i => i.type === 'note').length;

  return {
    type: ViewContentType.MIXED_LIST,
    title: `Quick Links ${panelId}`,
    subtitle: `${linkCount} links • ${noteCount} notes`,
    items: viewItems,
  };
}

function buildFilePreviewContent(
  filePath: string,
  fileData: FileContent
): ViewPanelContent {
  const ext = filePath.split('.').pop()?.toLowerCase() || '';

  // Determine content type based on extension
  let type: ViewContentType;
  let language: string | undefined;

  if (['ts', 'tsx', 'js', 'jsx', 'py', 'go', 'rs', 'java', 'c', 'cpp'].includes(ext)) {
    type = ViewContentType.CODE;
    language = ext;
  } else if (ext === 'pdf') {
    type = ViewContentType.PDF; // v1: open externally (no inline rendering)
  } else if (['md', 'txt', 'json', 'yaml', 'yml'].includes(ext)) {
    type = ViewContentType.TEXT;
  } else {
    type = ViewContentType.TEXT;
  }

  return {
    type,
    title: filePath.split('/').pop() || filePath,
    subtitle: type === ViewContentType.CODE
      ? `${language} • ${fileData.lineCount} lines`
      : `${fileData.size} bytes`,
    filename: filePath,
    content: fileData.content,
    language,
  };
}

// Types (Quick Links items can be links or plain text notes)
type QuickLinkItem =
  | { type: 'link'; attrs: QuickLinkAttributes }
  | { type: 'note'; text: string };

// Placeholder builders (implement in Phase 3)
function buildSearchResultsContent(query: string, results: SearchResult[]): ViewPanelContent {
  return {
    type: ViewContentType.LIST,
    title: `Results for "${query}"`,
    items: results.map(r => ({ id: r.id, name: r.title, type: r.type, meta: r.meta })),
  };
}

function buildWorkspacesContent(workspaces: Workspace[]): ViewPanelContent {
  return {
    type: ViewContentType.LIST,
    title: 'Workspaces',
    items: workspaces.map(w => ({ id: w.id, name: w.name, type: 'workspace', entryId: w.entryId })),
  };
}

function buildNotePreviewContent(noteId: string, note: NoteContent): ViewPanelContent {
  return {
    type: ViewContentType.NOTE,
    title: note.title || 'Note',
    content: note.html,
  };
}
```

---

## API Endpoints

### Get Quick Links Panel Content (reuse existing panels API)

```typescript
// Use existing panels API:
// GET /api/dashboard/panels?workspaceId=...&includeHidden=true
//
// 1) Filter panels where panel_type in ('links_note', 'links_note_tiptap').
// 2) Read panel.config.contentJson (TipTap JSON).
// 3) Parse Quick Links marks to extract QuickLinkAttributes (annotation-style):
//    - workspaceId, workspaceName, entryId, entryName, dashboardId
//
// No new tables required.
```

#### TipTap Content Parsing Note
- Recommended: parse TipTap JSON and extract the `quickLinksLink` mark attributes
- This mirrors the annotation approach (marks are first-class in ProseMirror JSON).
- Expected attributes to extract (per `QuickLinkAttributes`):
  - `workspaceId`, `workspaceName`
  - `entryId`, `entryName`
  - `dashboardId` (optional)

Example utility (JSON content only):
```typescript
// lib/chat/parse-quick-links.ts
import type { JSONContent } from '@tiptap/core';
import type { QuickLinkAttributes } from '@/lib/extensions/quick-links';

type QuickLinkItem =
  | { type: 'link'; attrs: QuickLinkAttributes }
  | { type: 'note'; text: string };

export function parseQuickLinksContent(content: JSONContent): QuickLinkItem[] {
  const links: QuickLinkItem[] = [];
  walk(content, (node) => {
    if (node.marks) {
      const mark = node.marks.find((m: any) => m.type === 'quickLinksLink');
      if (mark?.attrs?.workspaceId && mark?.attrs?.entryId) {
        links.push({
          type: 'link',
          attrs: {
            workspaceId: mark.attrs.workspaceId,
            workspaceName: mark.attrs.workspaceName || '',
            entryId: mark.attrs.entryId,
            entryName: mark.attrs.entryName || '',
            dashboardId: mark.attrs.dashboardId,
          },
        });
      }
    }
    if (node.type === 'paragraph' && node.content) {
      const text = node.content
        .filter((child: any) => child.type === 'text' && !child.marks)
        .map((child: any) => child.text || '')
        .join('')
        .trim();
      if (text) {
        links.push({ type: 'note', text });
      }
    }
  });
  return links;
}

function walk(node: any, fn: (node: any) => void) {
  fn(node);
  if (node.content) {
    node.content.forEach((child: any) => walk(child, fn));
  }
}
```

### Get File Preview

```typescript
// app/api/chat/preview/file/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { readFile } from 'fs/promises';
import path from 'path';

const ALLOWED_EXTENSIONS = ['md', 'txt', 'ts', 'tsx', 'js', 'jsx', 'json', 'yaml', 'yml'];
const MAX_FILE_SIZE = 500 * 1024; // 500KB limit

export async function GET(request: NextRequest) {
  const filePath = request.nextUrl.searchParams.get('path');

  if (!filePath) {
    return NextResponse.json({ error: 'path required' }, { status: 400 });
  }

  // Security: validate path
  const ext = path.extname(filePath).slice(1).toLowerCase();
  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    return NextResponse.json({ error: 'File type not supported' }, { status: 400 });
  }

  // Prevent path traversal: enforce allowlist
  const resolvedPath = path.resolve(filePath);
  // Replace with explicit allowlist roots (example below)
  const ALLOWED_DIRS = [
    path.join(process.cwd(), 'docs'),
    path.join(process.cwd(), 'codex'),
  ];
  const normalized = path.normalize(resolvedPath);
  if (!ALLOWED_DIRS.some((dir) => normalized.startsWith(dir))) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 });
  }

  try {
    const content = await readFile(resolvedPath, 'utf-8');
    const lines = content.split('\n');

    return NextResponse.json({
      content: content.slice(0, MAX_FILE_SIZE),
      lineCount: lines.length,
      size: content.length,
      truncated: content.length > MAX_FILE_SIZE,
    });
  } catch (error) {
    return NextResponse.json({ error: 'File not found' }, { status: 404 });
  }
}
```

> PDF files: open externally (download or new tab) unless a PDF renderer is added.

---

## Chat Message Integration

### Result Preview in Chat Messages

```typescript
// components/chat/message-result-preview.tsx

'use client';

import { useViewPanel } from '@/lib/chat/view-panel-context';
import { ViewPanelContent, ViewListItem } from '@/lib/chat/view-panel-types';
import { ChevronRight, Search, FileText, Edit3 } from 'lucide-react';

interface MessageResultPreviewProps {
  title: string;
  previewItems: ViewListItem[];
  totalCount: number;
  fullContent: ViewPanelContent;
}

export function MessageResultPreview({
  title,
  previewItems,
  totalCount,
  fullContent,
}: MessageResultPreviewProps) {
  const { openPanel } = useViewPanel();
  const moreCount = totalCount - previewItems.length;

  return (
    <div className="mt-2.5 bg-black/30 rounded-xl p-3 border border-white/6">
      <div className="flex items-center gap-1.5 text-xs font-semibold text-indigo-300 mb-2">
        <Search className="w-3 h-3" />
        {title}
      </div>

      <div className="flex flex-col gap-1.5">
        {previewItems.map((item) => (
          <PreviewItem key={item.id} item={item} />
        ))}

        {moreCount > 0 && (
          <div className="text-[11px] text-white/40 py-1">
            ...and {moreCount} more
          </div>
        )}
      </div>

      <button
        onClick={() => openPanel(fullContent)}
        className="
          flex items-center justify-center gap-1.5 w-full
          mt-2.5 py-2 px-3.5 rounded-lg
          bg-indigo-500/15 border border-indigo-500/30
          text-indigo-300 text-xs font-medium
          hover:bg-indigo-500/25 hover:border-indigo-500/50
          transition-colors
        "
      >
        <ChevronRight className="w-3.5 h-3.5" />
        Show all {totalCount} →
      </button>
    </div>
  );
}

function PreviewItem({ item }: { item: ViewListItem }) {
  const isNote = item.type === 'note';

  return (
    <div className={`
      flex items-center gap-2 px-2.5 py-1.5 rounded-md text-xs
      ${isNote
        ? 'bg-white/4 text-white/60 cursor-default'
        : 'bg-white/4 text-white/80 hover:bg-indigo-500/15 hover:text-indigo-200 cursor-pointer'
      }
      transition-colors
    `}>
      {isNote ? (
        <Edit3 className="w-3.5 h-3.5 text-amber-400" />
      ) : (
        <FileText className="w-3.5 h-3.5 text-white/50" />
      )}
      <span className="truncate">{item.name}</span>
    </div>
  );
}
```

---

## Footer Actions by Content Type

```typescript
// components/chat/view-panel/view-panel-footer.tsx

'use client';

import { useViewPanel } from '@/lib/chat/view-panel-context';
import { ViewContentType } from '@/lib/chat/view-panel-types';

export function ViewPanelFooter() {
  const { state, closePanel, selectedItemsList } = useViewPanel();

  if (!state.content) return null;

  const { type } = state.content;

  return (
    <div className="flex gap-2 p-3 border-t border-white/6">
      {type === ViewContentType.PDF && (
        <>
          <FooterButton onClick={() => handleDownload()}>
            Download
          </FooterButton>
          <FooterButton primary onClick={() => handleOpenFull()}>
            Open Full
          </FooterButton>
        </>
      )}

      {(type === ViewContentType.TEXT || type === ViewContentType.CODE) && (
        <>
          <FooterButton onClick={() => handleCopyAll()}>
            Copy All
          </FooterButton>
          <FooterButton primary onClick={() => handleEdit()}>
            Edit
          </FooterButton>
        </>
      )}

      {type === ViewContentType.NOTE && (
        <>
          <FooterButton onClick={closePanel}>
            Close
          </FooterButton>
          <FooterButton primary onClick={() => handleOpenNote()}>
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
            onClick={() => handleOpenLinks()}
            disabled={selectedItemsList.filter(i => i.type === 'link').length === 0}
          >
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
            onClick={() => handleOpenSelected()}
            disabled={selectedItemsList.length === 0}
          >
            Open Selected ({selectedItemsList.length})
          </FooterButton>
        </>
      )}
    </div>
  );

  // Action handlers
  function handleDownload() {
    // Trigger file download
  }

  function handleOpenFull() {
    // Open in new tab/window
  }

  function handleCopyAll() {
    navigator.clipboard.writeText(state.content?.content || '');
    // Show toast
  }

  function handleEdit() {
    // Open full editor (no inline editing in view panel)
  }

  function handleOpenNote() {
    // Navigate to note
  }

  function handleOpenLinks() {
    const links = selectedItemsList.filter(i => i.type === 'link');
    if (links.length === 1) {
      const link = links[0];
      openEntryWorkspace(link.entryId, link.workspaceId);
    } else {
      // Handle multiple selection
    }
    closePanel();
  }

  function handleOpenSelected() {
    // Navigate to selected items
    closePanel();
  }

  function openEntryWorkspace(entryId?: string, workspaceId?: string) {
    if (!entryId || !workspaceId) return;
    // Use existing navigation helpers (entry/workspace context + view switch)
    // Example: setActiveEntryContext(entryId); setActiveWorkspaceContext(workspaceId);
  }
}

interface FooterButtonProps {
  children: React.ReactNode;
  onClick: () => void;
  primary?: boolean;
  disabled?: boolean;
}

function FooterButton({ children, onClick, primary, disabled }: FooterButtonProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`
        flex-1 py-2.5 px-3.5 rounded-lg
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
  );
}
```

---

## Storage Notes

- Reuse existing `workspace_panels` records; add `panel.config.contentJson` for TipTap JSON.
- Persist JSON alongside HTML when saving Quick Links (annotation-style mark extraction).
- Parse Quick Links marks from JSON at runtime; no new tables required for v1.

---

## Integration with Chat Navigation Context

```typescript
// lib/chat/chat-navigation-context.tsx (additions)

import { ViewPanelProvider, useViewPanel } from './view-panel-context';

// Wrap ChatNavigationProvider with ViewPanelProvider
export function ChatNavigationProvider({ children }: { children: React.ReactNode }) {
  return (
    <ViewPanelProvider>
      <ChatNavigationContextInner>
        {children}
      </ChatNavigationContextInner>
    </ViewPanelProvider>
  );
}

// In the chat submission handler, check for view panel content:
async function handleChatSubmit(message: string) {
  const response = await resolveIntent(message);

  if (response.viewPanelContent && response.showInViewPanel) {
    openPanel(response.viewPanelContent);
  }

  // ... rest of handling
}
```

---

## Implementation Notes (Decisions to Lock)

- **Quick Links JSON persistence**: Store TipTap JSON in `panel.config.contentJson` (or replace content) so parsing is mark-based like annotations.
- **Migration**: Decide how to handle existing panels that only have HTML (lazy backfill on save vs one-time migration).
- **File preview allowlist**: Define an explicit allowed root (e.g., repo root + docs/), and reject paths outside it.
- **PDF external open**: Decide exact behavior (download vs open in new tab) and the URL/asset path used.
- **Note preview source**: Specify how note content is fetched and rendered (TipTap JSON to HTML renderer vs stored HTML).
- **Code rendering**: Pick the renderer (plain `<pre>`, or a library like `shiki`/`prism`) and document that choice.
- **Navigation helpers**: Identify the exact entry/workspace navigation functions to call from ViewPanel footer actions.

## Testing Plan

### Unit Tests

```typescript
// __tests__/view-panel-context.test.tsx

describe('ViewPanelContext', () => {
  it('opens panel with content', () => {
    const { result } = renderHook(() => useViewPanel(), {
      wrapper: ViewPanelProvider,
    });

    act(() => {
      result.current.openPanel({
        type: ViewContentType.LIST,
        title: 'Test',
        items: [{ id: '1', name: 'Item 1', type: 'entry' }],
      });
    });

    expect(result.current.state.isOpen).toBe(true);
    expect(result.current.state.content?.title).toBe('Test');
  });

  it('filters items by search query', () => {
    const { result } = renderHook(() => useViewPanel(), {
      wrapper: ViewPanelProvider,
    });

    act(() => {
      result.current.openPanel({
        type: ViewContentType.LIST,
        title: 'Test',
        items: [
          { id: '1', name: 'Apple', type: 'entry' },
          { id: '2', name: 'Banana', type: 'entry' },
        ],
      });
      result.current.setSearchQuery('app');
    });

    expect(result.current.filteredItems).toHaveLength(1);
    expect(result.current.filteredItems[0].name).toBe('Apple');
  });

  it('handles mixed list selection correctly', () => {
    const { result } = renderHook(() => useViewPanel(), {
      wrapper: ViewPanelProvider,
    });

    act(() => {
      result.current.openPanel({
        type: ViewContentType.MIXED_LIST,
        title: 'Quick Links',
        items: [
          { id: '1', name: 'Link 1', type: 'link', isSelectable: true },
          { id: '2', name: 'Note 1', type: 'note', isSelectable: false },
        ],
      });
      result.current.toggleItemSelection('1');
    });

    expect(result.current.state.selectedItems.has('1')).toBe(true);
    expect(result.current.selectedItemsList).toHaveLength(1);
  });
});
```

### E2E Tests

```typescript
// e2e/view-panel.spec.ts

import { test, expect } from '@playwright/test';

test.describe('View Panel', () => {
  test('opens from chat message and displays list', async ({ page }) => {
    await page.goto('/dashboard');

    // Type chat message
    await page.fill('[data-testid="chat-input"]', 'show quick links A');
    await page.press('[data-testid="chat-input"]', 'Enter');

    // Wait for response with "Show all" button
    await page.waitForSelector('text=Show all');
    await page.click('text=Show all');

    // View panel should be open
    await expect(page.locator('[data-testid="view-panel"]')).toBeVisible();
    await expect(page.locator('[data-testid="view-panel-title"]')).toContainText('Quick Links A');
  });

  test('closes on Escape key', async ({ page }) => {
    // ... setup
    await page.press('body', 'Escape');
    await expect(page.locator('[data-testid="view-panel"]')).not.toBeVisible();
  });

  test('filters list items', async ({ page }) => {
    // ... setup panel with items
    await page.fill('[data-testid="view-panel-search"]', 'budget');

    const items = await page.locator('[data-testid="view-list-item"]').count();
    expect(items).toBe(1); // Only matching item
  });

  test('differentiates links and notes in mixed list', async ({ page }) => {
    // ... setup with mixed list

    // Notes should have note badge
    const noteBadges = await page.locator('.type-badge.note').count();
    expect(noteBadges).toBeGreaterThan(0);

    // Notes should not be selectable
    const noteItem = page.locator('[data-type="note"]').first();
    await noteItem.click();
    await expect(noteItem).not.toHaveClass(/selected/);
  });
});
```

---

## Acceptance Criteria

### Core Functionality
- [ ] View panel slides in from right edge with 250ms animation
- [ ] Backdrop dims (0.2 opacity) without full-screen blur
- [ ] Panel width is 30% with 320px min and 560px max
- [ ] Escape key closes panel
- [ ] Clicking backdrop closes panel

### Content Types
- [ ] LIST: Displays selectable items with checkboxes
- [ ] MIXED_LIST: Differentiates links (selectable) from notes (non-selectable, yellow accent)
- [ ] TEXT: Renders plain text with monospace font
- [ ] CODE: Syntax highlighting with line numbers
- [ ] PDF: Opens externally (no inline rendering in v1)
- [ ] NOTE: Rich text preview with TipTap output

### Search & Filter
- [ ] Search bar appears only for list types
- [ ] Filter updates item count in stats bar
- [ ] Filter is case-insensitive

### Actions
- [ ] Footer buttons change based on content type
- [ ] Multi-select works for links in mixed list
- [ ] "Open Selected" navigates to selected items
- [ ] Zoom controls work for text/code (if enabled)

### Integration
- [ ] Chat messages show result preview with "Show all" button
- [ ] Intent resolver creates correct ViewPanelContent
- [ ] View panel state persists during session

---

## File Locations Summary

```
lib/chat/
├── view-panel-types.ts           # Type definitions
├── view-panel-context.tsx        # State management
├── intent-resolver.ts            # (modified) Add view panel content
└── chat-navigation-context.tsx   # (modified) Integrate ViewPanelProvider

components/chat/
├── view-panel/
│   ├── index.tsx
│   ├── view-panel-header.tsx
│   ├── view-panel-toolbar.tsx
│   ├── view-panel-search.tsx
│   ├── view-panel-content.tsx
│   ├── view-panel-footer.tsx
│   └── renderers/
│       ├── list-renderer.tsx
│       ├── mixed-list-renderer.tsx
│       ├── text-renderer.tsx
│       ├── code-renderer.tsx
│       ├── pdf-renderer.tsx        # optional (if PDF renderer added)
│       └── note-renderer.tsx
├── message-result-preview.tsx    # Preview in chat messages
└── chat-navigation-panel.tsx     # (modified) Include ViewPanel

app/api/chat/
└── preview/file/route.ts

app/api/dashboard/
└── panels/route.ts               # existing panels API (reused)
```

---

## Implementation Order

1. **Phase 1: Core View Panel** (Week 1)
   - Type definitions
   - ViewPanelContext
   - Basic ViewPanel component with backdrop
   - List renderer

2. **Phase 2: Content Renderers** (Week 2)
   - Mixed list renderer (links + notes)
   - Text/code renderer
   - Note preview renderer
   - Footer actions

3. **Phase 3: Chat Integration** (Week 3)
   - Intent resolver extensions
   - MessageResultPreview component
   - Reuse dashboard panels API for Quick Links

4. **Phase 4: Document Types** (Week 4)
   - PDF: open externally (no inline renderer unless added)
   - Zoom/toolbar controls (text/code only)
   - File preview API

5. **Phase 5: Testing & Polish** (Week 5)
   - Unit tests
   - E2E tests
   - Animation refinements
   - Accessibility audit
