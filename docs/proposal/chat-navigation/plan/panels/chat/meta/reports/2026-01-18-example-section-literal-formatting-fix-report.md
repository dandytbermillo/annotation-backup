# Implementation Report: HS3 Follow-up Formatting Fixes

**Date:** 2026-01-18 (Updated: 2026-01-19)
**Feature Slug:** chat-navigation
**Status:** Verified ✅
**Verification:** Manual smoke test (user screenshots) + code review (line numbers confirmed)

### Verification Evidence

**Test scenario:** "what are the workspace actions" → select pill → 6× "more" follow-ups

| Follow-up | Expected | Actual | Pass |
|-----------|----------|--------|------|
| more #2 | Literal example list | "Here are some examples: • list workspaces • create workspace Research..." | ✅ |
| more #4 | No "I don't see that info" | HS3 formatted content (vague guard working) | ✅ |
| more #5 | Literal related list | "Related topics: • Action • Entry • Dashboard • Workspace" | ✅ |
| more #6+ | Exhausted message | "That's all I have on this topic..." | ✅ |

**Code verification:** Lines 755-757 (example/related detection), 793-794 (vague followup guard) confirmed matching report.

---

## Executive Summary

This report documents three related fixes for misleading HS3 responses during follow-up queries:

1. **Example Section Literal Formatting** - Prevents "Sure! It looks like you're interested in 'Open workspace Sprint 6'..." responses
2. **Related Section Literal Formatting** - Prevents "It looks like you're interested in learning more about the different components..." responses
3. **Vague Follow-up Query Guard** - Prevents "I don't see that info in this section." responses

All three issues stemmed from HS3 (LLM-based bounded formatting) mishandling specific content types or query patterns during follow-up expansions.

---

## Issue 1: Example Section Misleading Responses

### Symptoms

After 3-4 "tell me more" follow-up queries, response showed:

```
Sure! It looks like you're interested in the "Open workspace Sprint 6"...
```

### Root Cause

1. **Source:** `docs/proposal/chat-navigation/plan/panels/chat/meta/documentation/concepts/workspace.md`

2. **Document structure:**
   ```
   Chunk 1: Overview
   Chunk 2: Where it appears
   Chunk 3: Key behaviors
   Chunk 4: Example questions  ← Problem source
   Chunk 5: Related concepts
   ```

3. **Example section content:**
   ```markdown
   ## Example questions
   - "Open workspace Sprint 6"
   - "Which notes are open?"
   - "Explain workspace"
   ```

4. **What happened:** HS3 received this list and reformatted it conversationally, inferring user intent from the example text "Open workspace Sprint 6".

### Fix Applied

**File:** `lib/chat/chat-routing.ts` (lines 755-757)

Detect example sections via `header_path` and format as literal bullet list:

```typescript
const isExampleSection = /\bexample/i.test(headerPath)
```

**Output after fix:**
```
Here are some examples:
• list workspaces
• create workspace Research
• rename workspace Sprint 5 to Sprint 6
• delete workspace Old
• open workspace Sprint 6
```

---

## Issue 2: Related Section Misleading Responses

### Symptoms

After exhausting other chunks, response showed:

```
It looks like you're interested in learning more about the different components
available in the workspace. The main elements include Action, Entry, Dashboard,
and Workspace itself. Each of these plays a unique role in how you interact
with your projects and data.
```

### Root Cause

1. **Source:** Same docs with "Related concepts" sections

2. **Related section content:**
   ```markdown
   ## Related concepts
   - Action
   - Entry
   - Dashboard
   - Workspace
   ```

3. **What happened:** HS3 reformatted this simple list into misleading conversational prose, similar to the example section issue.

### Fix Applied

**File:** `lib/chat/chat-routing.ts` (lines 755-757)

Extended detection to include "related" sections:

```typescript
const isExampleSection = /\bexample/i.test(headerPath)
const isRelatedSection = /\brelated/i.test(headerPath)
const isLiteralListSection = isExampleSection || isRelatedSection
```

Dynamic intro text based on section type:

```typescript
const introText = isExampleSection ? 'Here are some examples' : 'Related topics'
const singleIntro = isExampleSection ? 'Example' : 'Related'
```

**Output after fix:**
```
Related topics:
• Action
• Entry
• Dashboard
• Workspace
```

---

## Issue 3: "I don't see that info" Response

### Symptoms

Occasionally during follow-ups, response showed:

```
I don't see that info in this section.
```

### Root Cause

1. **Source:** HS3 prompt in `app/api/chat/format-snippet/route.ts` (line 66):
   ```
   - If the excerpt doesn't contain the answer, say "I don't see that info in this section."
   ```

2. **What happened:**
   - User says "tell me more"
   - Follow-up handler passes `userQuery = "tell me more"` to HS3
   - HS3 prompt becomes: `User's question: "tell me more"`
   - HS3 constraint: "If the excerpt doesn't contain the answer..."
   - LLM correctly determines "tell me more" isn't a real question the excerpt can "answer"
   - Returns the fallback message

3. **Flow diagram:**
   ```
   User: "tell me more"
        ↓
   handleFollowUp()
        ↓
   maybeFormatSnippetWithHs3(snippet, "tell me more", ...)
        ↓
   HS3 Prompt: "User's question: 'tell me more'"
        ↓
   LLM: "I don't see that info in this section."
   ```

### Fix Applied

**File:** `lib/chat/chat-routing.ts` (lines 791-794)

Added guard to detect vague pronoun-style follow-ups and omit `userQuery`:

```typescript
// Guard: Don't pass vague pronoun-style queries to HS3 (e.g., "tell me more", "continue")
// These cause HS3 to say "I don't see that info" since they're not real questions
const isVagueFollowup = /^(tell me more|more|continue|go on|keep going|and\??|yes|ok|okay)$/i.test(trimmedInput.trim())
const hs3Query = isVagueFollowup ? '' : trimmedInput
```

**Vague patterns detected:**
| Pattern | Example |
|---------|---------|
| `tell me more` | "tell me more" |
| `more` | "more" |
| `continue` | "continue" |
| `go on` | "go on" |
| `keep going` | "keep going" |
| `and?` | "and", "and?" |
| `yes/ok/okay` | "yes", "ok", "okay" |

**Specific queries preserved:**
- "tell me about deletion" → passed to HS3
- "what about creation?" → passed to HS3
- "explain the switch action" → passed to HS3

---

## Complete Implementation

**File:** `lib/chat/chat-routing.ts` (lines 751-802)

```typescript
// Check if we actually have new content
if (rawSnippet.length > 0) {
  // Detect list-type sections that should be shown verbatim, not reformatted
  // to avoid misleading "you're interested in..." conversational inferences
  // Covers: "Examples", "Example questions", "Related concepts", "Related topics"
  const isExampleSection = /\bexample/i.test(headerPath)
  const isRelatedSection = /\brelated/i.test(headerPath)
  const isLiteralListSection = isExampleSection || isRelatedSection

  // Strip markdown headers before HS3 for cleaner output
  const strippedSnippet = stripMarkdownHeadersForUI(rawSnippet)
  const snippetForHs3 = strippedSnippet.length > 0 ? strippedSnippet : rawSnippet

  let hs3Result: { ... }

  if (isLiteralListSection) {
    // List-type sections: format as literal list, skip HS3 to avoid misleading rewrites
    const listLines = snippetForHs3
      .split('\n')
      .map((line: string) => line.trim())
      .filter((line: string) => line.length > 0)

    // Choose appropriate intro based on section type
    const introText = isExampleSection ? 'Here are some examples' : 'Related topics'
    const singleIntro = isExampleSection ? 'Example' : 'Related'

    const formattedList = listLines.length > 1
      ? `${introText}:\n${listLines.map((l: string) => `• ${l.replace(/^[-•]\s*/, '').replace(/^["']|["']$/g, '')}`).join('\n')}`
      : `${singleIntro}: ${listLines[0]?.replace(/^[-•]\s*/, '').replace(/^["']|["']$/g, '') || snippetForHs3}`

    hs3Result = {
      ok: false,
      finalSnippet: formattedList,
      latencyMs: 0,
      triggerReason: undefined,
    }
  } else {
    // Normal content: apply HS3 bounded formatting
    const appendedChunkCount = excludeChunkIds.length + 1

    // Guard: Don't pass vague pronoun-style queries to HS3
    const isVagueFollowup = /^(tell me more|more|continue|go on|keep going|and\??|yes|ok|okay)$/i.test(trimmedInput.trim())
    const hs3Query = isVagueFollowup ? '' : trimmedInput

    hs3Result = await maybeFormatSnippetWithHs3(
      snippetForHs3,
      hs3Query,
      'medium',
      appendedChunkCount,
      docRetrievalState.lastDocSlug
    )
  }
  // ... rest of handler
}
```

---

## TypeScript Fixes

### Error 1: Implicit `any` type on callback parameters

```typescript
// Before (error)
.map(line => line.trim())

// After (fixed)
.map((line: string) => line.trim())
```

### Error 2: String not assignable to union type

```typescript
// Before (error)
triggerReason?: string

// After (fixed)
triggerReason?: 'long_snippet' | 'steps_request' | 'two_chunks'
```

---

## Verification

### Test Flow: "what are the workspace actions" + multiple "more" follow-ups

| # | Response | Status |
|---|----------|--------|
| Initial | "Workspace Actions > Overview" content | ✅ Good |
| more #1 | Supported actions list | ✅ Good |
| more #2 | "Here are some examples: • list workspaces..." | ✅ **EXAMPLES FIX** |
| more #3 | Behavior notes | ✅ Good |
| more #4 | HS3 formatted content (no "I don't see that info") | ✅ **VAGUE GUARD FIX** |
| more #5 | "Related topics: • Action • Entry..." | ✅ **RELATED FIX** |
| more #6+ | "That's all I have on this topic..." | ✅ Exhausted |

### Type Check
```bash
$ npm run type-check
# Passes with no errors
```

---

## Files Modified

| File | Lines | Change |
|------|-------|--------|
| `lib/chat/chat-routing.ts` | 751-802 | Added literal list detection, vague followup guard |

---

## Risk Assessment

### Low Risk

1. **Localized changes:** All fixes are in the follow-up handler path only
2. **No state changes:** Does not modify chunk tracking or session state
3. **Easily reversible:** Each fix can be removed independently
4. **Defensive coding:** Handles edge cases gracefully

### Potential Edge Cases (Acceptable)

1. **"Counter-example" sections:** Would trigger literal formatting (correct behavior)
2. **"Related work" sections:** Would trigger literal formatting (correct behavior)
3. **"More details" as query:** Regex doesn't match, passes to HS3 (correct - it's specific)

---

## Telemetry Impact

- Example/Related sections: `hs3_called: false`, `hs3_latency_ms: 0`
- Vague follow-ups: HS3 called but with empty `userQuery`
- Allows tracking section type distribution in follow-ups

---

## Summary of Causes and Fixes

| Issue | Cause | Fix |
|-------|-------|-----|
| "Sprint 6" misleading response | HS3 reformatting example lists conversationally | Detect `/\bexample/i` in header_path, format as literal list |
| "interested in components" response | HS3 reformatting related concept lists conversationally | Detect `/\brelated/i` in header_path, format as literal list |
| "I don't see that info" response | HS3 receiving "tell me more" as userQuery, can't "answer" it | Guard vague patterns, pass empty string to HS3 |

---

## Conclusion

All three fixes address related issues where HS3's conversational reformatting produced misleading or unhelpful responses during follow-up queries. The fixes are minimal, targeted, and preserve normal HS3 formatting for substantive content while protecting list-type sections and handling vague follow-up patterns appropriately.
