# Implementation Report: TD-7 Stricter App-Relevance Fallback

**Date:** 2026-01-16
**Status:** Complete
**Feature Slug:** `chat-navigation`
**Source Plan:** `docs/proposal/chat-navigation/plan/panels/chat/meta/td7-stricter-app-relevance-plan.md`

---

## Summary

Implemented TD-7 (Stricter App-Relevance Fallback) from the debt paydown plan. This feature reduces false positives for high-ambiguity terms (common English words that also have app meanings) by showing a clarification question with 2 options instead of routing straight to doc retrieval when intent is unclear.

**Goal:** Reduce false positives for ambiguous terms by asking a single clarifying question instead of auto-routing to doc retrieval.

---

## Implementation

### 1. High-Ambiguity Terms (`lib/chat/query-patterns.ts`)

Added constants and helper function:

```typescript
export const HIGH_AMBIGUITY_TERMS = new Set<string>([
  'home',
  'notes',
  'note',
  'action',
  'actions',
])

export function getHighAmbiguityOnlyMatch(
  tokens: string[],
  normalized: string,
  knownTerms?: Set<string>
): string | null {
  if (!knownTerms || knownTerms.size === 0) return null

  const matchedTokens = tokens.filter(t => knownTerms.has(t))
  const normalizedMatches = knownTerms.has(normalized) ? [normalized] : []
  const allMatches = [...new Set([...matchedTokens, ...normalizedMatches])]

  if (allMatches.length === 0) return null

  // Return null if ANY matched term is NOT high-ambiguity
  const allHighAmbiguity = allMatches.every(t => HIGH_AMBIGUITY_TERMS.has(t))
  if (!allHighAmbiguity) return null

  return allMatches[0]
}
```

**Logic:** Returns the high-ambiguity term only if ALL matched terms are in the high-ambiguity set. Mixed matches (e.g., "home workspace") return null and follow normal routing.

### 2. Telemetry Fields (`lib/chat/routing-telemetry.ts`)

Added TD-7 specific telemetry:

```typescript
// Pattern ID
CLARIFY_HIGH_AMBIGUITY = 'CLARIFY_HIGH_AMBIGUITY',

// Event fields
strict_app_relevance_triggered?: boolean
strict_term?: string
```

### 3. Type Definitions (`lib/chat/chat-navigation-context.tsx`)

Added TD-7 clarification data type:

```typescript
export interface TD7ClarificationData {
  term: string
  action: 'doc' | 'llm'
}
```

Updated existing types to include TD-7:

```typescript
// SelectionOption type now includes
type: 'td7_clarification'

// LastClarificationState type now includes
'td7_high_ambiguity'
```

### 4. Routing Logic (`components/chat/chat-navigation-panel.tsx`)

#### Feature Flag

```typescript
const STRICT_APP_RELEVANCE_ENABLED = process.env.NEXT_PUBLIC_STRICT_APP_RELEVANCE_HIGH_AMBIGUITY === 'true'
```

#### Trigger Points

TD-7 clarification triggers at:

| Step | Condition | Example |
|------|-----------|---------|
| Step 6 (bare noun) | Single high-ambiguity term | `home`, `notes` |
| Step 7 (app-relevant fallback) | Longer queries with only high-ambiguity matches | `my home`, `about notes` |

Does NOT trigger at:

| Step | Reason | Example |
|------|--------|---------|
| Step 5 (doc-style) | Explicit intent cue | `what is home` |
| Steps 2-4 (action routes) | Command-like intent | `open notes` |

#### Clarification UI Generation

```typescript
if (STRICT_APP_RELEVANCE_ENABLED) {
  const highAmbiguityTerm = getHighAmbiguityOnlyMatch(tokens, normalized, knownTerms)
  if (highAmbiguityTerm) {
    // Generate clarification with 2 options
    const capitalizedTerm = highAmbiguityTerm.charAt(0).toUpperCase() + highAmbiguityTerm.slice(1)

    const options: SelectionOption[] = [
      {
        type: 'td7_clarification',
        label: `${capitalizedTerm} (App)`,
        description: 'Ask about this app feature',
        data: { term: highAmbiguityTerm, action: 'doc' }
      },
      {
        type: 'td7_clarification',
        label: 'Something else',
        description: 'Not asking about this app',
        data: { term: highAmbiguityTerm, action: 'llm' }
      }
    ]

    // Set clarification state
    setLastClarificationState('td7_high_ambiguity')
  }
}
```

#### Option Selection Handling

```typescript
case 'td7_clarification': {
  const td7Data = option.data as TD7ClarificationData
  if (td7Data.action === 'doc') {
    // Route to doc retrieval with the term
    handleGeneralDocRetrieval(td7Data.term, normalizeQuery(td7Data.term).tokens)
  } else {
    // Route to LLM/general chat
    addMessage({ role: 'assistant', content: 'Okay, what would you like help with?' })
    setLastClarificationState(null)
  }
  break
}
```

---

## Files Modified

| File | Changes |
|------|---------|
| `lib/chat/query-patterns.ts` | Added `HIGH_AMBIGUITY_TERMS` constant and `getHighAmbiguityOnlyMatch()` function |
| `lib/chat/routing-telemetry.ts` | Added `CLARIFY_HIGH_AMBIGUITY` pattern ID and telemetry fields |
| `lib/chat/chat-navigation-context.tsx` | Added `TD7ClarificationData` interface, updated `SelectionOption` and `LastClarificationState` types |
| `components/chat/chat-navigation-panel.tsx` | Added feature flag check, clarification logic at Steps 6 & 7, option selection handler |
| `__tests__/chat/query-patterns.test.ts` | Added 11 unit tests for `getHighAmbiguityOnlyMatch()` |

---

## Test Results

### Unit Tests

Added 11 tests for `getHighAmbiguityOnlyMatch()`:

```
✓ returns null when knownTerms is undefined
✓ returns null when knownTerms is empty
✓ returns null when no tokens match knownTerms
✓ returns high-ambiguity term when single token matches
✓ returns null when matched term is NOT high-ambiguity (workspace)
✓ returns null for mixed matches (home + workspace)
✓ returns high-ambiguity term for normalized match
✓ returns null when normalized match is not high-ambiguity
✓ handles "notes" as high-ambiguity
✓ handles "action" as high-ambiguity
✓ returns first match when multiple high-ambiguity terms present
```

### Manual Testing (2026-01-16)

**Prerequisites:**
- Feature flag enabled: `NEXT_PUBLIC_STRICT_APP_RELEVANCE_HIGH_AMBIGUITY=true`

| # | Input | Expected | Actual | Status |
|---|-------|----------|--------|--------|
| 1 | `home` | TD-7 clarification with 2 options | "Are you asking about Home in this app?" with [Home (App)] / [Something else] | ✅ Pass |
| 2 | `what is home` | Doc retrieval (intent cue bypass) | Doc retrieval response | ✅ Pass |
| 3 | `open notes` | Action route (command bypass) | Action route | ✅ Pass |
| 4 | `home` → [Home (App)] | Doc retrieval | "I couldn't find specific documentation about home. What would you like to know about it?" | ✅ Pass |
| 5 | `home` → [Something else] | LLM/general chat | "Okay, what would you like help with?" | ✅ Pass |

---

## Acceptance Criteria

From `td7-stricter-app-relevance-plan.md`:

| # | Test Case | Status | Evidence |
|---|-----------|--------|----------|
| 1 | Ambiguous term (home) → clarification with 2 options | ✅ | Screenshot shows "Are you asking about Home in this app?" with 2 options |
| 2 | Doc-style query bypass (what is home) → doc retrieval | ✅ | Manual test - no clarification shown |
| 3 | Action command bypass (open notes) → action route | ✅ | Manual test - action route triggered |
| 4 | User selects app option → doc retrieval response | ✅ | Screenshot shows doc retrieval response after [Home (App)] click |
| 5 | User selects something else → LLM/general response | ✅ | Screenshot shows "Okay, what would you like help with?" after [Something else] click |

---

## Feature Flag

| Flag | Value | Effect |
|------|-------|--------|
| `NEXT_PUBLIC_STRICT_APP_RELEVANCE_HIGH_AMBIGUITY` | `true` | TD-7 clarification enabled |
| `NEXT_PUBLIC_STRICT_APP_RELEVANCE_HIGH_AMBIGUITY` | `false` or unset | Normal routing (no TD-7 clarification) |

**Rollout Plan:**
1. ✅ Enable in dev/staging
2. ⏳ Monitor correction rate + clarification success via telemetry
3. ⏳ Enable in prod if metrics improve

---

## Telemetry

When TD-7 triggers, the following fields are logged:

| Field | Type | Description |
|-------|------|-------------|
| `matched_pattern_id` | string | `CLARIFY_HIGH_AMBIGUITY` |
| `strict_app_relevance_triggered` | boolean | `true` |
| `strict_term` | string | The high-ambiguity term (e.g., "home") |

**Query to analyze TD-7 effectiveness:**

```sql
SELECT
  metadata->>'strict_term' as term,
  COUNT(*) as total,
  COUNT(*) FILTER (WHERE metadata->>'user_corrected_next_turn' = 'true') as corrected
FROM debug_logs
WHERE component = 'DocRouting'
  AND metadata->>'matched_pattern_id' = 'CLARIFY_HIGH_AMBIGUITY'
GROUP BY metadata->>'strict_term'
ORDER BY total DESC;
```

---

## Safety Checks

| Check | Status | Notes |
|-------|--------|-------|
| Feature flag gated | ✅ | Disabled by default |
| Type-check passes | ✅ | `npm run type-check` clean |
| Clarification state cleared | ✅ | `setLastClarificationState(null)` called on selection |
| Mixed matches bypass TD-7 | ✅ | "home workspace" → normal routing |
| Intent cues bypass TD-7 | ✅ | "what is home" → doc retrieval |
| Action commands bypass TD-7 | ✅ | "open notes" → action route |

---

## Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| Under-routing real app queries | Small term list (5 terms) + feature flag + telemetry monitoring |
| Extra friction for users | One question max, two options max, only for high-ambiguity terms |
| Term list too small | Can expand based on telemetry data |
| Term list too large | Start conservative, add terms only with evidence |

---

## Next Steps

1. **Monitor telemetry** - Track `CLARIFY_HIGH_AMBIGUITY` events and user selections
2. **Analyze correction rate** - Compare correction rate before/after TD-7
3. **Expand term list** - Add more terms if telemetry shows need (e.g., "page", "item")
4. **Production rollout** - Enable in prod after 1-2 weeks of staging data

---

## Changelog

| Date | Author | Change |
|------|--------|--------|
| 2026-01-16 | Claude | Initial implementation of TD-7 |
| 2026-01-16 | Claude | Added unit tests for `getHighAmbiguityOnlyMatch()` |
| 2026-01-16 | Claude | Manual testing completed - all acceptance criteria verified |
