# Proposal: Cross-Doc Ambiguity Override for Same-Doc Tie Collapse

## Goal
Prevent same-doc tie collapse from hiding a distinct doc that scores equally well.
Fixes cases like "workspace" where both `actions/workspaces` and `concepts/workspace`
score the same, but the top two chunks are from the action doc.

## Problem
Same-doc tie collapse returns a **weak** single-doc clarification when the top two
chunks share a `doc_slug`. This can suppress a different doc that is equally relevant
but ranked just below due to the per-doc cap.

## Proposed Rule (Override)
If the top two results are from the same doc **and** a different doc exists within
`MIN_GAP` of the top score, return **ambiguous** between the top result and the
best distinct-doc candidate.

Pseudo-logic:
- If `topResults[0].doc_slug === topResults[1].doc_slug` and `(topScore - secondScore) < MIN_GAP`:
  - Find the best candidate with a different `doc_slug` and score within `MIN_GAP`
  - If found -> `status: ambiguous` with `[topResult, crossDocCandidate]`
  - Else -> keep same-doc `weak` behavior

## Clarification Copy (cross-doc)
- "Do you mean \"{topResult.header_path}\" or \"{crossDoc.header_path}\"?"

## Acceptance Tests
1. Query: "workspace"
   - Expected: **ambiguous** between `concepts/workspace` and `actions/workspaces`
2. Query: "home"
   - Expected: **weak** (single clarification, no pills)
3. Query: "widgets"
   - Expected: **ambiguous** (cross-doc)

## Status
Proposed (not implemented)
