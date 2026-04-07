# Proposal: Definitional Query Fix for Doc Retrieval (Revised)

**Date:** 2026-01-14
**Status:** Proposal (Revised)
**Feature Slug:** `chat-navigation`
**Related Plan:** `general-doc-retrieval-routing-plan.md`
**Advisory Review:** `codex/proposal/chat-navigation/plan/definitional-query-fix-proposal-reviewed.md`

---

## Executive Summary (Updated)

When users ask definitional questions like "what is workspace?", the system returns the wrong document (`actions/workspaces`) instead of the concept document (`concepts/workspace`).

**Root cause (corrected):** The concept doc IS in the scored results, but it is **suppressed by same-doc tie collapse** because the top two chunks come from `actions/workspaces`.

**Primary fix:** Cross-doc ambiguity override - if top results are same-doc AND a distinct doc exists within `MIN_GAP`, return ambiguous (pills) instead of weak clarification.

---

## Problem Statement

### Observed Behavior

```
User: "what is workspace"
Bot:  "I found info in 'Workspace Actions > Workspace Actions > Overview'. Is that what you meant?"
      [Returns actions/workspaces instead of concepts/workspace]

User: "tell me more"
Bot:  [Expands actions/workspaces chunks - wrong document]
```

### Expected Behavior (After Fix)

```
User: "what is workspace"
Bot:  [Shows disambiguation pills: "Workspace" (concepts) vs "Workspace Actions" (actions)]

User: [Clicks "Workspace" pill]
Bot:  "A workspace is where notes live. Each workspace belongs to an entry..."
```

---

## Root Cause Analysis (Corrected)

### Verified Evidence

Scoring for query "workspace" yields:

| doc_slug | chunk | score |
|----------|-------|-------|
| `actions/workspaces` | Overview | 3 |
| `actions/workspaces` | Supported actions | 3 |
| `concepts/workspace` | Overview | 3 |
| `concepts/workspace` | Where it appears | 3 |

**Key finding:** `concepts/workspace` IS in the scored list with equal score (3).

### Why It Gets Suppressed

The **same-doc tie collapse** rule triggers:
1. Top two results are from same doc (`actions/workspaces`)
2. Rule: "If top 2 from same doc → return weak, not ambiguous"
3. Result: `concepts/workspace` is hidden, user sees single weak clarification

### Correction from Original Proposal

| Original Assumption | Actual Reality |
|---------------------|----------------|
| `concepts/workspace` not in results | `concepts/workspace` IS in results (score 3) |
| Need concept injection | Just hidden by same-doc tie collapse |
| Root cause: definitional intent lost | Root cause: tie collapse suppression |

---

## Proposed Solution: Prioritized Fix Steps

### Step 1: Cross-Doc Ambiguity Override (Primary Fix)

**File:** `lib/docs/keyword-retrieval.ts`

**Location:** `retrieveChunks()` or `smartRetrieve()`, in the ambiguity/weak determination logic

**Current behavior:**
```typescript
// Same-doc tie collapse (simplified)
if (topResults[0].doc_slug === topResults[1].doc_slug) {
  // Both from same doc → return weak with single clarification
  return { status: 'weak', ... }
}
```

**Proposed override:**
```typescript
// Check for cross-doc candidate before same-doc collapse
const topDocSlug = topResults[0].doc_slug
const topScore = topResults[0].score

// Find ALL distinct docs within MIN_GAP, then pick highest-scoring one
const crossDocCandidates = topResults.filter(r =>
  r.doc_slug !== topDocSlug &&
  (topScore - r.score) < MIN_GAP
)

// Pick the best cross-doc candidate by score (not just first match)
const crossDocCandidate = crossDocCandidates.length > 0
  ? crossDocCandidates.reduce((best, curr) => curr.score > best.score ? curr : best)
  : null

if (crossDocCandidate) {
  // Distinct doc within MIN_GAP exists → return ambiguous (pills)
  // Use header_path for clarification text (consistent with existing UI)
  return {
    status: 'ambiguous',
    results: [topResults[0], crossDocCandidate],
    clarification: `Do you mean "${topResults[0].header_path}" or "${crossDocCandidate.header_path}"?`
  }
}

// No cross-doc candidate → proceed with same-doc weak behavior
if (topResults[0].doc_slug === topResults[1].doc_slug) {
  return { status: 'weak', ... }
}
```

**Logic:**
```
IF top 2 results are from same doc
   AND a distinct doc exists within MIN_GAP
THEN return ambiguous with both docs (pills)
ELSE keep same-doc weak behavior
```

**Benefits:**
- Directly addresses the actual failure mechanism
- No API contract changes
- No cache policy changes
- No extra DB queries
- Users can pick the right doc via pills

---

### Step 2: HS1 Guard for retrieveByDocSlug (Independent Improvement)

**File:** `lib/docs/keyword-retrieval.ts`

**Location:** `retrieveByDocSlug()` function (around line 1034)

**Current:**
```typescript
// Return the first chunk (intro/overview) as the best content
const bestChunk = chunks[0]
const snippet = extractSnippet(bestChunk.content)
```

**Proposed:**
```typescript
// HS1 Guard: Prefer first non-heading-only chunk
let bestChunk = chunks[0]
let snippet = extractSnippet(bestChunk.content)

if (detectIsHeadingOnly(snippet) && chunks.length > 1) {
  for (let i = 1; i < chunks.length; i++) {
    const chunk = chunks[i]
    const candidateSnippet = extractSnippet(chunk.content)
    if (!detectIsHeadingOnly(candidateSnippet)) {
      bestChunk = chunk
      snippet = candidateSnippet
      break
    }
  }
}
```

**Rationale:**
- Ensures pill clicks return useful content (not just `## Workspace`)
- Satisfies HS1 guarantee: "response must contain 1-2 real sentences"
- Independent of Step 1, can be applied separately

---

### Step 3: Definitional Intent Auto-Answer (Optional / Later)

> **Note:** This step is optional and should only be implemented after Step 1 is stable. It provides auto-selection without pills for "what is X?" queries.

If you want the system to auto-select concept docs without showing pills:

1. **Add definitional hint to API request** (UI → API)
2. **Use hint in backend** to prefer `concepts/*` results
3. **Apply small score bias** for concepts when definitional

This is a larger behavioral change and is documented in the original proposal sections below for reference.

<details>
<summary>Click to expand Step 3 details (definitional intent)</summary>

#### Add Definitional Hint (UI → API)

**File:** `components/chat/chat-navigation-panel.tsx`

```typescript
const definitionalConcept = extractMetaExplainConcept(trimmedInput)
const hasActionIntent = definitionalConcept
  ? /\b(action|create|delete|rename|list|open)\b/i.test(trimmedInput)
  : false

const retrieveResponse = await fetch('/api/docs/retrieve', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    query: queryTerm || trimmedInput,
    mode: 'explain',
    isDefinitionalQuery: !!definitionalConcept && !hasActionIntent,
  }),
})
```

#### Use Hint in Backend

```typescript
// In scoring, apply small bias for concepts when definitional
if (options?.isDefinitionalQuery && chunk.doc_slug.startsWith('concepts/')) {
  score += SCORE_CONCEPT_DEFINITIONAL_BIAS  // e.g., +2
}
```

**Trade-offs:**
- Pros: Auto-answers without pills (more "ChatGPT-like")
- Cons: Adds API fields, changes retrieval behavior, requires careful tuning

</details>

---

## Testing Plan

### Test Case 1: Cross-Doc Ambiguity (Step 1)

**Query:** `"workspace"`

**Expected:**
```json
{
  "status": "ambiguous",
  "results": [
    { "doc_slug": "actions/workspaces", "header_path": "Workspace Actions > Workspace Actions > Overview" },
    { "doc_slug": "concepts/workspace", "header_path": "Workspace > Workspace > Overview" }
  ],
  "clarification": "Do you mean \"Workspace Actions > Workspace Actions > Overview\" or \"Workspace > Workspace > Overview\"?"
}
```

**Verification:**
```bash
curl -X POST http://localhost:3000/api/docs/retrieve \
  -H "Content-Type: application/json" \
  -d '{"query": "workspace"}'
```

### Test Case 2: No Cross-Doc Candidate (Unchanged Behavior)

**Query:** `"home"`

**Expected:** `status: "weak"` (single clarification, no pills) - because no cross-doc competitor within MIN_GAP

### Test Case 3: HS1 Guard (Step 2)

**Query:** Direct slug lookup

**Expected:**
```json
{
  "doc_slug": "concepts/workspace",
  "chunk_index": 1,
  "snippet": "## Overview\nA workspace is where notes live..."
}
```

**Verification:**
```bash
curl -X POST http://localhost:3000/api/docs/retrieve \
  -H "Content-Type: application/json" \
  -d '{"docSlug": "concepts/workspace"}'
```

### Test Case 4: End-to-End Chat UI

**Steps:**
1. Type: `"what is workspace"`
2. See: Disambiguation pills (Workspace vs Workspace Actions)
3. Click: "Workspace" pill
4. See: Concept explanation with body content
5. Type: `"tell me more"`
6. See: Next chunk from `concepts/workspace`

---

## Acceptance Criteria

### Step 1 (Cross-Doc Override)
- [ ] `"workspace"` query returns `status: "ambiguous"` with both docs
- [ ] Pills shown for concept vs action choice
- [ ] `"home"` query still returns `status: "weak"` (no cross-doc)
- [ ] Type-check passes

### Step 2 (HS1 Guard)
- [ ] Direct slug lookup returns chunk with body content
- [ ] Pill clicks return useful content
- [ ] Type-check passes

### Step 3 (Optional - Definitional Intent)
- [ ] `"what is workspace"` auto-returns concept doc
- [ ] `"what are workspace actions"` still returns action doc
- [ ] Type-check passes

---

## Implementation Order

| Step | Change | Risk | Dependencies |
|------|--------|------|--------------|
| **1** | Cross-doc ambiguity override | Low | None |
| **2** | HS1 guard in retrieveByDocSlug | Low | None |
| **3** | Definitional intent (optional) | Medium | Step 1 stable |

**Recommended:** Ship Step 1 first, then Step 2. Evaluate Step 3 after observing user behavior.

---

## Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| Cross-doc override shows too many pills | Only triggers when distinct doc is within MIN_GAP |
| HS1 guard returns wrong chunk | Guard picks first non-heading chunk in order |
| Breaks existing behavior | Step 1 is additive (more pills), not destructive |

---

## Files to Modify

| Step | File | Change |
|------|------|--------|
| 1 | `lib/docs/keyword-retrieval.ts` | Add cross-doc check before same-doc collapse |
| 2 | `lib/docs/keyword-retrieval.ts` | Add HS1 guard in `retrieveByDocSlug` |
| 3 | `components/chat/chat-navigation-panel.tsx` | Add `isDefinitionalQuery` to API request |
| 3 | `lib/docs/keyword-retrieval.ts` | Add concept bias for definitional queries |

---

## References

- `codex/proposal/chat-navigation/plan/definitional-query-fix-proposal-reviewed.md` (Advisory review)
- `docs/proposal/chat-navigation/plan/panels/chat/meta/general-doc-retrieval-routing-plan.md`
- `docs/proposal/chat-navigation/plan/panels/chat/meta/report/2026-01-11-phase2-chunk-retrieval-implementation-report.md`
- HS1/HS2 specifications in routing plan

---

## Appendix: Database Evidence

### Workspace Docs in Database

| doc_slug | title | category |
|----------|-------|----------|
| `concepts/workspace` | Workspace | concepts |
| `actions/workspaces` | Workspace Actions | actions |

### Scoring Evidence (Verified)

Query "workspace" produces:

| doc_slug | chunk | score |
|----------|-------|-------|
| `actions/workspaces` | Overview | 3 |
| `actions/workspaces` | Supported actions | 3 |
| `concepts/workspace` | Overview | 3 |
| `concepts/workspace` | Where it appears | 3 |

**Conclusion:** `concepts/workspace` is present but hidden by same-doc tie collapse.

### Chunk 0 Content (Why HS1 Needed)

| doc_slug | chunk_index | content |
|----------|-------------|---------|
| `concepts/workspace` | 0 | `## Workspace` (heading-only) |
| `concepts/workspace` | 1 | `## Overview\nA workspace is where notes live...` |
| `actions/workspaces` | 0 | `## Workspace Actions` (heading-only) |
| `actions/workspaces` | 1 | `## Overview\nWorkspace actions manage...` |

Both docs have heading-only chunk 0, confirming HS1 guard is essential for pill clicks.
