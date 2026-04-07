# Verify Query Guard Plan (Prevent Typo Fallback)

**Status:** IMPLEMENTED
**Implementation Date:** 2026-01-05

## Purpose
Prevent the typo fallback from intercepting verification questions like:
“did I open …” / “did I rename …” / “did I delete …”

## Problem
The current verb detection does not recognize “did I …” patterns, so the
no‑verb fallback path triggers typo suggestions instead of letting the LLM
classify the intent as `verify_action`.

## Proposed Fix
Add a deterministic guard so **verify queries skip typo fallback**:

### Option A (Minimal)
- Extend verb regex to include “did”
- Treat inputs starting with “did I” or “did I just” as having a verb

### Option B (Cleaner)
- Add a verify‑query detector:
  - If input matches `/^did\s+i\b/i`, bypass typo fallback entirely
  - Let LLM parse it as `verify_action`

## Implementation Steps
1) In `app/api/chat/navigate/route.ts`
   - Add `isVerifyQuery` detection before the no‑verb branch
   - If `isVerifyQuery`, skip typo fallback
2) Keep existing typo fallback for other inputs

## Test Checklist
- [x] "did i open demo widget?" → verify_action (no typo fallback) ✅ VERIFIED
- [x] "did i opeen demo widget?" → verify_action (LLM handles typo) ✅ VERIFIED
- [x] "did i rename sprint 5?" → verify_action ✅ VERIFIED
- [x] "oopen demo widget" → typo fallback (unchanged) ✅ VERIFIED

## Rollback
Remove verify‑query guard, revert to previous behavior.

## Isolation Reactivity Anti-Patterns
Not applicable.
