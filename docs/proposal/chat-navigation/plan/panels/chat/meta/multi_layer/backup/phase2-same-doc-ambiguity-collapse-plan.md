# Phase 2.1: Same-Doc Ambiguity Collapse

## Goal
Avoid confusing clarifications when the top two results are chunks from the **same doc** with equal scores (e.g., `Home > Home` vs `Home > Overview`). Instead of asking the user to choose between two sections of the same doc, collapse to a single clarification.

## Problem
Current Phase 2 behavior treats tied chunks as ambiguous even when they share `doc_slug`. This produces low-value prompts:
- "Do you mean \"Home > Home\" or \"Home > Home > Overview\"?" (both from the same doc)

## Approach (Minimal)
After chunk de-duplication, if the **top two results share the same `doc_slug`**, treat the result as **weak** and ask a single clarification based on the top result.

### Rule
- If `topResults.length > 1` and `topResults[0].doc_slug === topResults[1].doc_slug`:
  - Return `status: weak`
  - Use a single clarification prompt anchored to `topResults[0].header_path`
  - Provide up to 1 result in the response (keep evidence for logs)

### Clarification Copy (single doc)
- "I found info in \"{header_path}\". Is that what you meant?"

## Implementation Sketch
**File:** `lib/docs/keyword-retrieval.ts`

1. After `topResults` computed and before ambiguity checks:
   - Check same-doc tie
   - Return `weak` with single clarification
2. Preserve existing ambiguity logic for different docs.

## Acceptance Tests
1. Query: `"home"`
   - Expected: `weak` (single clarification, no A/B choice)
2. Query: `"workspace"`
   - Expected: `weak` (single clarification, no A/B choice)
3. Query: Two different docs with close scores (e.g., `"widgets"`)
   - Expected: `ambiguous` with two options

## Rollback
Remove the same-doc tie check to restore current ambiguity behavior.

## Status
✅ Implemented (2026-01-11)

## Verification Results

| Query | Expected | Actual | Pass |
|-------|----------|--------|------|
| "home" | weak (single clarification) | weak: "I found info in \"Home > Home\"..." | ✅ |
| "workspace" | weak (single clarification) | weak: "I found info in \"Workspace Actions > Workspace Actions\"..." | ✅ |
| "actions overview" | ambiguous (cross-doc) | ambiguous: "Navigation Actions" or "Note Actions" | ✅ |

**Implementation:** `lib/docs/keyword-retrieval.ts:695-708` - same-doc tie check before cross-doc ambiguity check.
