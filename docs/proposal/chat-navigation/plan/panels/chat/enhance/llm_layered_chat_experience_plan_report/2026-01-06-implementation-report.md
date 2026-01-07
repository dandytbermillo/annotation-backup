# Implementation Report: LLM Layered Chat Experience

**Date:** 2026-01-06
**Plan:** `llm-layered-chat-experience-plan.md`
**Status:** Implemented (with post-review fixes)

---

## Summary

Implemented the layered chat experience that combines deterministic handling with LLM reasoning:

1. **Fast local selection** - Already implemented (ordinals, numbers, letters)
2. **LLM with chat context** - Already implemented (ChatContext bundle)
3. **Need-context retrieval loop** - Already implemented (max 1 retry)
4. **App data retrieval (DB lookup)** - NEW: `retrieve_from_app` intent
5. **General answers** - Already implemented (time/math/static knowledge)
6. **Recency decay** - NEW: Context-specific expiration windows

---

## What Was Already Implemented

### Selection-Only Guard (`chat-navigation-panel.tsx:601-658`)
```typescript
function isSelectionOnly(input, optionCount, optionLabels): { isSelection: boolean; index?: number }
// Handles: first, second, third, 1, 2, 3, option 1, the first one, a, b, c
```

### ChatContext Bundle (`chat-navigation-panel.tsx:339-351`)
```typescript
interface ChatContext {
  lastAssistantMessage?: string
  lastOptions?: Array<{ label: string; sublabel?: string }>
  lastListPreview?: { title: string; count: number; items: string[] }
  lastOpenedPanel?: { title: string }
  lastShownContent?: { type: 'preview' | 'panel' | 'list'; ... }
  lastErrorMessage?: string
  lastUserMessage?: string
}
```

### Need-Context Loop (`route.ts:321-367`)
- Max 1 retry for context retrieval
- Builds expanded context from fullChatHistory

### General Answers (`intent-resolver.ts:1927-1952`)
- Time: Server time replacement
- Math: LLM computed
- Static knowledge: LLM response

---

## New Implementation

### 1. `retrieve_from_app` Intent

**Purpose:** Query DB for entities not shown in chat (widgets, workspaces, notes, entries)

**Files Modified:**

| File | Changes |
|------|---------|
| `lib/chat/intent-schema.ts:46-47` | Added `retrieve_from_app` intent type |
| `lib/chat/intent-schema.ts:119-121` | Added `entityType` and `entityQuery` args |
| `lib/chat/intent-prompt.ts:380-384` | Added Decision Flow step 3 for DB retrieval |
| `lib/chat/intent-prompt.ts:366-367` | Added args to Response Format |
| `lib/chat/intent-prompt.ts:400-412` | Updated Knowledge Boundary with priority rule |
| `lib/chat/intent-resolver.ts:229-231` | Added case for `retrieve_from_app` |
| `lib/chat/intent-resolver.ts:1954-2097` | Added `resolveRetrieveFromApp()` function |

**DB Queries (aligned with app data model):**
```typescript
switch (entityType) {
  case 'widget':    // Query installed_widgets (Widget Manager)
  case 'workspace': // Query note_workspaces (same as workspace-resolver.ts)
  case 'note':      // Query items table (type='note')
  case 'entry':     // Query items table (type='folder')
}
```

**Response Format:**
```json
// Found
{ "action": "answer_from_context", "message": "Yes, you have a widget called \"Sales Dashboard\"." }

// Not found
{ "action": "answer_from_context", "message": "I don't see a widget called \"Quick Links F\" in your workspace." }
```

### 2. Recency Decay

**Purpose:** Expire stale context to prevent wrong answers from old data

**Constants (`chat-navigation-panel.tsx:166-170`):**
```typescript
const CONTEXT_DECAY = {
  options: 60_000,       // 60 seconds - options expire fast
  listPreview: 90_000,   // 90 seconds - list previews slightly longer
  openedPanel: 180_000,  // 3 minutes - panels persist longer
} as const
// Note: lastAssistantMessage/lastUserMessage are NOT decayed (always available)
```

**ChatContext Extended (`chat-navigation-panel.tsx:347-350`):**
```typescript
// Recency indicators
optionsAge?: number      // ms since options were shown
openedPanelAge?: number  // ms since panel was opened
isStale?: boolean        // true if all relevant context is stale
```

**buildChatContext Updated (`chat-navigation-panel.tsx:357-492`):**
- Tracks message age during scan
- Filters context based on decay windows
- Sets `isStale` flag when no relevant context found

---

## Decision Flow (Complete)

```
1. Fast local selection (ordinals/numbers)
   ↓ (not a selection)
2. LLM with chat context
   ↓ (returns need_context)
3. Need-context retrieval loop (1 retry)
   ↓ (returns retrieve_from_app)
4. App data retrieval (DB lookup)
   ↓ (not in DB)
5. General answers (time/math/static)
   ↓ (out of scope)
6. Fallback / unsupported
```

---

## Verification

### Type Check
```bash
$ npm run type-check
# Passes with no errors
```

### Acceptance Tests

| Test | Expected | Status |
|------|----------|--------|
| Selection fast path | "first" selects immediately | Already working |
| Membership question | "is F in the list?" → "No" | Already working |
| Last opened | "what did you just open?" → panel name | Already working |
| Need context | "what did you say before that?" → answers | Already working |
| General: time | "what time is it?" → server time | Already working |
| Out of scope | "what's the weather?" → unsupported | Already working |
| **DB retrieval (widget exists)** | "Do I have Sales Dashboard?" → "Yes" | NEW - Implemented |
| **DB retrieval (widget missing)** | "Do I have Quick Links F?" → "I don't see..." | NEW - Implemented |
| **Stale context** | Wait 2 min → "select the second one" → No recent options | NEW - Implemented |

---

## Code Locations

| Feature | File | Line Numbers |
|---------|------|--------------|
| CONTEXT_DECAY constants | `chat-navigation-panel.tsx` | 166-170 |
| ChatContext with recency | `chat-navigation-panel.tsx` | 339-351 |
| buildChatContext with decay | `chat-navigation-panel.tsx` | 357-492 |
| isSelectionOnly guard | `chat-navigation-panel.tsx` | 601-658 |
| Selection guard usage | `chat-navigation-panel.tsx` | 1672-1714 |
| retrieve_from_app intent | `intent-schema.ts` | 46-47 |
| entityType/entityQuery args | `intent-schema.ts` | 119-121 |
| Decision Flow step 3 | `intent-prompt.ts` | 380-384 |
| Knowledge Boundary | `intent-prompt.ts` | 398-412 |
| resolveRetrieveFromApp | `intent-resolver.ts` | 1954-2097 |

---

## Post-Review Fixes

| Issue | Fix |
|-------|-----|
| Widget query used wrong table (`panels`) | Now queries only `installed_widgets` (Widget Manager) - the source of truth for widgets |
| Workspace query used wrong table (`workspaces`) | Now queries `note_workspaces` - same table as `workspace-resolver.ts` uses |
| Unused `message` decay window | Removed from CONTEXT_DECAY; messages are not decayed |
| Exact-match priority only on name, not slug | Added slug to exact-match priority in widget query |
| Entry join didn't filter deleted entries | Added `i.deleted_at IS NULL` to workspace LEFT JOIN |

### Data Model Alignment

**Widgets (`installed_widgets`):**
```sql
SELECT name, slug FROM installed_widgets
WHERE (user_id = $1 OR user_id IS NULL)
  AND enabled = true
  AND (name ILIKE $2 OR slug ILIKE $2)
ORDER BY
  CASE
    WHEN LOWER(name) = LOWER($3) THEN 0
    WHEN LOWER(slug) = LOWER($3) THEN 0  -- slug also gets exact-match priority
    ELSE 1
  END,
  updated_at DESC
```

**Workspaces (`note_workspaces`):**
```sql
-- With entry context (scoped to current entry)
SELECT nw.id, nw.name, i.name as entry_name
FROM note_workspaces nw
LEFT JOIN items i ON nw.item_id = i.id AND i.deleted_at IS NULL  -- filter deleted entries
WHERE nw.user_id = $1 AND nw.item_id = $2 AND nw.name ILIKE $3

-- Without entry context (all user workspaces)
SELECT nw.id, nw.name, i.name as entry_name
FROM note_workspaces nw
LEFT JOIN items i ON nw.item_id = i.id AND i.deleted_at IS NULL  -- filter deleted entries
WHERE nw.user_id = $1 AND nw.name ILIKE $2
```

Response now includes entry context: `"Yes, you have a workspace called 'Sprint 6' (in Home)."`

---

## What's NOT Implemented

| Feature | Status | Notes |
|---------|--------|-------|
| "Use Web" button | Not implemented | Optional UX per plan |
| Fuzzy/semantic search | Not implemented | Future enhancement per plan |
| Configurable decay at runtime | Not implemented | Constants are build-time |

---

## Risks/Limitations

1. **DB query performance** - Queries use ILIKE which may be slow on large datasets. Consider adding indexes.
2. **Recency decay is fixed** - Constants can't be changed at runtime without code change.
3. **Entity type detection** - LLM must correctly identify entity type; ambiguous queries may fail.

---

## Next Steps

1. Monitor LLM accuracy on `retrieve_from_app` entity type detection
2. Consider adding fuzzy search for vague queries
3. Add indexes to panels/workspaces/items tables if query performance becomes an issue
4. Optionally implement "Use Web" button for out-of-scope queries

---

## Files Changed Summary

| File | Type | Changes |
|------|------|---------|
| `lib/chat/intent-schema.ts` | Modified | Added retrieve_from_app intent + args |
| `lib/chat/intent-prompt.ts` | Modified | Added Decision Flow step 3, Knowledge Boundary |
| `lib/chat/intent-resolver.ts` | Modified | Added resolveRetrieveFromApp handler |
| `components/chat/chat-navigation-panel.tsx` | Modified | Added CONTEXT_DECAY, recency in buildChatContext |
