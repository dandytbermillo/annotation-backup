# Proposal Review: Definitional Query Fix (Revised)

## Status
Advisory revision (no code changes).

## Executive Summary (Updated)
The observed failure for "what is workspace" is not because the concept doc is missing.
`concepts/workspace` appears in the scored results, but it is suppressed by the
same-doc tie collapse rule because the top two chunks come from `actions/workspaces`.

Therefore, the smallest fix is to adjust ambiguity handling so a distinct doc within
`MIN_GAP` can surface as ambiguous (pills). Definitional intent signaling is optional
and can be layered later to auto-select a concept doc without pills.

## Evidence (Corrected)
Scoring for query "workspace" yields (example):
- actions/workspaces: Overview (score 3)
- actions/workspaces: Supported actions (score 3)
- concepts/workspace: Overview (score 3)

Because the top two results are from the same doc, the same-doc tie collapse returns
`weak` with a single clarification. The concept doc is present but hidden.

## Issue Corrections vs Original Proposal
- Incorrect: "concepts/workspace is not in results at all".
- Correct: it is in results but suppressed by same-doc tie collapse + per-doc cap.

## Recommended Fix Order (Split into Clear Steps)

### Step 1 (Minimal / High Impact)
**Cross-doc ambiguity override for same-doc tie collapse.**
If the top two results are from the same doc AND a distinct doc exists within `MIN_GAP`,
return ambiguous with those two docs. Otherwise keep same-doc weak behavior.

This directly fixes the workspace case without new API fields or UI hints.

### Step 2 (Independent Improvement)
**HS1 guard for retrieveByDocSlug** (if not present).
Ensure slug-based selection skips heading-only chunk 0 and returns the first chunk with
body content. This improves pill selection and direct doc lookups.

### Step 3 (Optional / Later)
**Definitional intent bias (auto-answer) for "what is X".**
If you want auto-selection without pills, add definitional intent signaling from UI to
backend, and apply a small concept bias or concept-preference logic. This is a larger
behavioral change and should come after Step 1 is stable.

## Why Step 1 Is Safer Than the Original 3-Item Patch
- No contract changes to `/api/docs/retrieve`
- No changes to cache policy
- No extra DB queries
- Directly addresses the actual failure mechanism

## Acceptance Tests (Revised)
1. Query: "workspace"
   - Expected: ambiguous pills between `concepts/workspace` and `actions/workspaces`
2. Query: "home"
   - Expected: weak (single clarification, no pills)
3. Query: "widgets"
   - Expected: ambiguous (cross-doc)

## Notes on the Optional Definitional Path
If you still want the definitional auto-answer behavior, keep it as a separate phase.
When implemented, it should:
- Avoid action-like queries ("actions", "create", "delete", etc.)
- Preserve pills if confidence is low
- Avoid overriding cross-doc ambiguity unless explicitly requested

