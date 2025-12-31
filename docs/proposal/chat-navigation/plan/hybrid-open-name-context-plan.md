# Plan: Hybrid Open-by-Name + A-lite Context + Safe Fallback

## Goal
Make follow-up commands like "open summary14" work reliably, even when the LLM does not see the Quick Links items. Improve natural follow-ups without sending full chat history.

## Summary of Approach
Layered fix with three parts:
1) Baseline routing fix: treat "open <name>" (no "note" keyword) as resolve_name.
2) A-lite UI context: pass a small, typed list of last displayed items (e.g., Quick Links) to the LLM for follow-ups.
3) Safe fallback: if open_note fails and the user did not say "note", re-route to resolve_name or clarify.

## Why This Hybrid
- Baseline rule solves the failure even without UI context.
- A-lite context enables natural follow-ups like "open the second one" or "open summary14" right after Quick Links.
- Fallback handles gaps and keeps behavior consistent.

---

## Part 1: Baseline Routing Rule (Prompt)
### Change
Update intent rules so:
- "open <name>" without "note" keyword -> resolve_name
- "open entry <name>" -> resolve_name
- "open note <name>" -> open_note (explicit only)

### Rationale
Prevents defaulting to open_note for entry/workspace names.

### Acceptance
- "open summary14" routes to resolve_name
- "open note summary14" routes to open_note

---

## Part 2: A-lite Context for Displayed Items
### Data Model
Add a new context payload field:
```
lastDisplayedItems: Array<{
  id: string
  label: string
  type: 'entry' | 'workspace' | 'note'
  sublabel?: string
  source: 'quick_links' | 'recent' | 'workspaces'
}>
```

### Scope Limits
- Only include the latest displayed list
- Cap items to 10 (or first N rendered)
- Do not include full chat history

### Integration
- When rendering Quick Links results in chat, store displayed items in state.
- Include lastDisplayedItems in the context payload sent to `/api/chat/navigate`.
- Extend prompt with a short rule:
  "If lastDisplayedItems exist, use them to resolve follow-up requests like 'open the second one' or a label from the list."

### Behavior
- After "show quick links", user can say "open summary14" or "open the second one".
- LLM uses list context before falling back to database search.

---

## Part 3: Safe Fallback After open_note Miss
### Rule
If intent is open_note, lookup fails, and the user did NOT say "note":
- Re-route to resolve_name (or ask clarification if both entry and workspace match)

### Rationale
Catches cases where the model incorrectly chose open_note.

---

## Safety Rules
- Never normalize or reinterpret entity names.
- If lastDisplayedItems conflict with explicit commands (e.g., "open note X"), explicit command wins.
- If ambiguity remains (entry and workspace same name), ask "entry or workspace?".

---

## Implementation Steps
1) Update prompt rules in `lib/chat/intent-prompt.ts`:
   - "open <name>" -> resolve_name
   - open_note only with explicit "note"
   - add lastDisplayedItems usage note
2) Extend context payload and types:
   - Add lastDisplayedItems to ConversationContext
   - Thread through `/api/chat/navigate`
3) Store lastDisplayedItems in chat UI:
   - When Quick Links preview is rendered, record items in state
   - Pass to context
4) Add fallback in resolver:
   - If open_note fails and user did not say "note", re-route to resolve_name

---

## Testing Checklist
- "show quick links" -> list
- "open summary14" (immediately after quick links) -> opens entry
- "open the second one" -> opens item 2 from lastDisplayedItems
- "open note summary14" -> open_note
- "open summary14" (no prior list) -> resolve_name (entry/workspace)
- "open summary14" when entry + workspace conflict -> ask "entry or workspace?"

---

## Rollback
- Remove lastDisplayedItems from context and prompt
- Keep baseline resolve_name rule
- Remove fallback re-route

---

## Success Criteria
- No "No note found" for entry/workspace names typed with "open".
- Users can open items from the most recent list without extra clarification.
- No increase in wrong-intent actions when explicit type keywords are used.
