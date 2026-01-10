# Options-Visible Clarification Sync (Minimal Update Plan)

## Goal
When the UI shows disambiguation pills, treat that moment as an active clarification so META replies like "what is that?" or "explain" get a proper response instead of falling through to the generic fallback.

## Scope
- Smallest possible update.
- No changes to LLM prompt/schema.
- No changes to selection logic beyond syncing clarification state.
- Only affects cases where options are visibly shown in chat.

## Problem
Some clarifications are generated locally (not by the LLM). In those cases, `lastClarification` is not set, so META replies are not handled and the user sees the generic fallback.

## Approach
Whenever an assistant message renders disambiguation options, set `lastClarification` using the same question and options. Do not overwrite LLM-provided clarifications when one already exists.

## Implementation Steps
1) **Set clarification when options are displayed**
   - In `components/chat/chat-navigation-panel.tsx`, after building the assistant message that includes `options`, call `setLastClarification()` if `lastClarification` is null or refers to a different options set.
   - Use the message text as the clarification `question`. If the message is empty, default to a generic question like "Which one would you like?".
   - Store the options (label/sublabel/id/type) in `lastClarification.options`.

2) **Keep clarification in sync on re-show**
   - When options are re-shown (reshow flow), update `lastClarification` to match the re-shown options and question so META replies work immediately.

3) **Clear clarification when options are resolved**
   - When an option is selected or an explicit action resolves the choice, clear `lastClarification` (existing behavior).

4) **Affirmation guard for multi-choice**
   - If `lastClarification.options` exists and has length > 0, do not treat a plain "yes" as confirmation. The user must select an option.

5) **META response for options**
   - In `handleMeta()`, if `lastClarification.options` exists, respond with a short explanation of available options (list labels) and re-ask the question.
   - Keep the existing notes-scope explanation branch for `lastClarification.type === 'notes_scope'`.

6) **Clarify `nextAction` usage**
   - `nextAction` is optional for option-based clarifications; selection is handled by option pills and selection logic, not by `nextAction`.

## Guardrails
- Only set `lastClarification` when options are actually rendered.
- Do not override a currently active LLM clarification unless the options differ.

## Files to Touch
- `components/chat/chat-navigation-panel.tsx`
- `lib/chat/chat-navigation-context.tsx` (add `options` field to `LastClarificationState`)

## Acceptance Tests
1) **Notes scope clarification**
   - User: "Which notes are open?" (dashboard)
   - Bot: "Notes live inside workspaces..." → user says "yes" → options shown
   - User: "what is that?" → bot explains options and re-asks

2) **Quick Links disambiguation**
   - User: "show quick links" → list of panels shown
   - User: "explain" → bot lists options and re-asks

3) **No options visible**
   - User: "what is that?" when no options are displayed
   - Expected: normal routing (no META handling)

4) **Affirmation guard**
   - User: "yes" when multiple options are shown
   - Expected: no auto-confirm; user must select an option

## Rollback
Remove the `setLastClarification` call added for option-rendering and revert the META/options changes.

---

## Implementation Status (2025-01-09)

**Status:** IMPLEMENTED

### Files Modified

| File | Changes |
|------|---------|
| `lib/chat/chat-navigation-context.tsx` | Added `ClarificationOption` interface, extended `LastClarificationState` with `type: 'option_selection'` and `options?: ClarificationOption[]` field, made `nextAction` optional |
| `components/chat/chat-navigation-panel.tsx` | (1) Added affirmation guard for multi-choice, (2) Updated `handleMeta()` to list options with pills, (3) Added `setLastClarification()` calls at 5 locations where options are rendered, (4) Added `setLastClarification(null)` in `handleSelectOption()` |

### Implementation Details

**Step 1: Schema Update**
- Added `ClarificationOption` interface with `id`, `label`, `sublabel?`, `type`
- Extended `LastClarificationState.type` to include `'option_selection'`
- Added optional `options?: ClarificationOption[]` field
- Made `nextAction` optional (not needed for option-based clarifications)

**Step 2: Affirmation Guard**
- Added `hasMultipleOptions` check before Tier 1 affirmation handler
- User saying "yes" when options exist does NOT trigger auto-confirm

**Step 3: META Response for Options**
- Updated `handleMeta()` to check for `lastClarification.options`
- When options exist: lists them numbered (1. Label, 2. Label...) and re-shows pills
- Kept existing `notes_scope` branch for yes/no clarifications

**Step 4: Sync Clarification at 5 Locations**
1. Workspace picker after yes to notes_scope (~line 1744)
2. Resolution options from suggestion confirm (~line 1608)
3. Deterministic re-show options (~line 2070)
4. LLM re-show options (~line 2706)
5. Main resolution options (select/clarify_type/list_workspaces) (~line 2780)

**Step 5: Clear on Selection**
- Added `setLastClarification(null)` at start of `handleSelectOption()`

### Bug Fix (Post-Testing)

**Issue:** Clarification block guard checked only `lastClarification?.nextAction`, but option-based clarifications don't have `nextAction`.

**Root Cause:** Line 1697 had:
```typescript
if (!lastSuggestion && lastClarification?.nextAction) {
```

This skipped the clarification block entirely for `option_selection` type because `nextAction` was undefined.

**Fix:** Updated guard to also check for options:
```typescript
const hasClarificationContext = lastClarification?.nextAction || (lastClarification?.options && lastClarification.options.length > 0)
if (!lastSuggestion && hasClarificationContext) {
```

### Type-Check
```
npm run type-check → PASS
```

### Acceptance Tests Ready

All 4 acceptance test cases are ready for manual verification:
1. Notes scope → yes → options → "what is that?" → explanation + re-ask with pills
2. Quick Links disambiguation → "explain" → list options + re-ask with pills
3. No options visible → "what is that?" → normal routing
4. "yes" when multiple options shown → no auto-confirm
