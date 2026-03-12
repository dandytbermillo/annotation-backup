# Stage 6 Slice 6.7 Slice 2: Structured Output Hardening — Implementation Report

**Date**: 2026-03-12
**Status**: CLOSED
**Scope**: Structured output enforcement + server-side validation + single-retry contract. No loop-logic changes, no new tools, no threshold changes.
**Predecessor**: 6.7 Slice 1 (prompt hardening, closed)

---

## Summary

Hardens the Stage 6 LLM response contract at three layers:

1. **Gemini schema enforcement** — `responseMimeType: 'application/json'` + `responseSchema` forces valid JSON with typed fields
2. **Server-side structural validation** — `validateResponseStructure()` checks required fields per response type
3. **Single-retry contract** — one correction attempt on structural failure, then abort

---

## Changes

**Single file modified**: `app/api/chat/stage6-loop/route.ts`

### 1. Response schema (`S6_RESPONSE_SCHEMA`)

Flat `ObjectSchema` with `type` as required enum discriminant:

| Field | Schema | Constraint |
|-------|--------|------------|
| `type` | `STRING enum` | `['inspect', 'action', 'clarify', 'abort']` |
| `action` | `STRING enum` | `['open_panel', 'open_widget_item', 'navigate_entry']` |
| `tool` | `STRING` | Inspect tool name |
| `panelSlug` | `STRING` | widgetId from inspect_dashboard |
| `widgetId` | `STRING` | Widget ID |
| `itemId` | `STRING` | Item ID |
| `entryId` | `STRING` | Entry ID |
| `candidateIds` | `ARRAY[STRING]` | Ambiguous candidate IDs |
| `reason` | `STRING` | Explanation |
| `query` | `STRING` | Search query |
| `limit` | `INTEGER` | Max results |
| `windowDays` | `INTEGER` | Days to look back |

Only `type` is required. All other fields are optional at schema level — validated per-type by `validateResponseStructure()`.

### 2. Generation config

```typescript
generationConfig: {
  temperature: 0.1,
  maxOutputTokens: 500,
  responseMimeType: 'application/json',
  responseSchema: S6_RESPONSE_SCHEMA,
},
```

### 3. `validateResponseStructure(parsed)` → `string | null`

Returns null if valid, or a specific error string:

| Type | Required fields | Error on missing |
|------|----------------|-----------------|
| `inspect` | `tool` (from valid set) | "requires a valid tool field" |
| `inspect` (search) | `query` | "requires a query field" |
| `action` | `action` (from valid set) | "requires a valid action field" |
| `action` (open_panel) | `panelSlug` | "requires a panelSlug field" |
| `action` (open_widget_item) | `widgetId` + `itemId` | "requires widgetId and itemId" |
| `action` (navigate_entry) | `entryId` | "requires an entryId field" |
| `clarify` | `candidateIds` (non-empty) | "requires a non-empty candidateIds array" |
| `abort` | (none) | — |

### 4. Single-retry contract

```
structRetried = false

on structural failure:
  if (!structRetried):
    structRetried = true
    send error feedback to model → continue loop
  else:
    abort with "Structural: <error>"
```

Traced as `invalid_<type>` in tool trace (e.g., `invalid_action`, `invalid_clarify`).

---

## Test changes

**File**: `__tests__/unit/chat/stage6-loop-route.test.ts`

- Added `SchemaType` mock to `@google/generative-ai` mock (lines 37-51)
- §12: 4 new tests:
  1. Invalid action (missing panelSlug) → retry → corrected → `action_executed`
  2. Invalid clarify (missing candidateIds) → retry → corrected → `clarification_accepted`
  3. Invalid inspect (bad tool) → retry → abort
  4. Double structural failure → immediate abort (verifies `structRetried` flag, exactly 2 sendMessage calls, 2 `invalid_action` in trace)

---

## Verification

```
$ npm run type-check
(clean — no errors)

$ npx jest __tests__/unit/chat/stage6 --no-coverage
Test Suites: 5 passed, 5 total
Tests:       78 passed, 78 total
```

---

## What this slice does NOT do

- No discriminated union schema (Gemini SDK doesn't support `anyOf`/`oneOf`)
- No confidence thresholds
- No loop-logic changes (round limits, timeout)
- No new inspect tools
- No runtime fixture for testing act path

---

## Next

Build a controlled runtime fixture where single-match `open_panel` is reachable by Stage 6 — required to validate whether prompt + schema hardening actually improves the act path.
