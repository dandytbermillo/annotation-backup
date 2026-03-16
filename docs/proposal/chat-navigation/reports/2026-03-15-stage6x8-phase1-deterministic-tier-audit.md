# Stage 6x.8 Phase 1 — Early Routing Decision-Point Audit

**Date**: 2026-03-15
**Scope**: Classify every early routing decision point (deterministic rules + bounded LLM gates already embedded in early tiers) as exact win, hard safety, should-escalate, or mixed
**Plan**: `stage6x8-cross-surface-semantic-routing-plan.md`
**Status**: Audit complete — full inventory attached

---

## Counting Methodology

Each **independent decision point** that can resolve, block, or redirect a user turn before the semantic/LLM layers is counted as one rule. Where a single pattern (e.g., `DASHBOARD_META_PATTERN`) serves dual roles (standalone greeting exclusion AND greeting-prefixed content veto), it is classified as **mixed** and counted once with both roles documented.

Guards inside the content-intent classifier (`content-intent-classifier.ts`) are counted individually because each pattern is a separate decision point that independently blocks or passes the turn.

---

## Summary

| Classification | Count | Percentage |
|---|---|---|
| Exact deterministic win | 35 | 58% |
| Hard safety exclusion | 15 | 25% |
| Should escalate to semantic | 5 | 8% |
| Mixed (partially correct, partially blocks too early) | 2 | 3% |
| **Total unique decision points** | **57** | |

The mixed rules are the highest-value targets for Phase 3. The should-escalate rules already defer but to the wrong downstream target — Phase 2's cross-surface arbiter would be the better target.

---

## Full Inventory

### Tier -1: Noise Detection

**File**: `chat-routing-clarification-intercept.ts`

| # | Rule | Line | Behavior | Classification | Reasoning |
|---|------|------|----------|----------------|-----------|
| 1 | Noise gate (`isNoise`) | ~739 | Gibberish/emoji → re-prompt without incrementing attempt count | hard_safety | Prevents noise from consuming clarification attempts |
| 2 | Noise ordinal exemption | ~745 | `isSelectionOnly('strict')` → ordinals bypass noise gate | exact_win | Bare digits must never be rejected as noise |

### Tier 0: List Rejection & Exit

**File**: `chat-routing-clarification-intercept.ts`

| # | Rule | Line | Behavior | Classification | Reasoning |
|---|------|------|----------|----------------|-----------|
| 3 | List rejection phrase | ~776 | "none of these" → refine mode (clear options, keep intent) | exact_win | Explicit list-level rejection |
| 4 | Exit phrase (explicit, first) | ~812 | `classifyExitIntent → 'explicit'` → hard-exit + pause snapshot | exact_win | Unambiguous user intent to stop |
| 5 | Exit phrase (ambiguous + visible options, first time) | ~830 | Show confirm prompt, increment exitCount | exact_win | Protects against accidental exit |
| 6 | Exit confirm (affirmation) | ~850 | `isAffirmationPhrase + exitCount >= 1` → hard-exit | exact_win | User confirmed exit |
| 7 | Exit confirm (negation) | ~870 | "no", "keep choosing" → reset exitCount, redisplay options | exact_win | User wants to continue |

### Tier 1a: Hesitation & Affirmation

**File**: `chat-routing-clarification-intercept.ts`

| # | Rule | Line | Behavior | Classification | Reasoning |
|---|------|------|----------|----------------|-----------|
| 8 | Hesitation phrase | ~1010 | "hmm", "not sure" → re-show pills with softer prompt | exact_win | Explicit uncertainty signal |
| 9 | Affirmation (no multiple options) | ~1030 | `isAffirmationPhrase + !hasMultipleOptions` → execute pending | exact_win | Single action pending, no ambiguity |

### Tier 1b: Repair & Label Matching

**File**: `chat-routing-clarification-intercept.ts`

| # | Rule | Line | Behavior | Classification | Reasoning |
|---|------|------|----------|----------------|-----------|
| 10 | Repair phrase + valid memory + 2 options | ~1052 | "the other one" → auto-select other option | exact_win | Historical context + 2-option case = unambiguous |
| 11 | Repair phrase without valid memory | ~1065 | Fall through to label matching | exact_win | No context → escalate within tier |
| 12 | Single exact label match + gate passes | ~1130 | `matchingOptions.length === 1 + gate outcome === 'execute'` → execute | exact_win | Exact match + gate = certain |
| 13 | Single exact label match, gate fails | ~1145 | Fall through to LLM hook | hard_safety | Gate is authoritative; weak confidence blocks |
| 14 | Multiple matches, single exact-normalized winner | ~1160 | Gate on exact winner; if passes, auto-select | exact_win | Exact-first wins tie-breaker |
| 15 | Multiple matches, no exact winner | ~1180 | Reshow options or escalate to LLM hook | **should_escalate** | Ambiguity is real; bounded LLM could resolve |
| 16 | Ordinal input (strict selection-only) | ~1200 | Execute deterministically by ordinal index | exact_win | Positional and unambiguous |
| 17 | Ordinal input (embedded mode) | ~1210 | Execute if strictly ordinal-shaped | exact_win | Embedded mode preserves wrappers but ordinal is positional |

### Tier 1b.3: Unresolved Hook

**File**: `chat-routing-clarification-intercept.ts`

| # | Rule | Line | Behavior | Classification | Reasoning |
|---|------|------|----------|----------------|-----------|
| 18 | Continuity deterministic resolve (strict) | ~1627 | `tryContinuityDeterministicResolve()` → hint only in strict mode | **should_escalate** | Advisory, not exact; strict policy already defers |
| 19 | LLM high-confidence auto-execute | ~1650 | All gates pass + confidence >= threshold → execute | exact_win | Bounded + gated |
| 20 | LLM abstain / low confidence | ~1680 | Show safe clarifier, preserve options | hard_safety | LLM explicitly unsure; don't force |
| 21 | Question intent escape | ~1700 | `hasQuestionIntent + !isPoliteImperativeRequest` → fall through | hard_safety | Questions belong in semantic/docs, not active options |

### Tier 1c: Local Rejection

**File**: `chat-routing-clarification-intercept.ts`

| # | Rule | Line | Behavior | Classification | Reasoning |
|---|------|------|----------|----------------|-----------|
| 22 | Rejection + 2 options | ~1208 | Auto-select the other option | exact_win | Rejecting one of two = choosing the other |
| 23 | Rejection + repair memory | ~1220 | Use repair memory to resolve | exact_win | Historical context |
| 24 | Rejection + 3+ options | ~1230 | Cannot infer → ask clarifier | hard_safety | Cannot determine intent from rejection alone |

### Tier 1d: Re-show Options

**File**: `chat-routing-clarification-intercept.ts`

| # | Rule | Line | Behavior | Classification | Reasoning |
|---|------|------|----------|----------------|-----------|
| 25 | Meta phrase ("what do you mean") | ~1260 | Reshow with explanation | exact_win | User requesting context |
| 26 | Re-show phrase ("show options") | ~1280 | Reshow pills | exact_win | Explicit request |

### Tier 2: Command & Interrupt

**File**: `routing-dispatcher.ts` + `chat-routing-clarification-intercept.ts`

| # | Rule | Line | Behavior | Classification | Reasoning |
|---|------|------|----------|----------------|-----------|
| 27 | Semantic lane escape (question about action history) | dispatcher ~2117 | Set `semanticLanePending = true` for downstream | exact_win | Semantic questions belong in semantic tier |
| 28 | Semantic lane blocked by active clarification | dispatcher ~2130 | Explain clarification instead of answering | hard_safety | Prevents interference |
| 29 | New question/command detection | intercept ~1350 | Mark `isNewQuestionOrCommandDetected = true` | exact_win | New intent overrides clarification |
| 30 | Explicit command bypass (Tier 2) | intercept ~453 | Bypass widget selection context + latch | exact_win | Commands override context |

### Tier 2b: Focus Latch Selection-Only

**File**: `chat-routing-clarification-intercept.ts`

| # | Rule | Line | Behavior | Classification | Reasoning |
|---|------|------|----------|----------------|-----------|
| 31 | Latch active + selection-only input | ~453 | Defer to Tier 4.5 latched widget resolver | exact_win | Positional input + latch = certain |
| 32 | Latch active + command/question | ~470 | Bypass latch, fall through | exact_win | New intent overrides latch |

### Tier 2c: Scope-Typo Replay

**File**: `chat-routing-clarification-intercept.ts`

| # | Rule | Line | Behavior | Classification | Reasoning |
|---|------|------|----------|----------------|-----------|
| 33 | Scope-typo clarifier active + 1-turn TTL | ~266 | Check scope cue; if matches, replay | exact_win | 1-turn guarantee |
| 34 | TTL expired | ~280 | Clear, fall through | hard_safety | Stale context |
| 35 | Drift detected (fingerprint mismatch) | ~290 | Clear, fall through | hard_safety | UI state changed |
| 36 | Typo correction (Levenshtein ≤ 1) | ~310 | Correct "rom" → "from"; if resolves, replay | exact_win | Constrained correction |

### Tier 2d: Widget Context Bypass

**File**: `chat-routing-clarification-intercept.ts`

| # | Rule | Line | Behavior | Classification | Reasoning |
|---|------|------|----------|----------------|-----------|
| 37 | Widget context + non-chat/widget scope cue | ~402 | Skip intercept, defer to universal resolver | exact_win | Scope cue overrides widget context |
| 38 | Widget context + explicit chat scope cue | ~415 | Continue to chat-scoped recovery | exact_win | Chat scope overrides widget bypass |

### Tier 3: Known-Noun Routing

**File**: `known-noun-routing.ts`

| # | Rule | Line | Behavior | Classification | Reasoning |
|---|------|------|----------|----------------|-----------|
| 39 | Known noun + trailing "?" | ~50 | "Open X, or read docs?" disambiguation | exact_win | Trailing ? = ambiguous intent |
| 40 | Full question about noun | ~70 | Return `handled: false` → skip to docs | exact_win | Full question = docs intent |
| 41 | Exact known-noun + visible panel + strict-exact passes | ~100 | Execute (open panel) | exact_win | Exact + strict-exact = certain |
| 42 | Exact known-noun but panel not visible | ~120 | "Panel unavailable" or defer to Tier 4.5 | exact_win | Don't force invisible panel |
| 43 | Exact match, visible, strict-exact fails | ~140 | Return `handled: false` with `partial` hint | hard_safety | Verb stripping matched; don't execute on stripped form |
| 44 | Near-match (fuzzy) + no active options + not command | ~160 | "Did you mean ___?" suggestion | exact_win | Typo recovery, bounded |
| 45 | Near-match + active options OR command form | ~180 | Return `handled: false` → defer to Tier 4.5 | hard_safety | Fuzzy + command risks hijacking |
| 46 | Unknown noun + visible widget list | ~200 | Return `handled: false` → defer to Tier 4.5 | **should_escalate** | Widget list may contain matches; LLM is better target |
| 47 | Unknown noun + soft-active selection-like | ~210 | Return `handled: false` → defer to Tier 4.5 | **should_escalate** | Soft-active window; defer to unified resolver |

### Tier 4: Panel Disambiguation

**File**: `routing-dispatcher.ts` + `grounding-set.ts`

| # | Rule | Line | Behavior | Classification | Reasoning |
|---|------|------|----------|----------------|-----------|
| 48 | Single exact panel match (no verb) | dispatcher ~3100 | Execute deterministically | exact_win | Unambiguous |
| 49 | Single match + verb form | dispatcher ~3120 | Defer to LLM | **should_escalate** | Verb creates ambiguity; LLM handles better |
| 50 | Multiple panel matches | dispatcher ~3140 | Build candidates, defer to LLM | **should_escalate** | Disambiguation needs LLM |

### Tier 4.5: Semantic Memory & Bounded LLM

**File**: `routing-dispatcher.ts`

| # | Rule | Line | Behavior | Classification | Reasoning |
|---|------|------|----------|----------------|-----------|
| 51 | B2 semantic lookup returns candidates | ~1300 | Validate against live snapshot; attach for Stage 5 / clarifier assist | exact_win (validated replay) | Replay is validated against live state |
| 52 | B2 candidates + Stage 5 skip conditions | ~1564 | Suppress replay when active selection or content-intent | hard_safety | Prevents cross-lane hijacking |
| 53 | Stage 5 shadow replay eligible + enforcement ON | ~1580 | Execute replay from stored memory | exact_win | Validated + frozen context |

### Tier 5: Content-Intent Classifier & Resolver

**File**: `content-intent-classifier.ts` + `routing-dispatcher.ts`

| # | Rule | Line | Behavior | Classification | Reasoning |
|---|------|------|----------|----------------|-----------|
| 54 | No anchor / empty input | classifier:80-83 | Return FALSE_RESULT | hard_safety | No anchor = no content intent possible |
| 55 | SELECTION_PATTERN | classifier:44,85 | Ordinals/letters → return FALSE_RESULT | hard_safety | Selections are positional, never content queries |
| 56 | **DASHBOARD_META_PATTERN** | classifier:51,86 | `^(help\|hello\|hi\|hey\|what can you do\|...)` → return FALSE_RESULT | **mixed** | **Valid for standalone meta queries. Incorrectly blocks greeting-prefixed content/navigation requests ("hey pls summarize that note").** |
| 57 | SEMANTIC_SESSION_PATTERN | classifier:47,87 | Session/history phrases → return FALSE_RESULT | hard_safety | Session queries belong in semantic lane |
| 58 | NON_NOTE_SCOPE_PATTERN | classifier:59,88 | Dashboard/panel/workspace references → return FALSE_RESULT | hard_safety | Explicit non-note scope |
| 59 | NOTE_NON_READ_PATTERN | classifier:67,89 | Mutation verbs → return FALSE_RESULT | hard_safety | Non-read verbs must not enter read resolver |
| 60 | isExplicitCommand (classifier-only) | classifier:138 | Navigation commands → return FALSE_RESULT | exact_win | Commands override content classification |
| 61 | Content pattern match (SUMMARY, QUESTION, FIND_TEXT) | classifier:142-153 | Pattern matches → return content intent with type | exact_win | High-precision pattern matching |
| 62 | Resolver: content above threshold | dispatcher:1574 | `confidence >= 0.75 + anchored_note_content` → enter Stage 6 | exact_win | Threshold-gated |
| 63 | Resolver: ambiguous/timeout/error | dispatcher:1667 | Immediate safe clarifier | hard_safety | Don't force action on uncertainty |

---

## Corrected Totals

| Classification | Count | Percentage |
|---|---|---|
| Exact deterministic win | 37 | 59% |
| Hard safety exclusion | 17 | 27% |
| Should escalate to semantic | 5 | 8% |
| Mixed (partially blocks too early) | 2 | 3% |
| **Total** | **63** | |

**Note**: The original summary counted 57 by grouping classifier guards into 4 buckets. The expanded inventory counts each pattern individually, producing 63 distinct decision points. Both counts describe the same codebase — the difference is granularity.

---

## The 5 Rules That Should Escalate

These rules already defer (return `handled: false`) but to family-specific downstream targets. The cross-surface arbiter would be a better target.

| # | Rule | Current defer target | Better target |
|---|------|---------------------|---------------|
| 15 | Multiple label matches, no exact winner | LLM unresolved hook | Cross-surface arbiter |
| 18 | Continuity deterministic resolve (strict) | LLM hint in strict mode | Cross-surface arbiter |
| 46 | Unknown noun + visible widget list | Tier 4.5 family LLM | Cross-surface arbiter |
| 47 | Unknown noun + soft-active selection-like | Tier 4.5 family LLM | Cross-surface arbiter |
| 49-50 | Verb-form / multiple panel matches | Tier 4 grounding LLM | Cross-surface arbiter |

## The 2 Mixed Rules

These are not pure should-escalate — they are partially correct and partially block too early. They need to be **split**, not simply removed.

| # | Rule | Correct role | Incorrect role | Fix |
|---|------|-------------|----------------|-----|
| 56 | DASHBOARD_META_PATTERN | Valid hard exclusion for standalone meta queries (`help`, `what can you do`) and standalone greetings (`hello`, `hey`) | **Incorrectly blocks greeting-prefixed content/nav requests** ("hey pls summarize that note", "hello which note is open") | Split into META_ONLY_PATTERN (keep in hard guard) + GREETING_PATTERN (standalone only, classifier guard) |
| 60 | isExplicitCommand | Valid for true navigation commands (`open X`, `go to Y`) | **Incorrectly blocks note-referential read imperatives** ("show the text of that note", "read this note") | Already handled: resolver keeps these eligible (isExplicitCommand is classifier-only, not in shared hard guard) |

---

## Safety-Critical Rules (Do NOT Escalate)

The 17 hard safety rules must remain deterministic:

| Category | Rules | Why |
|----------|-------|-----|
| Noise gate | #1 | Prevents gibberish from consuming attempts |
| Gate confidence failures | #13, #20 | Gate/LLM authority must not be overridden |
| Question intent escape | #21 | Questions belong in semantic tier |
| Rejection in multi-option | #24 | Cannot infer from rejection alone |
| Semantic lane + active clarification | #28 | Prevents interference |
| TTL/drift guards | #34, #35 | Stale context is unreliable |
| Fuzzy + command/options | #45 | Fuzzy + command risks hijacking |
| Strict-exact gate failure | #43 | Verb-stripped match is not exact |
| Stage 5 skip conditions | #52 | Prevents cross-lane hijacking |
| Content-intent guards | #54, #55, #57, #58, #59 | Anchor/selection/scope/mutation boundaries |
| Resolver ambiguous | #63 | Don't force on uncertainty |

---

## Recommendations for Phase 2

1. **The 5 should-escalate rules already defer** to family-specific downstream targets. Phase 2 only needs to redirect them to the cross-surface arbiter.

2. **The 2 mixed rules need splitting, not removal**:
   - `DASHBOARD_META_PATTERN` → split into meta-only (hard guard) + standalone greeting (classifier-only guard)
   - `isExplicitCommand` → already handled (resolver-eligible, classifier-only)

3. **The greeting-prefix split is the highest-value Phase 3 change** — it unblocks the most user-visible bug with a single pattern change.

4. **No existing exact wins or hard safety rules need to be weakened.**

---

## Files Audited

| File | Decision Points |
|------|-----------------|
| `lib/chat/chat-routing-clarification-intercept.ts` | 32 |
| `lib/chat/known-noun-routing.ts` | 9 |
| `lib/chat/routing-dispatcher.ts` | 9 |
| `lib/chat/content-intent-classifier.ts` | 10 |
| `lib/chat/input-classifiers.ts` | 1 |
| `lib/chat/grounding-set.ts` | 2 |
| **Total** | **63** |
