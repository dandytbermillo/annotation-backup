# Technical Debt: Doc Retrieval Routing Pattern Fragility

**Date:** 2026-01-14
**Status:** Open
**Priority:** Medium
**Feature Slug:** `chat-navigation`
**Related Files:**
- `components/chat/chat-navigation-panel.tsx`
- `lib/docs/keyword-retrieval.ts`
- `lib/docs/known-terms-client.ts`

---

## Summary

The current doc retrieval routing relies heavily on hardcoded patterns and regex matching. While functional for MVP, this approach creates maintenance burden and doesn't handle edge cases robustly (typos, varied phrasing, cache failures).

---

## Current State (What Was Implemented)

### 1. CORE_APP_TERMS Hardcoded Fallback

**Location:** `chat-navigation-panel.tsx:690-706`

```typescript
const CORE_APP_TERMS = new Set([
  'workspace', 'workspaces',
  'note', 'notes',
  'action', 'actions',
  // ... 16 total terms
])
```

**Purpose:** Provides cache-independent fallback when `knownTerms` cache is empty/expired.

**Problem:**
- Duplicates knowledge that should come from database
- Requires manual updates when app terminology changes
- Could become out of sync with actual doc slugs

---

### 2. Conversational Prefix Stripping (Regex)

**Location:** `chat-navigation-panel.tsx:336-357`

```typescript
function stripConversationalPrefix(input: string): string {
  const prefixes = [
    /^(can|could|would|will) you (please |pls )?(tell me|explain|help me understand) /i,
    /^(please |pls )?(tell me|explain) /i,
    // ...
  ]
  // Strip matching prefix
}
```

**Purpose:** Extract core question from conversational wrappers like "can you pls tell me what is X?"

**Problem:**
- Regex patterns need continuous expansion for new variations
- Fragile - doesn't understand semantics
- Each new user phrasing requires code changes

---

### 3. New Question Guard (Pattern-Based)

**Location:** `chat-navigation-panel.tsx:2343-2354`

```typescript
const QUESTION_START_PATTERN = /^(what|which|where|when|how|why|who|is|are|do|does|did|can|could|should|would)\b/i
const isNewQuestionOrCommand = QUESTION_START_PATTERN.test(trimmedInput) || ...
```

**Purpose:** Detect new questions to skip follow-up classifier.

**Problem:**
- Pattern-based detection misses typos (e.g., "wat is" instead of "what is")
- Doesn't understand semantic intent

---

### 4. App-Relevance Fallback Routing

**Location:** `chat-navigation-panel.tsx:755-760`

```typescript
// Step 7: App-relevant fallback
if (isAppRelevant) {
  return 'doc'
}
return 'llm'
```

**Purpose:** Route queries with app-relevant keywords to doc retrieval even if patterns don't match.

**Problem:**
- Could send marginally relevant queries to DB (extra load)
- Relies on keyword presence, not intent understanding

---

## Technical Debt Items

### TD-1: Eliminate CORE_APP_TERMS Duplication

**Priority:** High
**Effort:** Medium

**Current State:**
- `CORE_APP_TERMS` hardcoded in component
- `knownTerms` fetched from API/database
- Duplication creates sync risk

**Proposed Solution:**
```typescript
// Option A: Preload at app startup (guaranteed available)
// In _app.tsx or layout.tsx
useEffect(() => {
  preloadKnownTerms() // Fetch once, never expires during session
}, [])

// Option B: Embedded in HTML (SSR)
// Server renders known terms into page, client hydrates
<script id="known-terms" type="application/json">
  ${JSON.stringify(knownTerms)}
</script>
```

**Acceptance Criteria:**
- [ ] `CORE_APP_TERMS` constant removed
- [ ] `knownTerms` guaranteed available at routing time
- [ ] No cache miss scenarios in production

---

### TD-2: Add Fuzzy Matching for Typos

**Priority:** Medium
**Effort:** Medium

**Current State:**
- Exact string matching only
- "workspac" doesn't match "workspace"
- Typos fall through to LLM fallback

**Proposed Solution:**
```typescript
import { distance } from 'fastest-levenshtein'

function fuzzyMatchTerm(token: string, terms: Set<string>, maxDistance = 2): string | null {
  for (const term of terms) {
    if (distance(token, term) <= maxDistance) {
      return term // Return matched term for keyword extraction
    }
  }
  return null
}

// In routeDocInput:
const hasFuzzyMatch = tokens.some(t =>
  CORE_APP_TERMS.has(t) || fuzzyMatchTerm(t, CORE_APP_TERMS)
)
```

**Acceptance Criteria:**
- [ ] "workspac" matches "workspace" (distance 1)
- [ ] "wrkspace" matches "workspace" (distance 2)
- [ ] "wxyz" does NOT match anything (distance > 2)
- [ ] Performance acceptable (< 5ms for typical query)

---

### TD-3: Consolidate Pattern Matching into Single Module

**Priority:** Medium
**Effort:** Low

**Current State:**
- Patterns scattered across multiple functions:
  - `isMetaExplainOutsideClarification()`
  - `stripConversationalPrefix()`
  - `hasQuestionIntent()`
  - `isDocStyleQuery()`
  - `QUESTION_START_PATTERN`
  - `COMMAND_START_PATTERN`

**Proposed Solution:**
```typescript
// lib/chat/query-patterns.ts
export const PATTERNS = {
  questionStart: /^(what|which|where|...)\b/i,
  commandStart: /^(open|show|go|...)\b/i,
  conversationalPrefixes: [
    /^(can|could|would|will) you .../i,
  ],
  metaExplain: /^(what is|what are|explain) /i,
}

export function normalizeQuery(input: string): {
  stripped: string      // Conversational prefix removed
  isQuestion: boolean
  isCommand: boolean
  intent: 'explain' | 'action' | 'navigate' | 'unknown'
}
```

**Acceptance Criteria:**
- [ ] All patterns in single module
- [ ] Single `normalizeQuery()` entry point
- [ ] Existing tests still pass
- [ ] Easier to audit/update patterns

---

### TD-4: Add Durable Routing Telemetry

**Priority:** High
**Effort:** Low

**Current State:**
- Debug logging EXISTS (`debugLog()` calls with metrics)
- But logs are ephemeral (console only, not persisted)
- No aggregation or dashboarding
- Can't detect patterns of failed queries over time
- No data to prioritize improvements

**Proposed Solution:**
```typescript
// In routeDocInput or sendMessage:
void debugLog({
  component: 'DocRouting',
  action: 'route_decision',
  metadata: {
    input: trimmedInput,
    tokens,
    route: docRoute,
    isAppRelevant,
    matchedPattern: 'core_terms' | 'doc_style' | 'bare_noun' | 'fallback',
    knownTermsAvailable: !!knownTerms,
  },
  metrics: {
    event: 'routing_decision',
    route: docRoute,
    timestamp: Date.now(),
  },
})
```

**Dashboard Queries:**
- % of queries routed to each path (doc/action/llm)
- Top queries falling to LLM (potential misses)
- Cache hit rate for knownTerms

**Acceptance Criteria:**
- [ ] Routing decisions persisted to analytics store
- [ ] Dashboard showing routing distribution
- [ ] Alerts for high LLM fallback rate

---

### TD-5: Follow-up Guard Edge Case

**Priority:** Low (monitor first)
**Effort:** Low

**Current State:**
The `!isNewQuestionOrCommand` guard skips the follow-up classifier for queries starting with question words:
```typescript
// chat-navigation-panel.tsx:2936
if (docRetrievalState?.lastDocSlug && !isFollowUp && !isNewQuestionOrCommand) {
  // Call classifier
}
```

**Problem:**
Polite follow-ups like "can you tell me more about that?" start with "can" which matches `QUESTION_START_PATTERN`, causing them to skip the classifier and be treated as new questions.

| Query | Starts With | isNewQuestionOrCommand | Should Be |
|-------|-------------|------------------------|-----------|
| "tell me more" | tell | true | follow-up |
| "can you tell me more?" | can | true | follow-up |
| "can you explain what are actions?" | can | true | new question |

**Proposed Solution:**
```typescript
// Add specific polite follow-up detection
const POLITE_FOLLOWUP_PATTERN = /^(can|could|would) you (please )?(tell me more|explain more|elaborate|continue|go on)/i

const isPoliteFollowUp = POLITE_FOLLOWUP_PATTERN.test(trimmedInput)

// In guard:
if (docRetrievalState?.lastDocSlug && !isFollowUp && !isNewQuestionOrCommand && !isPoliteFollowUp) {
  // Call classifier
}
// OR let polite follow-ups through to classifier
if (isPoliteFollowUp) {
  isFollowUp = true // Treat as follow-up directly
}
```

**Acceptance Criteria:**
- [ ] Monitor for this pattern in telemetry (TD-4)
- [ ] If observed frequently, implement fix
- [ ] "can you tell me more?" treated as follow-up
- [ ] "can you explain what is workspace?" still treated as new question

---

### TD-6: Evaluate LLM-Based Intent Extraction (Future)

**Priority:** Low
**Effort:** High

**Current State:**
- Pattern-based routing
- Each new phrasing needs code changes
- No semantic understanding

**Proposed Solution:**
```typescript
// Lightweight LLM call for intent extraction
const intentResponse = await fetch('/api/chat/extract-intent', {
  method: 'POST',
  body: JSON.stringify({ query: trimmedInput }),
})

// Response:
{
  intent: 'explain',           // explain | action | navigate | chat
  topic: 'workspace actions',  // Extracted topic (normalized)
  confidence: 0.95,
  originalQuery: 'an u pls tel wat is workspac akshuns?'
}
```

**Trade-offs:**
| Aspect | Pattern-Based | LLM-Based |
|--------|---------------|-----------|
| Latency | ~0ms | ~200-500ms |
| Cost | Free | $0.001-0.01/query |
| Accuracy | ~80% | ~95%+ |
| Maintenance | High | Low |

**Acceptance Criteria:**
- [ ] Prototype with latency/cost analysis
- [ ] A/B test pattern vs LLM routing
- [ ] Decision document on adoption

---

## Recommended Execution Order

| Order | Item | Rationale |
|-------|------|-----------|
| 1 | TD-4: Durable Telemetry | Get data before optimizing |
| 2 | TD-1: Eliminate duplication | Remove maintenance burden |
| 3 | TD-3: Consolidate patterns | Easier future changes |
| 4 | TD-2: Fuzzy matching | Handle common typos |
| 5 | TD-5: Follow-up guard | Only if telemetry shows issue |
| 6 | TD-6: LLM intent | Only if data shows need |

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| CORE_APP_TERMS becomes stale | Medium | Low | Add sync check in CI |
| Regex patterns miss new phrasings | High | Low | Telemetry alerts |
| Fuzzy matching too permissive | Low | Medium | Conservative distance threshold |
| LLM latency unacceptable | Medium | High | Cache common queries |
| Polite follow-ups treated as new questions | Low | Low | Monitor in telemetry first |

---

## References

- `docs/proposal/chat-navigation/plan/panels/chat/meta/definitional-query-fix-proposal.md`
- `docs/proposal/chat-navigation/plan/panels/chat/meta/general-doc-retrieval-routing-plan.md`
- Implementation session: 2026-01-14

---

## Changelog

| Date | Author | Change |
|------|--------|--------|
| 2026-01-14 | Claude | Initial document |
