# Polite Request Routing Fix — Shared Canonicalizer + 3-Part Guardrail

## Context

**Bug:** Queries with extra conversational words fail while clean commands work.

- "open links panel" → correct disambiguation ✓
- "can you open links panel pls" → "Which option did you mean? sample2 F, sample2, Workspace 4?" ✗
- "can you open the links panel" → wrong options or re-shows stale options ✗

**Root causes (3 failure paths):**

1. **Tier 1b.4 fuzzy re-show** (`chat-routing.ts:4164`) swallows command-like panel intents. Core word "link" overlaps with pending option "Links Panel D" → "Please choose one of the options:" with stale options.
2. **Normalization gap** — `stripVerbPrefix` (Tier 2c) and `normalizeForNounMatch` (Tier 4) don't strip articles or trailing filler. "can you open the links panel" → "the links panel" ≠ "links panel" in `KNOWN_NOUN_MAP`.
3. **Tier 4.5 grounding LLM** (`routing-dispatcher.ts:2824`) has no `isSelectionLike` gate. Command inputs get hijacked into `buildGroundedClarifier` → "Which option did you mean? sample2 F...".

---

## Implementation

### Part 1: Shared command canonicalizer

**File:** `lib/chat/input-classifiers.ts`

Create `canonicalizeCommandInput()` — one minimal, deterministic function used by both Tier 2c and Tier 4. **Design constraint:** only strip known prefixes, articles, and trailing filler. No broad conversational parsing that could mutate meaning.

```typescript
/**
 * Canonicalize user input for command/noun matching.
 * Strips polite prefixes, leading articles, and trailing filler words.
 * Shared by Tier 2c (panel-command-matcher) and Tier 4 (known-noun-routing)
 * to prevent normalization drift.
 */
export function canonicalizeCommandInput(input: string): string {
  let normalized = input.toLowerCase().trim()

  // Strip trailing punctuation
  normalized = normalized.replace(/[?!.]+$/, '')

  // Strip polite/verb prefixes (longest first)
  const prefixes = [
    'hey can you please ', 'hey can you pls ',
    'hey could you please ', 'hey could you pls ',
    'can you please ', 'can you pls ',
    'could you please ', 'could you pls ',
    'would you please ', 'would you pls ',
    'can you open ', 'can you show ',
    'could you open ', 'could you show ',
    'would you open ', 'would you show ',
    'please open ', 'pls open ',
    'please show ', 'pls show ',
    'hey open ', 'hey show ', 'hey ',
    'open ', 'show ', 'view ', 'go to ', 'launch ',
  ]
  for (const prefix of prefixes) {
    if (normalized.startsWith(prefix)) {
      normalized = normalized.slice(prefix.length).trim()
      break
    }
  }

  // Strip leading articles
  normalized = normalized.replace(/^(the|a|an)\s+/i, '').trim()

  // Strip trailing politeness/filler
  normalized = normalized.replace(/\s+(pls|please|plz|thanks|thx|now)$/i, '').trim()

  // Normalize whitespace
  return normalized.replace(/\s+/g, ' ').trim()
}
```

**Consumers:**

**A. `lib/chat/panel-command-matcher.ts` (Tier 2c)** — line 213:
```typescript
// Before:
const inputTokens = normalizeToTokenSet(stripVerbPrefix(input))
// After:
import { canonicalizeCommandInput } from './input-classifiers'
const inputTokens = normalizeToTokenSet(canonicalizeCommandInput(input))
```

Keep `stripVerbPrefix` export for backward compat (delegates to `canonicalizeCommandInput`):
```typescript
export function stripVerbPrefix(input: string): string {
  return canonicalizeCommandInput(input)
}
```

**B. `lib/chat/known-noun-routing.ts` (Tier 4)** — `normalizeForNounMatch` (line 88):
```typescript
import { canonicalizeCommandInput } from './input-classifiers'

function normalizeForNounMatch(input: string): string {
  return canonicalizeCommandInput(input)
}
```

This replaces the hand-rolled verb prefix list + whitespace normalization with the shared function, and gains article stripping + trailing filler stripping for free.

### Part 2: Clarification intercept guard

**File:** `lib/chat/chat-routing.ts`, line 4164

Guard Tier 1b.4 fuzzy re-show against command-like panel intents:

```typescript
// Before (line 4164):
if (lastClarification?.options && lastClarification.options.length > 0 && isNewQuestionOrCommandDetected) {
  const normalizedInputForFuzzy = trimmedInput.toLowerCase().trim()
  const inputResemblesOption = lastClarification.options.some(opt => {
    // ... fuzzy check ...
  })
  if (inputResemblesOption) {
    // re-show options
    return { handled: true, ... }
  }
}

// After:
if (lastClarification?.options && lastClarification.options.length > 0 && isNewQuestionOrCommandDetected) {
  // Guard: skip fuzzy re-show if input matches visible panels (command-like panel intent)
  // Only check on dashboard mode where visibleWidgets exist
  const dashboardWidgets = uiContext?.mode === 'dashboard' ? uiContext?.dashboard?.visibleWidgets : undefined
  const panelMatch = dashboardWidgets?.length ? matchVisiblePanelCommand(trimmedInput, dashboardWidgets) : null
  if (panelMatch && panelMatch.type !== 'none') {
    void debugLog({
      component: 'ChatNavigation',
      action: 'tier1b4_skip_panel_command_intent',
      metadata: { input: trimmedInput, matchType: panelMatch.type, matchCount: panelMatch.matches.length },
    })
    // Fall through to normal routing — don't re-show stale options
  } else {
    // Existing fuzzy check (unchanged)
    const normalizedInputForFuzzy = trimmedInput.toLowerCase().trim()
    const inputResemblesOption = lastClarification.options.some(opt => { ... })
    if (inputResemblesOption) { ... }
  }
}
```

`matchVisiblePanelCommand` is already imported in `chat-routing.ts` (line 38). `uiContext` is destructured at line 1246 inside `handleClarificationIntercept`.

**Why this works:** `matchVisiblePanelCommand` now uses `canonicalizeCommandInput` (Part 1), so "can you open links panel pls" → "links panel" → matches visible Links Panel widgets → `type !== 'none'` → skip re-show.

### Part 3: Grounding-set LLM gate (narrowed to command-like panel intents)

**File:** `lib/chat/routing-dispatcher.ts`, line 2824

Gate the Tier 4.5 grounding LLM fallback **narrowly** — skip only for command-like panel intents, not all non-selection inputs. This prevents command-like panel opens from being hijacked while preserving LLM fallback for other unresolved non-selection cases (which would otherwise degrade into wrong Tier 5/doc behavior).

```typescript
// Before (line 2824):
if (groundingResult.needsLLM && groundingResult.llmCandidates && groundingResult.llmCandidates.length > 0) {
  if (isGroundingLLMEnabled()) { ... }
}

// After:
if (groundingResult.needsLLM && groundingResult.llmCandidates && groundingResult.llmCandidates.length > 0) {
  // Narrow gate: skip LLM only for command-like panel intents
  // (explicit command + matches visible panel). Other non-selection inputs still get LLM.
  const isCommandPanelIntent =
    isExplicitCommand(ctx.trimmedInput) &&
    matchVisiblePanelCommand(ctx.trimmedInput, ctx.uiContext?.dashboard?.visibleWidgets).type !== 'none'

  if (isCommandPanelIntent) {
    void debugLog({
      component: 'ChatNavigation',
      action: 'grounding_llm_skipped_command_panel_intent',
      metadata: { input: ctx.trimmedInput, candidateCount: groundingResult.llmCandidates.length,
        reason: 'routing_continues_to_panel_command_path' },
    })
    // Fall through — panel command should be handled by Tier 2c, not grounding LLM
    // NOTE: Routing continues to subsequent tiers. This input should have been
    // caught at Tier 2c; if it reaches here, it means question-intent guard
    // or normalization skipped it. The log above tracks this for diagnostics.
  } else if (isGroundingLLMEnabled()) {
    // Existing LLM fallback logic (unchanged)
    ...
  }
}
```

**New imports needed in `routing-dispatcher.ts`:**
- `import { isExplicitCommand } from '@/lib/chat/input-classifiers'` (already exported there)
- `import { matchVisiblePanelCommand } from '@/lib/chat/panel-command-matcher'` (upgrade from type-only import at line 42)

### Part 4: Tests

**A. Unit tests — `canonicalizeCommandInput`** (`__tests__/unit/chat/input-classifiers.test.ts` or new section):

| Input | Expected Output |
|-------|----------------|
| `"can you open links panel pls"` | `"links panel"` |
| `"hey can you open the links panel"` | `"links panel"` |
| `"please open recent panel"` | `"recent panel"` |
| `"could you show the links panel please"` | `"links panel"` |
| `"open links panel"` | `"links panel"` |
| `"links panel"` | `"links panel"` (no-op) |
| `"open recent"` | `"recent"` |

**B. Unit tests — Tier 1b.4 guard** (update `__tests__/unit/chat/panel-command-matcher.test.ts` or `chat-routing` tests):

- "can you open links panel pls" + active pending options + Links Panels visible → NOT re-shown (falls through)
- "the second one" + active pending options → still re-shown (not a panel intent)

**C. Integration test — full routing** (update `__tests__/integration/chat/panel-disambiguation-tier-ordering.test.ts`):

- "can you open links panel pls" + 3 Links Panel variants → Tier 2c handles disambiguation (handledByTier: 2)
- "hey open the links panel" + single Links Panel D → Tier 2c opens directly
- "can you open links panel pls" + active pending options → Tier 2c (not Tier 1b.4 re-show, not Tier 4.5 grounding)

**D. Exact regression test from screenshot** (the hard case):

- Active Recent panel options shown (sample2 F, sample2, Workspace 4 in widget snapshot) + input "can you open links panel pls" + 3 Links Panel variants visible → must go to panel disambiguation (Links Panels / Links Panel D / Links Panel E), NOT "Which option did you mean? sample2 F, sample2, Workspace 4?"

---

## Files Modified

| File | Changes |
|------|---------|
| `lib/chat/input-classifiers.ts` | Add `canonicalizeCommandInput()` (~30 lines) |
| `lib/chat/panel-command-matcher.ts` | Import `canonicalizeCommandInput`; delegate `stripVerbPrefix`; use in `matchVisiblePanelCommand` |
| `lib/chat/known-noun-routing.ts` | Import `canonicalizeCommandInput`; simplify `normalizeForNounMatch` |
| `lib/chat/chat-routing.ts` | Add panel-match guard at Tier 1b.4 (~10 lines) |
| `lib/chat/routing-dispatcher.ts` | Add `isSelectionLike` gate at LLM fallback (~8 lines) |
| Tests (3 files) | New canonicalizer tests, Tier 1b.4 guard tests, integration natural-variant tests |

## Verification

```bash
npx tsc --noEmit
npx jest __tests__/unit/chat/ __tests__/integration/chat/ --no-coverage --runInBand
```

Manual test with active options present:
1. "open links panel" → disambiguation (3 options) — still works
2. Don't select — "can you open links panel pls" → disambiguation (3 options), NOT "Which option did you mean?"
3. "hey open the links panel" → disambiguation (3 options)
4. "please open recent panel" → "Opening Recent."
5. "the second one" with active options → selects second option (NOT skipped by Part 2 guard)
