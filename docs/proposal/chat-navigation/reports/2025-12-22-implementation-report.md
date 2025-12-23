# Chat Navigation Implementation Report

**Date:** 2025-12-22
**Feature Slug:** `chat-navigation`
**Status:** Complete (Phases 1-4)

---

## Summary

Implemented an LLM-powered natural language navigation system that allows users to navigate workspaces and notes using conversational commands. The feature uses OpenAI's GPT-4o-mini (configurable) to parse user intent and resolve it to actionable navigation.

### Supported Commands

| Intent | Example Commands |
|--------|------------------|
| Open Workspace | "open workspace Research", "go to dashboard" |
| Open Recent Workspace | "open my recent workspace", "go to last workspace" |
| Open Note | "open note Project Plan", "find note Roadmap" |
| Create Workspace | "create workspace Sprint 12", "new workspace" |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         Phase 4: Chat UI                                │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │  ChatNavigationPanel (components/chat/chat-navigation-panel.tsx)  │  │
│  │  - Input field for natural language commands                      │  │
│  │  - Message display with user/assistant roles                      │  │
│  │  - Selection pills for disambiguation                             │  │
│  └───────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                    Phase 3: Action Execution                            │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │  useChatNavigation (lib/chat/use-chat-navigation.ts)              │  │
│  │  - executeAction(resolution) → Routes to handlers                 │  │
│  │  - navigateToWorkspace() → setActiveEntryContext + workspace      │  │
│  │  - navigateToNote() → Dispatches 'chat-navigate-note' event       │  │
│  │  - createWorkspace() → POST /api/note-workspaces                  │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │  useChatNavigationListener (lib/chat/use-chat-navigation-listener)│  │
│  │  - Listens for 'chat-navigate-note' events                        │  │
│  │  - Opens notes via workspace.openNote()                           │  │
│  └───────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                 Phase 2: Data Resolution Layer                          │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │  POST /api/chat/navigate (app/api/chat/navigate/route.ts)         │  │
│  │  - Calls OpenAI to parse intent                                   │  │
│  │  - Resolves intent to actionable data                             │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│  ┌─────────────────────┐  ┌─────────────────────┐  ┌─────────────────┐  │
│  │  intent-resolver.ts │  │ workspace-resolver  │  │  note-resolver  │  │
│  │  Main orchestrator  │  │ Resolves workspace  │  │ Resolves note   │  │
│  │                     │  │ names to IDs        │  │ titles to IDs   │  │
│  └─────────────────────┘  └─────────────────────┘  └─────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                   Phase 1: LLM Intent Interface                         │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │  intent-prompt.ts - System prompt for intent classification       │  │
│  │  intent-schema.ts - Zod schema for structured JSON output         │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │  OpenAI GPT-4o-mini                                               │  │
│  │  - temperature: 0 (deterministic)                                 │  │
│  │  - max_tokens: 150                                                │  │
│  │  - response_format: json_object                                   │  │
│  └───────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Files Created

### Phase 1: LLM Intent Interface

| File | Purpose |
|------|---------|
| `lib/chat/intent-prompt.ts` | System prompt for intent classification |
| `lib/chat/intent-schema.ts` | Zod schema for structured JSON output |
| `app/api/chat/intent/route.ts` | API endpoint for intent parsing (standalone) |

### Phase 2: Data Resolution Layer

| File | Purpose |
|------|---------|
| `lib/chat/resolution-types.ts` | TypeScript types for resolution results |
| `lib/chat/workspace-resolver.ts` | Resolves workspace names to IDs via SQL |
| `lib/chat/note-resolver.ts` | Resolves note titles to IDs via SQL |
| `lib/chat/intent-resolver.ts` | Main resolver orchestrator |
| `app/api/chat/navigate/route.ts` | Combined API: parse intent + resolve data |

### Phase 3: Action Execution

| File | Purpose |
|------|---------|
| `lib/chat/use-chat-navigation.ts` | React hook for executing navigation actions |
| `lib/chat/use-chat-navigation-listener.ts` | Canvas listener for note navigation events |
| `lib/chat/index.ts` | Barrel export for the chat module |

### Phase 4: Chat UI Integration

| File | Purpose |
|------|---------|
| `components/chat/chat-navigation-panel.tsx` | Main chat UI component |
| `components/chat/index.ts` | Component barrel export |

### Configuration

| File | Change |
|------|--------|
| `.env.local` | Added `OPENAI_API_KEY` and optional `OPENAI_MODEL` |

---

## File Contents

### `lib/chat/intent-prompt.ts`

```typescript
/**
 * Intent Classification Prompt
 * System prompt for the LLM to classify user navigation intents.
 */

export const INTENT_SYSTEM_PROMPT = `You are a navigation assistant for a note-taking application.
Your job is to understand what the user wants to do and classify their intent.

Available intents:
1. open_workspace - User wants to open a specific workspace by name
2. open_recent_workspace - User wants to open their most recent workspace
3. open_note - User wants to open a specific note by title
4. create_workspace - User wants to create a new workspace
5. unsupported - Request doesn't match any supported action

Extract relevant arguments:
- workspaceName: The name of the workspace (for open_workspace)
- noteTitle: The title of the note (for open_note)
- entryName: The entry/project name if mentioned (optional scope)
- newWorkspaceName: The name for a new workspace (for create_workspace)
- reason: Why the request is unsupported (for unsupported)

Respond with JSON only. No explanation.`

export function buildIntentMessages(userMessage: string) {
  return [
    { role: 'system' as const, content: INTENT_SYSTEM_PROMPT },
    { role: 'user' as const, content: userMessage },
  ]
}
```

### `lib/chat/intent-schema.ts`

```typescript
/**
 * Intent Schema
 * Zod schema for validating LLM intent responses.
 */

import { z } from 'zod'

export const IntentSchema = z.object({
  intent: z.enum([
    'open_workspace',
    'open_recent_workspace',
    'open_note',
    'create_workspace',
    'unsupported',
  ]),
  args: z.object({
    workspaceName: z.string().optional(),
    noteTitle: z.string().optional(),
    entryName: z.string().optional(),
    newWorkspaceName: z.string().optional(),
    reason: z.string().optional(),
  }).default({}),
})

export type IntentResponse = z.infer<typeof IntentSchema>

export const SUPPORTED_ACTIONS_TEXT = 'open workspace, open note, create workspace'

export function parseIntentResponse(raw: unknown): IntentResponse {
  const result = IntentSchema.safeParse(raw)
  if (result.success) {
    return result.data
  }
  return {
    intent: 'unsupported',
    args: { reason: 'Could not parse intent' },
  }
}
```

### `app/api/chat/navigate/route.ts`

```typescript
import { NextRequest, NextResponse } from 'next/server'
import OpenAI from 'openai'

import { buildIntentMessages } from '@/lib/chat/intent-prompt'
import {
  parseIntentResponse,
  SUPPORTED_ACTIONS_TEXT,
  type IntentResponse,
} from '@/lib/chat/intent-schema'
import { resolveIntent, type IntentResolutionResult } from '@/lib/chat/intent-resolver'
import { resolveNoteWorkspaceUserId } from '@/app/api/note-workspaces/user-id'

let openaiClient: OpenAI | null = null

function getOpenAIClient(): OpenAI {
  if (!openaiClient) {
    const apiKey = process.env.OPENAI_API_KEY
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY environment variable is not set')
    }
    openaiClient = new OpenAI({ apiKey })
  }
  return openaiClient
}

const LLM_CONFIG = {
  model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
  temperature: 0,
  max_tokens: 150,
  response_format: { type: 'json_object' as const },
}

const TIMEOUT_MS = 8000

export async function POST(request: NextRequest) {
  try {
    const userId = resolveNoteWorkspaceUserId(request)
    if (userId === 'invalid') {
      return NextResponse.json({ error: 'Invalid userId' }, { status: 400 })
    }

    const body = await request.json()
    const { message, currentEntryId, currentWorkspaceId } = body

    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      return NextResponse.json({ error: 'Message is required' }, { status: 400 })
    }

    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json({
        error: 'Chat navigation is not configured',
        resolution: {
          success: false,
          action: 'error',
          message: 'Chat navigation is not configured. Please set OPENAI_API_KEY.',
        },
      }, { status: 503 })
    }

    // Step 1: Parse intent with LLM
    const client = getOpenAIClient()
    const messages = buildIntentMessages(message.trim())

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS)

    let intent: IntentResponse
    try {
      const completion = await client.chat.completions.create(
        { ...LLM_CONFIG, messages },
        { signal: controller.signal }
      )
      clearTimeout(timeoutId)

      const content = completion.choices[0]?.message?.content
      intent = content ? parseIntentResponse(JSON.parse(content)) : {
        intent: 'unsupported',
        args: { reason: 'No response from assistant' },
      }
    } catch (error) {
      clearTimeout(timeoutId)
      if (error instanceof Error && error.name === 'AbortError') {
        return NextResponse.json({
          error: 'Request timeout',
          resolution: { success: false, action: 'error', message: 'Request timed out.' },
        }, { status: 504 })
      }
      throw error
    }

    // Step 2: Resolve intent to actionable data
    const context = {
      userId,
      currentEntryId: currentEntryId || undefined,
      currentWorkspaceId: currentWorkspaceId || undefined,
    }
    const resolution = await resolveIntent(intent, context)

    if (!resolution.success && resolution.action === 'error') {
      resolution.message += ` I can help with: ${SUPPORTED_ACTIONS_TEXT}.`
    }

    return NextResponse.json({ intent, resolution })
  } catch (error) {
    console.error('[chat/navigate] Error:', error)
    return NextResponse.json({
      error: 'Failed to process request',
      resolution: { success: false, action: 'error', message: 'Something went wrong.' },
    }, { status: 500 })
  }
}
```

### `lib/chat/use-chat-navigation.ts`

```typescript
'use client'

import { useCallback } from 'react'
import { setActiveEntryContext } from '@/lib/entry/entry-context'
import { setActiveWorkspaceContext, requestWorkspaceListRefresh } from '@/lib/note-workspaces/state'
import type { IntentResolutionResult } from './intent-resolver'
import type { WorkspaceMatch, NoteMatch } from './resolution-types'

export interface ChatNavigationResult {
  success: boolean
  message: string
  action?: 'navigated' | 'created' | 'selected' | 'error'
}

export function useChatNavigation(options = {}) {
  const { onNavigationComplete, onError } = options

  const navigateToWorkspace = useCallback(async (workspace: WorkspaceMatch) => {
    try {
      if (workspace.entryId) setActiveEntryContext(workspace.entryId)
      setActiveWorkspaceContext(workspace.id)

      const result = { success: true, message: `Opened workspace "${workspace.name}"`, action: 'navigated' }
      onNavigationComplete?.(result)
      return result
    } catch (error) {
      // Error handling...
    }
  }, [onNavigationComplete, onError])

  const navigateToNote = useCallback(async (note: NoteMatch) => {
    try {
      if (note.entryId) setActiveEntryContext(note.entryId)
      if (note.workspaceId) setActiveWorkspaceContext(note.workspaceId)

      // Dispatch event for canvas to handle
      window.dispatchEvent(new CustomEvent('chat-navigate-note', {
        detail: { noteId: note.id, workspaceId: note.workspaceId, entryId: note.entryId },
      }))

      const result = { success: true, message: `Opened note "${note.title}"`, action: 'navigated' }
      onNavigationComplete?.(result)
      return result
    } catch (error) {
      // Error handling...
    }
  }, [onNavigationComplete, onError])

  const createWorkspace = useCallback(async (name: string, entryId: string) => {
    const response = await fetch('/api/note-workspaces', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, itemId: entryId }),
    })

    const { workspace } = await response.json()
    requestWorkspaceListRefresh()
    setActiveEntryContext(entryId)
    setActiveWorkspaceContext(workspace.id)

    return { success: true, message: `Created workspace "${name}"`, action: 'created' }
  }, [onNavigationComplete, onError])

  const executeAction = useCallback(async (resolution: IntentResolutionResult) => {
    switch (resolution.action) {
      case 'navigate_workspace': return navigateToWorkspace(resolution.workspace!)
      case 'navigate_note': return navigateToNote(resolution.note!)
      case 'create_workspace': return createWorkspace(resolution.newWorkspace!.name, resolution.newWorkspace!.entryId)
      case 'select': return { success: true, message: resolution.message, action: 'selected' }
      default: return { success: false, message: resolution.message, action: 'error' }
    }
  }, [navigateToWorkspace, navigateToNote, createWorkspace])

  return { executeAction, navigateToWorkspace, navigateToNote, createWorkspace }
}
```

### `components/chat/chat-navigation-panel.tsx`

```typescript
'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import { MessageSquare, Send, X, Loader2, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useChatNavigation, type IntentResolutionResult } from '@/lib/chat'

export function ChatNavigationPanel({
  currentEntryId,
  currentWorkspaceId,
  onNavigationComplete,
  trigger,
}) {
  const [open, setOpen] = useState(false)
  const [input, setInput] = useState('')
  const [messages, setMessages] = useState([])
  const [isLoading, setIsLoading] = useState(false)

  const { executeAction, selectOption } = useChatNavigation({
    onNavigationComplete: () => {
      onNavigationComplete?.()
      setOpen(false)
    },
  })

  const sendMessage = useCallback(async () => {
    // Add user message, call API, execute action, add assistant message
    const response = await fetch('/api/chat/navigate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: input, currentEntryId, currentWorkspaceId }),
    })
    const { resolution } = await response.json()
    const result = await executeAction(resolution)
    // Update messages with result...
  }, [input, currentEntryId, currentWorkspaceId, executeAction])

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {trigger || <Button variant="ghost" size="icon"><MessageSquare /></Button>}
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0">
        {/* Header, Messages with selection pills, Input */}
      </PopoverContent>
    </Popover>
  )
}
```

---

## Environment Configuration

Add to `.env.local`:

```bash
# Required: OpenAI API Key
OPENAI_API_KEY=sk-...

# Optional: Override default model (gpt-4o-mini)
OPENAI_MODEL=gpt-4o
```

---

## Usage

### Basic Integration

```tsx
import { ChatNavigationPanel } from '@/components/chat'

function Toolbar() {
  return (
    <ChatNavigationPanel
      currentEntryId={currentEntryId}
      currentWorkspaceId={currentWorkspaceId}
      onNavigationComplete={() => console.log('Navigated!')}
    />
  )
}
```

### Canvas Listener (for note navigation)

```tsx
import { useChatNavigationListener } from '@/lib/chat'

function CanvasContent() {
  // Must be inside CanvasWorkspaceProvider
  useChatNavigationListener({ enabled: true })
  return <div>...</div>
}
```

---

## Data Model Notes

### Workspace Resolution

- Uses `note_workspaces` table (user workspaces per entry)
- Filters by `user_id` for user scoping
- Joins to `items` table for entry name context
- Special handling for "dashboard" → default workspace

### Note Resolution

- Uses `notes` table joined to `items` table (notes.id = items.id for type='note')
- Uses `items` table for folder/path context
- When `currentWorkspaceId` is provided, searches `note_workspaces.payload.openNotes[]`
- Otherwise searches by folder hierarchy via `items.parent_id` and `items.path`

**Important:** `notes.workspace_id` references `workspaces.id` (overlay/system workspaces), NOT `note_workspaces.id` (user workspaces). These are separate systems.

---

## Validation

### Type Check

```bash
npm run type-check
# ✓ Passes
```

### Manual Testing Checklist

- [ ] "open workspace Research" → navigates to workspace
- [ ] "go to dashboard" → navigates to default workspace
- [ ] "open note Project Plan" → opens note in canvas
- [ ] "create workspace Sprint 12" → creates and navigates
- [ ] Multiple matches → shows selection pills
- [ ] Unsupported command → shows helpful error message
- [ ] No API key → returns 503 with configuration message

---

## Known Limitations

1. **No conversation memory** - Each message is independent
2. **English only** - Intent parsing optimized for English
3. **Requires OpenAI API** - No offline fallback
4. **Canvas listener required** - Note navigation requires `useChatNavigationListener` in canvas component

---

## Future Enhancements

- Keyboard shortcut (Cmd+K) to open chat
- Conversation memory for context
- Voice input support
- Additional intents (search, recent notes, etc.)
