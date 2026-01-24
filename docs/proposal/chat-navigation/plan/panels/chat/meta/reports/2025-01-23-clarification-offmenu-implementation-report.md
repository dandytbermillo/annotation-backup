# Clarification Off-Menu Handling — Implementation Report

**Date:** 2025-01-23
**Status:** Complete
**Plans Implemented:**
- `clarification-offmenu-handling-plan.md` (v1)
- `clarification-exit-pills-plan.md`

---

## Summary

Implemented deterministic off-menu input handling for clarification mode. When users type something not in the pill options, the system now:
- Attempts to map input using micro-alias tokens
- Detects new topics with bounded heuristics
- Escalates messaging progressively (3 attempts)
- Shows exit pills on attempt 3+
- Handles exit phrases gracefully

---

## Files Modified

| File | Changes |
|------|---------|
| `lib/chat/clarification-offmenu.ts` | **NEW** — Utility module for off-menu handling |
| `lib/chat/chat-navigation-context.tsx` | Added `attemptCount` to state, new clarification types, `ExitPillData` interface, `'exit'` type |
| `lib/chat/chat-routing.ts` | Integrated off-menu mapping, exit phrases, escalation, exit pills |
| `lib/chat/index.ts` | Exported `ExitPillData` |
| `components/chat/chat-navigation-panel.tsx` | Added exit pill selection handler |

---

## New Module: `lib/chat/clarification-offmenu.ts`

### Exports

| Export | Purpose |
|--------|---------|
| `toCanonicalTokens(s)` | Normalize string to canonical token set |
| `getLabelAliasTokens(label)` | Get alias tokens for a label |
| `mapOffMenuInput(input, options, type)` | Map off-menu input to an option |
| `detectNewTopic(input, options, result)` | Bounded new topic detection |
| `getEscalationMessage(attemptCount)` | Get escalation message based on attempts |
| `getExitOptions()` | Get exit pill options |
| `isExitPhrase(input)` | Check if input is an exit phrase |
| `isClearCommandOrQuestion(input)` | Check if input is a clear command/question |
| `MAX_ATTEMPT_COUNT` | Constant (3) |

### Micro-Alias Allowlist

```typescript
const MICRO_ALIAS_ALLOWLIST = {
  // Singular/plural normalization
  panel: 'panel', panels: 'panel',
  widget: 'widget', widgets: 'widget',
  link: 'links', links: 'links',
  workspace: 'workspace', workspaces: 'workspace',
  note: 'note', notes: 'note',
  setting: 'settings', settings: 'settings',
  preference: 'preferences', preferences: 'preferences',
  // Morphological variants
  personal: 'personalization', personalization: 'personalization', personalize: 'personalization',
  customize: 'customization', customization: 'customization', custom: 'customization',
}
```

---

## Tier System Updates

### New Tiers in `handleClarificationIntercept`

| Tier | Name | Behavior |
|------|------|----------|
| 1b.1 | Exit phrase | "cancel", "never mind", "none", "stop" → "No problem — what would you like to do instead?" |
| 1b.2 | Rejection | Simple "no" → "Okay — let me know what you want to do." |
| 1b.3b | Off-menu mapping | Uses `mapOffMenuInput()` for micro-alias matching |

### Off-Menu Mapping Flow

```
Input → toCanonicalTokens()
       ↓
   mapOffMenuInput()
       ↓
   ┌─────────────────────────────────────┐
   │ type === 'mapped'                   │ → Select option
   │ type === 'ambiguous'                │ → Re-show options + escalation
   │ type === 'no_match'                 │ → detectNewTopic()
   │   └─ isNewTopic: true               │   → Exit clarification, route normally
   │   └─ isNewTopic: false              │   → Re-show options + escalation
   └─────────────────────────────────────┘
```

---

## Clarification Type Differentiation

| Type | Behavior |
|------|----------|
| `cross_corpus` | Strict — exact label/ordinal only, no micro-alias |
| `workspace_list` | Strict — equality matches only, no subset matching |
| `panel_disambiguation` | Standard — allows canonical subset matching |
| `option_selection` | Standard — allows canonical subset matching |

---

## Escalation Messaging

| Attempt | Message |
|---------|---------|
| 1 | "Please choose one of the options:" |
| 2 | "Which one is closer to what you need?" |
| 3+ | "Which one is closer, or tell me the feature in 3-6 words (e.g., 'change workspace theme')." |

---

## Exit Pills (Attempt 3+)

When `attemptCount >= 3`, exit pills are appended below regular options:

| Pill | ID | Action |
|------|----|--------|
| None of these | `exit_none` | "What would you like to do instead?" |
| Start over | `exit_start_over` | "Okay — what do you want to do?" |

---

## State Changes

### `LastClarificationState` (chat-navigation-context.tsx)

```typescript
export interface LastClarificationState {
  type: 'notes_scope' | 'option_selection' | 'doc_disambiguation' |
        'td7_high_ambiguity' | 'cross_corpus' | 'panel_disambiguation' | 'workspace_list'
  // ... existing fields ...
  attemptCount?: number  // NEW: tracks off-menu attempts
}
```

### `SelectionOption` (chat-navigation-context.tsx)

```typescript
export interface SelectionOption {
  type: '...' | 'exit'  // NEW: exit pill type
  // ...
  data: ... | ExitPillData  // NEW: exit pill data
}

export interface ExitPillData {
  exitType: 'none' | 'start_over'
}
```

---

## Telemetry Events

| Event | When |
|-------|------|
| `clarification_tier1b1_exit_phrase` | Exit phrase detected |
| `clarification_tier1b3b_offmenu_mapping` | Off-menu mapping attempted |
| `clarification_offmenu_mapped` | Input mapped to option |
| `clarification_offmenu_ambiguous` | Input matches multiple options |
| `clarification_offmenu_new_topic_check` | New topic detection ran |
| `clarification_offmenu_new_topic_exit` | New topic detected, exiting clarification |
| `clarification_offmenu_no_match_reshow` | No match, re-showing options |
| `clarification_offmenu_attempts` | Attempt count incremented |
| `clarification_exit_pill_shown` | Exit pills displayed |
| `clarification_exit_pill_selected` | Exit pill clicked |

---

## Acceptance Tests — Results

### Off-Menu Handling Plan

| # | Test | Status |
|---|------|--------|
| 1 | "settings please" → maps if only one option matches | ✅ |
| 2 | "preferences" → re-ask A/B (no global synonym) | ✅ |
| 3 | "show me my profile" → exit clarification | ✅ |
| 4 | "idk" → re-show options | ✅ |
| 5 | After 3 off-menu attempts → escalation message | ✅ |
| 6 | "none of these" → exit clarification | ✅ |
| 7 | "first" → selects first option | ✅ |
| 8 | "link notesx" → re-show options (typo recovery) | ✅ |
| 9 | "Can you show me the settings?" → maps (not exit) | ✅ |
| 10 | "settings" (both have it) → re-ask A/B | ✅ |
| 11 | "manage settings" (overlaps both) → re-ask, increment | ✅ |

### Exit Pills Plan

| # | Test | Status |
|---|------|--------|
| 1 | After 3 off-menu attempts, exit pills appear | ✅ |
| 2 | Click "None of these" → "What would you like to do instead?" | ✅ |
| 3 | Click "Start over" → "Okay — what do you want to do?" | ✅ |
| 4 | Exit pills NOT shown before attempt 3 | ✅ |

---

## Manual Testing Performed

```
1. "link panels" → Disambiguation pills shown
2. "i dodn" → "Please choose one of the options:" (attempt 1)
3. "hemm" → "Which one is closer to what you need?" (attempt 2)
4. "ick" → Escalation message + exit pills shown (attempt 3)
5. Click "None of these" → "What would you like to do instead?"
6. Click "Start over" → "Okay — what do you want to do?"
7. "cancel pls" → "No problem — what would you like to do instead?"
8. "panels d" → Auto-selects Links Panel D (off-menu mapping)
```

---

## Validation

```bash
npm run type-check  # ✅ Passes
```

---

## Known Limitations

1. **`lastUserIntentGuess`** — Not implemented (marked optional in plan)
2. **Soft-confirm for broad mappings** — Not implemented (marked optional in plan)

---

## Next Steps

- Monitor telemetry for micro-alias expansion needs
- Consider visual styling differentiation for exit pills (optional)

---

## References

- [clarification-offmenu-handling-plan.md](../clarification-offmenu-handling-plan.md)
- [clarification-exit-pills-plan.md](../clarification-exit-pills-plan.md)
