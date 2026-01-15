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

### TD-2: Add Fuzzy Matching for Typos (Gated)

**Priority:** Medium
**Effort:** Medium

**Current State:**
- Exact string matching only
- "workspac" doesn't match "workspace"
- Typos fall through to LLM fallback

**Proposed Solution:**

Apply fuzzy matching with strict guardrails to avoid false positives:

```typescript
import { distance } from 'fastest-levenshtein'

function fuzzyMatchTerm(
  token: string,
  terms: Set<string>,
  maxDistance = 2
): { matched: string; original: string } | null {
  // Guardrail 1: Only fuzzy match tokens ≥ 5 chars
  // Avoids "go" matching "to", "in" matching "on", etc.
  if (token.length < 5) return null

  for (const term of terms) {
    const dist = distance(token, term)
    // Guardrail 2: Conservative distance threshold
    if (dist > 0 && dist <= maxDistance) {
      return { matched: term, original: token }
    }
  }
  return null
}

// In routeDocInput:
function checkAppRelevance(tokens: string[], knownTerms: Set<string>): boolean {
  for (const token of tokens) {
    // Step 1: Try exact match first
    if (knownTerms.has(token)) {
      return true
    }

    // Step 2: Only fuzzy match if no exact match
    const fuzzyResult = fuzzyMatchTerm(token, knownTerms)
    if (fuzzyResult) {
      // Guardrail 3: Log fuzzy hits for tuning
      logFuzzyHit(fuzzyResult.original, fuzzyResult.matched)
      return true
    }
  }
  return false
}
```

**Guardrails Summary:**
| Guardrail | Purpose |
|-----------|---------|
| Token length ≥ 5 | Avoid short-word false positives |
| Exact match first | Only fuzzy when needed |
| Max distance 1-2 | Conservative threshold |
| Only against knownTerms | Not arbitrary strings |
| Log fuzzy hits | Tune before widening |

**Acceptance Criteria:**
- [ ] "workspac" matches "workspace" (distance 1, length 8)
- [ ] "wrkspace" matches "workspace" (distance 2, length 8)
- [ ] "note" does NOT fuzzy match (length 4 < 5)
- [ ] "wxyz" does NOT match anything (distance > 2)
- [ ] Fuzzy hits logged with original → matched pair
- [ ] Performance acceptable (< 5ms for typical query)
- [ ] False positive rate < 1% (monitor via logs)

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

**Regression Test Table:**
Add a test file with common phrases to prevent pattern drift:

```typescript
// lib/chat/query-patterns.test.ts
const TEST_CASES = [
  // Meta-explain patterns
  { input: "what is workspace", expect: { intent: 'explain', topic: 'workspace' } },
  { input: "what are the actions", expect: { intent: 'explain', topic: 'actions' } },
  { input: "explain notes", expect: { intent: 'explain', topic: 'notes' } },

  // Conversational wrappers
  { input: "can you tell me what is workspace", expect: { intent: 'explain', topic: 'workspace' } },
  { input: "can you pls explain actions", expect: { intent: 'explain', topic: 'actions' } },
  { input: "would you tell me about notes", expect: { intent: 'explain', topic: 'notes' } },

  // Commands
  { input: "open notes", expect: { intent: 'action', action: 'open' } },
  { input: "show workspace", expect: { intent: 'action', action: 'show' } },
  { input: "go to dashboard", expect: { intent: 'navigate', target: 'dashboard' } },

  // Bare nouns
  { input: "workspace", expect: { intent: 'explain', topic: 'workspace' } },
  { input: "notes", expect: { intent: 'explain', topic: 'notes' } },

  // Follow-ups (should NOT be classified as new questions)
  { input: "tell me more", expect: { intent: 'followup' } },
  { input: "can you tell me more", expect: { intent: 'followup' } },

  // Non-app queries
  { input: "what is the weather", expect: { intent: 'unknown' } },
  { input: "hello", expect: { intent: 'unknown' } },
]

describe('normalizeQuery', () => {
  test.each(TEST_CASES)('$input', ({ input, expect }) => {
    const result = normalizeQuery(input)
    expect(result.intent).toBe(expect.intent)
    // ... additional assertions
  })
})
```

**Acceptance Criteria:**
- [ ] All patterns in single module (`lib/chat/query-patterns.ts`)
- [ ] Single `normalizeQuery()` entry point
- [ ] Test table with 20+ common phrases
- [ ] CI runs pattern tests on every change
- [ ] No regressions when adding new patterns

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

### TD-7: Stricter App-Relevance Fallback

**Priority:** Medium
**Effort:** Medium

**Current State:**
The app-relevance fallback routes queries to doc retrieval if ANY token matches `CORE_APP_TERMS` or `knownTerms`:

```typescript
// chat-navigation-panel.tsx (routeDocInput Step 7)
if (isAppRelevant) {
  return 'doc'  // Routes to doc retrieval
}
return 'llm'
```

**Problem:**
- Too permissive: "I love workspace music" routes to doc retrieval because "workspace" matches
- No intent verification: keyword presence ≠ intent to query docs
- Can send irrelevant queries to DB (wasted load)
- User gets confusing results when query wasn't really about the app

**Proposed Solution:**

Option A: Require intent cue + keyword
```typescript
// Stricter: need BOTH intent cue AND app keyword
const hasIntentCue = hasQuestionIntent(normalized) || hasActionVerb(normalized)
const hasAppKeyword = tokens.some(t => CORE_APP_TERMS.has(t) || knownTerms?.has(t))

if (hasIntentCue && hasAppKeyword) {
  return 'doc'
}
```

Option B: Clarifying question for borderline cases
```typescript
// When keyword present but no clear intent, ask instead of forcing
if (hasAppKeyword && !hasIntentCue) {
  return 'clarify'  // "Are you asking about workspaces in this app?"
}
```

Option C: Semantic fallback classifier (lightweight LLM)
```typescript
// For borderline cases, use small LLM to determine intent
if (hasAppKeyword && !hasIntentCue) {
  const result = await classifyAppRelevance(trimmedInput)
  return result.isAppRelevant ? 'doc' : 'llm'
}
```

**Trade-offs:**
| Option | Pros | Cons |
|--------|------|------|
| A: Intent + keyword | Simple, no latency | May miss valid queries |
| B: Clarifying question | Safe UX, no false routes | Extra interaction |
| C: Semantic classifier | Best accuracy | Latency, cost |

**Acceptance Criteria:**
- [ ] "I love workspace music" does NOT route to doc retrieval
- [ ] "what is workspace" still routes correctly
- [ ] "workspace" (bare noun) still routes correctly
- [ ] Borderline cases handled gracefully (clarify or reject)
- [ ] No increase in false negatives for valid queries

---

## Recommended Execution Order

| Order | Item | Rationale |
|-------|------|-----------|
| 1 | TD-4: Durable Telemetry | Get data before optimizing |
| 2 | TD-1: Eliminate duplication | Remove maintenance burden |
| 3 | TD-3: Consolidate patterns | Easier future changes |
| 4 | TD-2: Fuzzy matching | Handle common typos |
| 5 | TD-7: Stricter relevance | Reduce false positives (needs TD-1,3 first) |
| 6 | TD-5: Follow-up guard | Only if telemetry shows issue |
| 7 | TD-6: LLM intent | Only if data shows need |

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| CORE_APP_TERMS becomes stale | Medium | Low | Add sync check in CI |
| Regex patterns miss new phrasings | High | Low | Telemetry alerts |
| Fuzzy matching too permissive | Low | Medium | Conservative distance threshold |
| LLM latency unacceptable | Medium | High | Cache common queries |
| Polite follow-ups treated as new questions | Low | Low | Monitor in telemetry first |
| App-relevance fallback too permissive | Medium | Low | Stricter intent + keyword check |

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
