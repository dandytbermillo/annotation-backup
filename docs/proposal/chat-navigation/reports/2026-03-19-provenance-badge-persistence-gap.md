# Known Issue: Provenance Badge Lost After Entry Navigation

**Date:** 2026-03-19
**Status:** Tracked, not yet fixed
**Severity:** Low (cosmetic — routing/execution is correct)

## Problem

Provenance badges (Deterministic, Auto-Executed, LLM-Influenced, etc.) disappear for assistant messages that trigger entry/workspace navigation. The message content persists (stored in database), but the badge is lost because `provenanceMap` is in-memory React state that doesn't survive the context tree remount caused by entry navigation.

## Affected Cases

- "hi there open that budget100" → opens entry → badge missing
- "open budget100" → opens entry → badge missing
- Any `open_entry` / `open_workspace` action that causes a surface transition

## Not Affected

- "is any panel open?" → state_info answer, no remount → badge survives ✅
- "open links panel b" → panel drawer open, no remount → badge survives ✅
- "take me home" (already home) → no navigation, no remount → badge survives ✅

## Root Cause

- `provenanceMap` is in-memory only (`chat-navigation-context.tsx:1798`)
- `setProvenance` IS called correctly after the navigate response (`chat-navigation-panel.tsx:2968`)
- But entry navigation triggers a remount/context refresh that clears the in-memory map
- Messages survive because they're persisted via `addMessage` → database
- Provenance labels are not persisted — they exist only in the React state that was lost

## Fix Options

**Robust (recommended):**
- Persist provenance alongside the assistant message metadata (e.g., `provenance` field on the message row)
- Or derive the badge from persisted `tierLabel` / routing metadata on message restore

**Weaker:**
- Preserve `provenanceMap` across navigation/remounts (e.g., persist to sessionStorage)

## Not a Regression

This is a pre-existing architectural limitation. It was not introduced by Phase 4, Phase 5, or V2. It affects any action that causes an entry/workspace navigation remount.
